// ============================================================================
// Separable Gaussian blur: Applies a 5-tap Gaussian kernel to produce blur.
//
// PARAMETERS:
//   @binding(0): sampler
//     Filtering sampler; configured with linear magnification/minification
//     and clamp-to-edge addressing.
//
//   @binding(1): tex (texture_2d<f32>, rgba16float)
//     Input bloom texture in linear RGB HDR; range [0.0, ∞).
//
//   @binding(2): params (uniform buffer, BlurParams)
//     dir (vec2<f32>):     Blur direction. (1.0, 0.0) for horizontal pass;
//                          (0.0, 1.0) for vertical pass.
//     texelSize (f32):     Normalized step size; 1.0 / texel count along
//                          the blur direction (accounts for source resolution
//                          and intermediate blur targets).
//
// ALGORITHM:
//   1. Compute output UV from rasterization position.
//   2. Sample 5 points along the direction specified by params.dir.
//   3. Weight each sample with a 5-tap Gaussian kernel.
//   4. Accumulate weighted RGB and normalize by total weight.
//
// OUTPUT:
//   @location(0): vec4<f32> (rgba16float)
//     Blurred result: RGB = weighted blur, alpha = 1.0.
//     Linear RGB HDR; range [0.0, ∞).
//
// ============================================================================

/* {@see BlurParamsLayout@backend/layouts} */
struct BlurParams {
  dir: vec2<f32>,  // (1,0) for horizontal, (0,1) for vertical
  texelSize: f32,  // 1.0 / resolution along blur axis

  pad0: f32,
};

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
@group(0) @binding(2) var<uniform> params: BlurParams;

@fragment
fn fs_main(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let sizei = textureDimensions(tex);
  let size = vec2<f32>(f32(sizei.x), f32(sizei.y));
  let uv = p.xy / size;

  // 5-tap Gaussian-like kernel (energy-preserving)
  let w = array<f32,5>(0.06, 0.24, 0.38, 0.24, 0.06);

  var sum = vec3<f32>(0.0);
  var tot = 0.0;

  for (var i: i32 = 0; i < 5; i = i + 1) {
    let offset = f32(i - 2) * params.texelSize * params.dir;
    let sampleUV = uv + offset; // sampler handles edge clamping
    let c = textureSample(tex, samp, sampleUV).rgb;

    let weight = w[i];
    sum = sum + c * weight;
    tot = tot + weight;
  }

  let color = sum / tot;
  return vec4<f32>(color, 1.0);
}
