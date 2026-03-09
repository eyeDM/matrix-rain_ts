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

/* {@see ViewportParamsLayout@backend/layouts} */
struct ViewportParams {
  width: u32,
  height: u32,

  pad0: u32,
  pad1: u32,
};

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
@group(0) @binding(3) var<uniform> viewport: ViewportParams;
@group(0) @binding(4) var<uniform> params: HistoryParams;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= viewport.width || gid.y >= viewport.height) {
    return;
  }

  let coords = vec2<i32>(i32(gid.x), i32(gid.y));

  let scene = textureLoad(sceneTex, coords, 0);
  let prev = textureLoad(prevTex, coords, 0);

  // exponential moving average (EMA)
  let outColor = scene * (1.0 - params.decay) + prev * params.decay;

  textureStore(dstTex, coords, outColor);
}
