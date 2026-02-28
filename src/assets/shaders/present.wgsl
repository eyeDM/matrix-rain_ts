// ============================================================================
// Final-frame presentation with a stylized CRT aesthetic.
//
// Purpose:
//   This shader implements a fullscreen post-processing “CRT / retro display”
//   effect applied to an already rendered image.
//   It renders a fullscreen triangle and, in the fragment shader, simulates:
//   - monochrome phosphor display with color tint,
//   - barrel (CRT-style) screen curvature,
//   - animated scanlines,
//   - edge vignette,
//   - film grain / noise,
//   - additive bloom from a separate texture.
//
// The shader is designed for numerical stability:
//  the time parameter is wrapped to [0, 2π), which is sufficient for all periodic effects.
//
// It is well suited for retro games, terminal displays, and old-monitor-style UI overlays.
//
// --------------------------------------------------
//
// Parameters:
//
//   time:
//   - Purpose: periodic time value used to animate scanlines and grain.
//   - Effect: controls phase of sinusoidal and hash-based functions.
//   - Reasonable range: [0, 2π); wrapping is required for f32 precision stability.
//
//   vignetteStrength:
//   - Purpose: controls the strength of edge darkening.
//   - Effect: 0 disables vignette, 1 produces strong edge falloff.
//   - Reasonable range: [0, 1]; values >1 cause excessive darkening.
//
//   scanlineFreq:
//   - Purpose: vertical frequency of scanlines.
//   - Effect: determines the number of scanlines across the screen.
//   - Reasonable range: ~200–1500 for Full HD; too low produces banding, too high may cause aliasing.
//
//   scanlineStrength:
//   - Purpose: blend factor for scanline modulation.
//   - Effect: 0 disables scanlines, 1 applies full modulation.
//   - Reasonable range: [0, 1]; values >1 exaggerate contrast unnaturally.
//
//   noiseAmplitude:
//   - Purpose: amplitude of film grain noise.
//   - Effect: added additively to the final color.
//   - Reasonable range: [0, 0.1]; values >0.2 quickly overwhelm image detail.
//
//   curvature:
//   - Purpose: strength of barrel distortion (CRT curvature).
//   - Effect: increases geometric distortion toward screen edges.
//   - Reasonable range: [0, 0.3]; values >0.5 cause severe stretching and edge loss.
//
//   tintR, tintG, tintB:
//   - Purpose: phosphor color tint applied to monochrome luminance.
//   - Effect: scales luminance per color channel.
//   - Reasonable range: [0, 1.5]; classic green CRT look is approximately (0.2, 1.0, 0.2).
//
//   bloomIntensity:
//   - Purpose: intensity of the additive bloom contribution.
//   - Effect: amplifies bright areas using bloomTex.
//   - Reasonable range: [0, 1]; values >1 lead to overexposure and loss of detail.
//
// ============================================================================

/* {@see PresentParamsLayout@backend/layouts} */
struct PresentParams {
  time: f32, // Periodic time wrapped to [0, 2π) - guarantees f32 precision
  vignetteStrength: f32,
  scanlineFreq: f32,
  scanlineStrength: f32,
  noiseAmplitude: f32,
  curvature: f32,
  tintR: f32,
  tintG: f32,
  tintB: f32,
  bloomIntensity: f32,
};

const TWO_PI: f32 = 6.283185307179586;

const LUMA_BT709: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722); // ITU-R Recommendation 709
const SCAN_BIAS: f32 = 1.0;
const SCAN_AMPLITUDE: f32 = 0.5; // used to map sin() from -1..1 to 0..1
const SCANLINE_TIME_SCALE: f32 = 1.5; // temporal speed factor for scanline animation
const VIGNETTE_EDGE: f32 = 0.7071; // ≈ √(0.5² + 0.5²) // radius normalization for square screen
const GRAIN_SEED_X: f32 = 12.9898; // destroying the correlation in X and Y
const GRAIN_SEED_Y: f32 = 78.233;
const GRAIN_TIME_SCALE: f32 = 0.1; // "analogue feel"
const GRAIN_HASH_SCALE: f32 = 43758.5453; // scale to turn sin() into a pseudo-random hash
const HALF: f32 = 0.5;

fn tonemap_reinhard(x: vec3<f32>) -> vec3<f32> {
    return x / (1.0 + x);
}

// Convert linear RGB → sRGB (IEC 61966-2-1 transfer function).
// The mapping is piecewise to approximate human brightness perception:
//  - for very dark values (≤ 0.0031308) a linear slope 12.92 avoids banding,
//  - above that, a power curve with exponent 1/2.4 models display gamma.
// Constants are defined by the sRGB standard:
//  0.0031308 — linear→nonlinear breakpoint,
//  12.92     — slope of the linear segment,
//  0.055     — offset ("a") ensuring continuity between segments.
fn linear_to_srgb(x: vec3<f32>) -> vec3<f32> {
  let a = 0.055;
  return select(
    12.92 * x,
    (1.0 + a) * pow(x, vec3<f32>(1.0 / 2.4)) - a,
    x > vec3<f32>(0.0031308)
  );
}

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
@group(0) @binding(2) var bloomTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: PresentParams;

// NOTE: params.time is periodic [0, 2π) to maintain numerical stability.
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
  uv = center + d * (1.0 + params.curvature * r2);

  // Sample (clamp UV to avoid sampling outside)
  uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));

  let col = textureSample(tex, samp, uv).rgb;
  let lum = dot(col, LUMA_BT709);

  let bloom = textureSample(bloomTex, samp, uv).rgb;
  let bloomLum = dot(bloom, LUMA_BT709);

  let energy = lum + bloomLum * params.bloomIntensity;

  // Scanline modulation (sinusoidal across Y)
  let scan = SCAN_BIAS +
    SCAN_AMPLITUDE * sin((uv.y * params.scanlineFreq) * TWO_PI + params.time * SCANLINE_TIME_SCALE);

  let scanMod = mix(1.0, scan, params.scanlineStrength);

  // Vignette
  let dist = distance(uv, center);
  let vig = 1.0 - params.vignetteStrength * smoothstep(0.0, VIGNETTE_EDGE, dist);

  // Film grain (hashed noise)
  let seed = uv.x * GRAIN_SEED_X + uv.y * GRAIN_SEED_Y + params.time * GRAIN_TIME_SCALE;
  let n = fract(sin(seed) * GRAIN_HASH_SCALE);
  let grain = (n - HALF) * params.noiseAmplitude;

  // Monochrome luminance -> tinted green phosphor
  let tint = vec3<f32>(params.tintR, params.tintG, params.tintB);

  let outLinear = (energy * scanMod * vig + grain) * tint;

  // tonemap+gamma
  let mapped = tonemap_reinhard(max(outLinear, vec3<f32>(0.0)));
  let outSRGB = linear_to_srgb(mapped);

  return vec4<f32>(outSRGB, 1.0);
}
