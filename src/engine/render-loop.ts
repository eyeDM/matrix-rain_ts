/**
 * Render loop
 * - Issues per-frame command encoder and render pass
 * - Clears the canvas each frame (black)
 * - Minimizes per-frame JS allocations by reusing the pass descriptor
 *
 * Note: acquiring the current swap-chain texture and creating a view is
 * required each frame by the WebGPU model — we only avoid recreating
 * descriptor objects on the JS heap per-frame.
 */

export type FrameCallback = (
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    dt: number
) => void;

export function startRenderLoop(
    device: GPUDevice,
    context: GPUCanvasContext,
    frameCallback: FrameCallback
) {
    let rafId = 0;
    const queue = device.queue;

    let lastTime = performance.now();

    function frame(): void {
        // Acquire the current texture view from the context (required per-frame)
        let currentView: GPUTextureView;
        try {
            currentView = context.getCurrentTexture().createView();
        } catch (e) {
            // If we fail to acquire a view (platform/browser timing), skip this frame but keep the loop alive
            // This avoids uncaught exceptions that would stop the RAF loop entirely.
            // eslint-disable-next-line no-console
            console.warn('Could not acquire current swap-chain texture, skipping frame', e);
            rafId = requestAnimationFrame(frame);
            return;
        }

        const commandEncoder = device.createCommandEncoder();

        const now = performance.now();
        const dt = (now - lastTime) / 1000.0;
        lastTime = now;

        // Let caller encode compute + render using the same encoder to guarantee ordering.
        // Protect against exceptions in the frame callback so the RAF loop continues.
        try {
            frameCallback(commandEncoder, currentView, dt);
        } catch (err) {
            // Log and continue — we still attempt to finish/submit whatever was encoded.
            // eslint-disable-next-line no-console
            console.error('Error in frame callback:', err);
        }

        try {
            queue.submit([commandEncoder.finish()]);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to submit GPU commands for frame:', err);
        }

        rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);

    /**
     * Stops the active render loop by cancelling the internally scheduled
     * requestAnimationFrame callback.
     */
    return function stop() {
        cancelAnimationFrame(rafId);
    };
}
