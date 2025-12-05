// draw-symbols.wgsl
// Instanced symbol renderer.
//
// Buffer / bind group layout (group 0):
//  binding(0) : sampler       - sampler for atlas texture
//  binding(1) : texture_2d<f32> - atlas texture (rgba8unorm)
//  binding(2) : storage<read> InstanceData[] - per-instance data (one per symbol instance)
//  binding(3) : uniform Screen { size: vec2<f32> } - canvas size in pixels
//
// Vertex input (vertex buffer 0):
//  @location(0) pos: vec2<f32>   - quad corner in normalized cell space (-0.5..0.5)
//  @location(1) uv: vec2<f32>    - quad corner UV in cell space (0..1)
//
// Instance data layout (storage buffer) - InstanceData (packed to 16-byte alignment):
// struct InstanceData {
//   offset: vec2<f32>;   // pixel-space offset of top-left of cell
//   cellSize: vec2<f32>; // pixel size (width, height) of cell
//   uvRect: vec4<f32>;   // u0, v0, u1, v1 (normalized atlas UVs)
//   brightness: f32;     // 0..1 multiplier based on trail depth
//   _pad: vec3<f32>;     // pad to 16-byte multiple
// };

@group(0) @binding(0) var atlasSampler: sampler;
@group(0) @binding(1) var atlasTex: texture_2d<f32>;

struct InstanceData {
  offset: vec2<f32>;
  cellSize: vec2<f32>;
  uvRect: vec4<f32>;
  brightness: f32;
  pad0: vec3<f32>;
};

@group(0) @binding(2)
var<storage, read> instances: array<InstanceData>;

struct Screen {
  size: vec2<f32>;
};

@group(0) @binding(3)
var<uniform> screen: Screen;

struct VertexOut {
  @builtin(position) Position: vec4<f32>;
  @location(0) v_uv: vec2<f32>;
  @location(1) v_brightness: f32;
};

@vertex
fn vs_main(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>, @builtin(instance_index) instanceIdx: u32) -> VertexOut {
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
  out.v_uv = mix(uv00, uv11, uv);

  out.v_brightness = inst.brightness;

  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  // Sample the atlas (glyphs rendered white on transparent background)
  let sample = textureSample(atlasTex, atlasSampler, in.v_uv);

  // Use sampled luminance (assuming glyphs are white) as intensity
  let intensity = sample.r;

  // Green-only output, scale by instance brightness
  let g = intensity * in.v_brightness;

  // Output alpha multiplied by brightness for smooth edges
  return vec4<f32>(0.0, g, 0.0, sample.a * in.v_brightness);
}
