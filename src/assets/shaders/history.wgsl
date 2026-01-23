@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var prevTex: texture_2d<f32>;
@group(0) @binding(3) var dstTex: texture_storage_2d<rgba16float, write>;

struct Params {
  decay: f32,
  _pad: vec3<f32>,
};
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(8,8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(sceneTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let coords = vec2<i32>(i32(gid.x), i32(gid.y));

  let scene = textureLoad(sceneTex, coords, 0);
  let prev = textureLoad(prevTex, coords, 0);

  // simple exponential decay blend: out = prev * decay + scene
  let outColor = prev * params.decay + scene;

  textureStore(dstTex, coords, outColor);
}
