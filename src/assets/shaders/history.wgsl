// ============================================================================
// Temporal history accumulation: Exponential decay and blend.
//
// PARAMETERS:
//   @binding(0): sceneTex (texture_2d<f32>, rgba16float)
//     Current frame; linear RGB HDR; range [0.0, ∞).
//
//   @binding(1): prevTex (texture_2d<f32>, rgba16float)
//     Previous accumulated history; linear RGB HDR; range [0.0, ∞).
//
//   @binding(2): dstTex (texture_storage_2d<rgba16float, write>)
//     Destination output texture; write-only.
//
//   @binding(3): viewport (uniform, ViewportParamsLayout)
//     width, height: Render target dimensions in pixels.
//
//   @binding(4): frame (uniform, FrameParamsLayout)
//     dt: Frame delta time (seconds).
//     time: Total elapsed time (seconds).
//
//   @binding(5): params (uniform, HistoryParamsLayout)
//     retention (f32): Exponential decay factor per REFERENCE_DT (1/60 sec).
//       Range: [0.0, 1.0]
//       Semantics: Fraction of previous history to retain each frame.
//       - 0.0: No temporal accumulation; output = current frame only.
//       - 1.0: Perfect persistence; history never decays.
//
// ALGORITHM:
//   1. Load current frame (sceneTex) and previous history (prevTex) at pixel.
//   2. Compute frame-rate-independent retention:
//      retention_adjusted = pow(retention, dt / REFERENCE_DT)
//   3. Linear blend: output = scene * (1 - retention_adjusted) + prev * retention_adjusted
//   4. Store result to dstTex.
//
// OUTPUT:
//   @binding(2): dstTex (rgba16float)
//     Temporally blended result; linear RGB HDR; range [0.0, ∞).
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
