/**
 * Render loop infrastructure.
 *
 * Responsibilities:
 * - Drives the RAF-based frame lifecycle
 * - Issues exactly one GPUCommandEncoder per frame
 * - Submits command buffers to the device queue
 * - Provides a per-frame context object via dependency injection
 *
 * Design notes:
 * - The render loop is intentionally unaware of canvas, swap chain,
 *   or framebuffer concepts.
 * - Framebuffer acquisition is delegated to FrameContext.acquireView(),
 *   allowing different backends (canvas, offscreen, XR).
 * - A frame may be intentionally skipped by returning `null` from
 *   acquireView(); the loop continues without interruption.
 *
 * Timing:
 * - `dt` is computed using `performance.now()` and expressed in seconds.
 *
 * WebGPU-specific notes:
 * - Acquiring the current swap-chain texture and creating a view is
 *   required every frame by the WebGPU model.
 * - Per-frame GPU objects (encoder, texture view) are recreated as required,
 *   while higher-level JS descriptor objects should be reused externally
 *   to minimize GC pressure.
 *
 * Invariants:
 * - The render loop always schedules the next RAF tick.
 * - Submitting an empty command buffer is valid and expected.
 */

/**
 * TODO:
 * - stop() / dispose()
 * - optional FPS limiting / fixed timestep
 * - device.lost integration
 */

export interface FrameContext {
    readonly encoder: GPUCommandEncoder;
    readonly dt: number;

    /** Framebuffer acquisition */
    acquireView(): GPUTextureView | null;
}

export type FrameContextFactory = (
    encoder: GPUCommandEncoder,
    dt: number
) => FrameContext;

export function startRenderLoop(
    device: GPUDevice,
    makeContext: FrameContextFactory,
    frame: (ctx: FrameContext) => void,
): void {
    let lastTime = performance.now();

    function tick(): void {
        const now = performance.now();
        const dt = (now - lastTime) / 1000.0;
        lastTime = now;

        const commandEncoder = device.createCommandEncoder();
        const ctx = makeContext(commandEncoder, dt);

        frame(ctx);
        device.queue.submit([commandEncoder.finish()]);
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}
