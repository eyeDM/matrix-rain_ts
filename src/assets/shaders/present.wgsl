@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(pos[i], 0.0, 1.0);
}

const TWO_PI: f32 = 6.283185307179586;
const SCAN_BIAS: f32 = 0.5;
const SCAN_AMPLITUDE: f32 = 0.5; // used to map sin() from -1..1 to 0..1
const SCANLINE_TIME_SCALE: f32 = 1.5; // temporal speed factor for scanline animation
const VIGNETTE_EDGE: f32 = 0.7071;
const GRAIN_SEED_X: f32 = 12.9898;
const GRAIN_SEED_Y: f32 = 78.233;
const GRAIN_TIME_SCALE: f32 = 0.1;
const GRAIN_HASH_SCALE: f32 = 43758.5453;
const HALF: f32 = 0.5;

// MUST match PresentUniformLayout (align: 4, size: 48)
struct PresentUniforms {
  width: f32,
  height: f32,
  time: f32, // Periodic time wrapped to [0, 2π) - guarantees f32 precision
  vignetteStrength: f32,
  scanlineStrength: f32,
  noiseAmplitude: f32,
  curvature: f32,
  tintR: f32,
  tintG: f32,
  tintB: f32,
  scanlineFreq: f32,
  bloomIntensity: f32,
};

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var bloomTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> present: PresentUniforms;

// NOTE: present.time is periodic [0, 2π) to maintain numerical stability.
// All time-based effects use periodic functions (sin, hash), so wrapping is semantically correct.

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
  let bloom = textureSample(bloomTex, samp, uv).rgb;

  // Monochrome luminance -> tinted green phosphor
  let lum = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
  var tint = vec3<f32>(present.tintR, present.tintG, present.tintB) * lum;

  // Scanline modulation (sinusoidal across Y)
  let scan = SCAN_BIAS + SCAN_AMPLITUDE * sin((uv.y * present.scanlineFreq) * TWO_PI + present.time * SCANLINE_TIME_SCALE);
  let scanMod = mix(1.0, scan, present.scanlineStrength);

  // Vignette
  let dist = distance(uv, center);
  let vig = 1.0 - present.vignetteStrength * smoothstep(0.0, VIGNETTE_EDGE, dist);

  // Film grain (hashed noise)
  let seed = uv.x * GRAIN_SEED_X + uv.y * GRAIN_SEED_Y + present.time * GRAIN_TIME_SCALE;
  let n = fract(sin(seed) * GRAIN_HASH_SCALE);
  let grain = (n - HALF) * present.noiseAmplitude;

  let outColor = tint * scanMod * vig + grain + bloom * present.bloomIntensity;
  return vec4<f32>(outColor, 1.0);
}
