// shaders/draw-symbols.wgsl
// * Instanced symbol renderer *

// Instance data layout (storage buffer) - InstanceData:
// MUST match InstanceLayout (48 bytes, align 16)
struct InstanceData {
  offset: vec2<f32>,   // pixel-space offset of top-left of cell
  cellSize: vec2<f32>, // pixel size (width, height) of cell
  uvRect: vec4<f32>,   // u0, v0, u1, v1 (normalized atlas UVs)
  brightness: f32,     // 0..1 multiplier based on trail depth
  pad0: vec3<f32>,     // pad to 16-byte multiple (total 48 bytes)
};

// MUST match ScreenLayout (16 bytes, align 16)
struct Screen {
  size: vec2<f32>, // canvas size in pixels
};

struct VertexOut {
  @builtin(position) Position: vec4<f32>,
  @location(0) v_uv: vec2<f32>,
  @location(1) v_brightness: f32,
};

// Buffer / bind group layout:
@group(0) @binding(0) var atlasSampler: sampler; // sampler for atlas texture
@group(0) @binding(1) var atlasTexture: texture_2d<f32>; // rgba8unorm
@group(0) @binding(2) var<storage, read> instances: array<InstanceData>; // per-instance data (one per symbol instance)
@group(0) @binding(3) var<uniform> screen: Screen; // canvas size in pixels

// Vertex input (vertex buffer 0):
//  @location(0) pos: vec2<f32>   - quad corner in normalized cell space (-0.5..0.5)
//  @location(1) uv: vec2<f32>    - quad corner UV in cell space (0..1)
@vertex
fn vs_main(
  @location(0) pos: vec2<f32>,
  @location(1) uv: vec2<f32>,
  @builtin(instance_index) instanceIdx: u32
) -> VertexOut {
  var out: VertexOut;

  // Load instance
  let inst = instances[instanceIdx];

  // Convert normalized cell-space pos (-0.5..0.5) to pixel-space
  let pixelPos = inst.offset + (pos + vec2<f32>(0.5, 0.5)) * inst.cellSize;

  // Convert pixel space to NDC
  let ndcX = (pixelPos.x / screen.size.x) * 2.0 - 1.0;
  // flip Y because texture/canvas origin is top-left
  let ndcY = 1.0 - (pixelPos.y / screen.size.y) * 2.0;

  out.Position = vec4<f32>(ndcX, ndcY, 0.0, 1.0);

  // Compute atlas UV by interpolating between uvRect corners
  let uv00 = inst.uvRect.xy;
  let uv11 = inst.uvRect.zw;
  // Interpolate inside the glyph cell and clamp slightly inside the cell to avoid sampling neighbor pixels
  // Use explicit linear interpolation to avoid relying on `mix` availability
  let rawUV = uv00 + uv * (uv11 - uv00);
  let eps = 1e-5;
  out.v_uv = clamp(rawUV, uv00 + vec2<f32>(eps, eps), uv11 - vec2<f32>(eps, eps));

  out.v_brightness = inst.brightness;

  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  // Sample the glyph from the atlas texture
  let glyphColor = textureSample(atlasTexture, atlasSampler, in.v_uv).a; // Use alpha channel if atlas is monochrome

  // The final color is a green base color scaled by the glyph's alpha/luminosity
  let baseColor = vec3<f32>(0.0, 1.0, 0.0); // Bright green base

  // Fading logic:
  let finalBrightness = pow(in.v_brightness, 1.5); // Use power curve for faster falloff
  let finalColor = baseColor * finalBrightness;

  // Mix the color with the sampled glyph visibility
  let alpha = glyphColor * finalBrightness;

  return vec4<f32>(finalColor, alpha);
}
