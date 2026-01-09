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

@fragment
fn fs_main(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let size = vec2<f32>(textureDimensions(tex));
  let uv = p.xy / size;
  return textureSample(tex, samp, uv);
}
