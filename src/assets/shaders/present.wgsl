@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(pos[i], 0.0, 1.0);
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

struct PresentUniforms {
  resolution: vec2<f32>,
  time: f32,
  _pad0: f32,
  vignetteStrength: f32,
  scanlineStrength: f32,
  noiseAmplitude: f32,
  curvature: f32,
  tint: vec4<f32>, // rgb + pad
  scanlineFreq: f32,
  _pad1: vec3<f32>,
};
@group(0) @binding(2) var<uniform> present: PresentUniforms;

@fragment
fn fs_main(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let sizei = textureDimensions(tex);
  let size = vec2<f32>(f32(sizei.x), f32(sizei.y));
  var uv = p.xy / size;

  // Apply subtle barrel curvature around center
  let center = vec2<f32>(0.5, 0.5);
  let d = uv - center;
  let r2 = dot(d, d);
  uv = center + d * (1.0 + present.curvature * r2);

  // Sample (clamp UV to avoid sampling outside)
  uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  let col = textureSample(tex, samp, uv).rgb;

  // Monochrome luminance -> tinted green phosphor
  let lum = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
  var tint = present.tint.xyz * lum;

  // Scanline modulation (sinusoidal across Y)
  let scan = 0.5 + 0.5 * sin((uv.y * present.scanlineFreq) * 6.283185 + present.time * 1.5);
  let scanMod = mix(1.0, scan, present.scanlineStrength);

  // Vignette
  let dist = distance(uv, center);
  let vig = 1.0 - present.vignetteStrength * smoothstep(0.0, 0.7071, dist);

  // Film grain (hashed noise)
  let seed = uv.x * 12.9898 + uv.y * 78.233 + present.time * 0.1;
  let n = fract(sin(seed) * 43758.5453);
  let grain = (n - 0.5) * present.noiseAmplitude;

  let result = tint * scanMod * vig + grain;
  return vec4<f32>(result, 1.0);
}
