// ============================================================================
// Final-frame presentation.
//
// The shader combines the accumulated scene history and bloom contribution,
// applies CRT-style display effects, tone-maps the resulting HDR intensity,
// and converts the final linear RGB color to sRGB.
//
// PARAMETERS:
//
//   @binding(0): samp (sampler)
//     Linear filtering sampler used when sampling the input textures.
//
//   @binding(1): tex (texture_2d<f32>, rgba16float)
//     Accumulated scene/history texture.
//     Input values are interpreted as linear RGB HDR values.
//     The shader converts the sampled RGB value to BT.709 luminance.
//
//   @binding(2): bloomTex (texture_2d<f32>, rgba16float)
//     Bloom texture produced by the blur stage.
//     Input values are interpreted as linear RGB HDR values.
//     The shader converts the sampled RGB value to BT.709 luminance.
//
//   @binding(3): frame (uniform, FrameParamsLayout)
//     dt: Frame delta time in seconds. Present in the shared frame layout;
//         this shader does not use it.
//     time: Periodic time value used to animate scanlines and film grain.
//           The input is expected to remain in the periodic range [0, 2π).
//
//   @binding(4): params (uniform, PresentParamsLayout)
//     vignetteStrength (f32):
//       Strength of radial edge darkening.
//       Effect: 0 disables vignette, 1 produces strong edge falloff.
//       Reasonable range: [0, 1]; values >1 cause excessive darkening.
//
//     scanlineFreq (f32):
//       Spatial frequency of the horizontal scanline modulation.
//       Effect: determines the number of scanlines across the screen.
//       Reasonable range: ~200–1500 for Full HD; too low produces banding, too high may cause aliasing.
//
//     scanlineStrength (f32):
//       Blend strength of the scanline modulation.
//       Effect: 0.0 leaves the image unmodulated by scanlines, 1 applies full modulation.
//       Reasonable range: [0, 1]; values >1 exaggerate contrast unnaturally.
//
//     noiseAmplitude (f32):
//       Amplitude of the procedural film-grain noise.
//       Effect: added additively to the final color.
//       Reasonable range: [0, 0.1]; values >0.2 quickly overwhelm image detail.
//
//     curvature (f32):
//       Strength of the barrel distortion applied to texture coordinates.
//       Effect: increases geometric distortion toward screen edges.
//       Reasonable range: [0, 0.3]; values >0.5 cause severe stretching and edge loss.
//
//     tintR, tintG, tintB (f32):
//       Per-channel phosphor tint applied to the resulting luminance.
//       Effect: scales luminance per color channel.
//       Reasonable range: [0, 1.5]; classic green CRT look is approximately (0.2, 1.0, 0.2).
//
//     bloomIntensity (f32):
//       Multiplier applied to the bloom luminance before it is added to
//       the scene luminance.
//       Effect: amplifies bright areas using bloomTex.
//       Reasonable range: [0, 1]; values >1 lead to overexposure and loss of detail.
//
// ALGORITHM:
//
//   1. Convert the fragment position to normalized texture coordinates.
//   2. Apply radial barrel distortion controlled by `curvature` and clamp
//      the resulting coordinates to the valid texture range.
//   3. Sample `tex` and `bloomTex` using linear filtering.
//   4. Convert both sampled RGB values to scalar BT.709 luminance:
//        sceneLuminance = dot(sceneRGB, LUMA_BT709)
//        bloomLuminance = dot(bloomRGB, LUMA_BT709)
//   5. Combine scene and bloom luminance:
//        energy = sceneLuminance + bloomLuminance * bloomIntensity
//   6. Apply animated sinusoidal scanline modulation along the Y axis.
//   7. Apply radial vignette attenuation.
//   8. Generate procedural time-varying film grain and add it to the
//      modulated luminance.
//   9. Convert the resulting monochrome intensity to RGB using the
//      configured phosphor tint.
//  10. Clamp negative values to zero and apply Reinhard tone mapping:
//        mapped = color / (1 + color)
//  11. Convert the tone-mapped linear RGB value to sRGB using the
//      IEC 61966-2-1 piecewise transfer function.
//
// OUTPUT:
//
//   @location(0): vec4<f32>
//
//     RGB:
//       sRGB-encoded display color resulting from the final tone-mapped
//       presentation image.
//
//     Alpha:
//       Constant 1.0.
//
//     The shader outputs normalized sRGB color values suitable for the
//     presentation render target.
//
// ============================================================================

/* --- Data layouts --- */

/* {@see FrameParamsLayout@backend/layouts} */
struct FrameParams {
  dt: f32,
  time: f32,
};

/* {@see PresentParamsLayout@backend/layouts} */
struct PresentParams {
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

/* --- Constants --- */

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
@group(0) @binding(3) var<uniform> frame: FrameParams;
@group(0) @binding(4) var<uniform> params: PresentParams;

// NOTE: `frame.time` is periodic [0, 2π) to maintain numerical stability.
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
    SCAN_AMPLITUDE * sin((uv.y * params.scanlineFreq) * TWO_PI + frame.time * SCANLINE_TIME_SCALE);

  let scanMod = mix(1.0, scan, params.scanlineStrength);

  // Vignette
  let dist = distance(uv, center);
  let vig = 1.0 - params.vignetteStrength * smoothstep(0.0, VIGNETTE_EDGE, dist);

  // Film grain (hashed noise)
  let seed = uv.x * GRAIN_SEED_X + uv.y * GRAIN_SEED_Y + frame.time * GRAIN_TIME_SCALE;
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
