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

struct BlurParams {
  dir: vec2<f32>,
  texelSize: f32,
  threshold: f32,
};
@group(0) @binding(2) var<uniform> params: BlurParams;

@fragment
fn fs_main(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let sizei = textureDimensions(tex);
  let size = vec2<f32>(f32(sizei.x), f32(sizei.y));
  let uv = p.xy / size;

  // Gaussian-ish weights (5 taps) to reduce sample cost
  let w = array<f32,5>(0.06, 0.24, 0.38, 0.24, 0.06);

  var sum = vec3<f32>(0.0);
  var tot = 0.0;

  // center offset index 2
  for (var i: i32 = 0; i < 5; i = i + 1) {
    let offset = f32(i - 2) * params.texelSize * params.dir;
    let sampleUV = clamp(uv + offset, vec2<f32>(0.0), vec2<f32>(1.0));
    let c = textureSample(tex, samp, sampleUV).rgb;
    let weight = w[i];
    sum = sum + c * weight;
    tot = tot + weight;
  }

  // Bright-pass threshold applied in the first blur pass by setting threshold>0
  let lum = dot(sum / tot, vec3<f32>(0.2126, 0.7152, 0.0722));
  let bright = max(lum - params.threshold, 0.0);
  let out = (sum / tot) * (bright / max(lum, 1e-5));

  return vec4<f32>(out, 1.0);
}
