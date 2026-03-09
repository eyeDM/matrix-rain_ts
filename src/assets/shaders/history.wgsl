// ============================================================================
// Simple history accumulation (temporal accumulation) with exponential decay.
//
// Purpose:
//   For each pixel, it blends the current scene value (sceneTex)
//   with the previous frame (prevTex) and writes the result
//   to the destination texture. This technique is commonly used
//   for temporal smoothing, trail effects, light accumulation, noise reduction,
//   or post-processing effects with inertia.
//
// --------------------------------------------------
//
// Parameters:
//
//   `decay` is the history decay coefficient. It defines how much
//   of the previous frame is preserved during blending.
//
//   Effect:
//   - decay = 0.0 → history is completely ignored; the output equals the current scene (no accumulation).
//   - 0.0 < decay < 1.0 → exponential decay: past frames fade out gradually, producing temporal inertia.
//   - decay ≈ 1.0 → history is almost fully preserved; strong trails and image “sticking” may occur.
//   - decay > 1.0 → history amplification, leading to exponential growth of values and visible artifacts (not recommended).
//   - decay < 0.0 → inversion of the history contribution; visually incorrect and numerically unstable.
//
// ============================================================================

/* {@see HistoryParamsLayout@backend/layouts} */
struct HistoryParams {
  decay: f32,

  pad0: f32,
  pad1: f32,
  pad2: f32,
};

@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var prevTex: texture_2d<f32>;
@group(0) @binding(2) var dstTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: HistoryParams;

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
