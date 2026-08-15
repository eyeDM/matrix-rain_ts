// ============================================================================
// Temporal history accumulation with frame-rate-independent exponential retention.
//
// Purpose:
//   For each pixel, blends the current scene value (sceneTex)
//   with the previous frame (prevTex) and writes the result
//   to the destination texture. The accumulated history provides
//   temporal smoothing and phosphor-like persistence/trail effects.
//
// --------------------------------------------------
//
// Parameters:
//
//   `retention` defines the fraction of the previous history
//   retained over REFERENCE_DT. The retention is adjusted using
//   the current frame's `dt`, so the visual effect is independent
//   of frame rate.
//
//   Effect:
//   - retention = 0.0 → history is completely ignored; output equals the current scene.
//   - 0.0 < retention < 1.0 → previous frames fade exponentially over time.
//   - retention ≈ 1.0 → history persists for a long time, producing strong trails
//     and phosphor-like image persistence.
//
// The effective retention for the current frame is:
//
//   retention^(dt / REFERENCE_DT)
//
// This keeps the temporal behavior consistent across different frame rates.
//
// ============================================================================

/* {@see ViewportParamsLayout@backend/layouts} */
struct ViewportParams {
  width: u32,
  height: u32,

  pad0: u32,
  pad1: u32,
};

/* {@see FrameParamsLayout@backend/layouts} */
struct FrameParams {
  dt: f32,
  time: f32,

  pad0: f32,
  pad1: f32,
};

/* {@see HistoryParamsLayout@backend/layouts} */
struct HistoryParams {
  retention: f32,

  pad0: f32,
  pad1: f32,
  pad2: f32,
};

const REFERENCE_DT: f32 = 1.0 / 60.0;

@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var prevTex: texture_2d<f32>;
@group(0) @binding(2) var dstTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> viewport: ViewportParams;
@group(0) @binding(4) var<uniform> frame: FrameParams;
@group(0) @binding(5) var<uniform> params: HistoryParams;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= viewport.width || gid.y >= viewport.height) {
    return;
  }

  let coords = vec2<i32>(i32(gid.x), i32(gid.y));

  let scene = textureLoad(sceneTex, coords, 0);
  let prev = textureLoad(prevTex, coords, 0);

  // frame-rate-independent exponential temporal accumulation
  let retention = pow(
      params.retention,
      frame.dt / REFERENCE_DT
  );
  let outColor =
      scene * (1.0 - retention) +
      prev * retention;

  textureStore(dstTex, coords, outColor);
}
