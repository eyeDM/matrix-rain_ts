import type { RenderContext } from '@gpu/render-graph';

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
 *
 * Timing:
 * - `dt` is computed using `DOMHighResTimeStamp` and expressed in milliseconds.
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

export function startRenderLoop(
    device: GPUDevice,
    onEachFrame: (ctx: RenderContext) => void,
): () => void {
    let lastTime: number | null = null;
    let isActive = true;

    function tick(now: DOMHighResTimeStamp): void {
        if (!isActive) return;

        const dt = lastTime === null ? 0 : (now - lastTime) / 1000;
        lastTime = now;

        const encoder = device.createCommandEncoder();
        const ctx: RenderContext = { device, encoder, dt };

        onEachFrame(ctx);
        device.queue.submit([encoder.finish()]);
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
    return () => { isActive = false; };
}
