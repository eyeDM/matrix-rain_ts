/**
 * Render loop for Stage 2
 * - Issues per-frame command encoder and render pass
 * - Clears the canvas each frame (black)
 * - Minimizes per-frame JS allocations by reusing the pass descriptor
 *
 * Note: acquiring the current swap-chain texture and creating a view is
 * required each frame by the WebGPU model — we only avoid recreating
 * descriptor objects on the JS heap per-frame.
 */
export function startRenderLoop(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat) {
  let rafId = 0;
  const queue = device.queue;

  // Reusable clear color (black) and attachment descriptors
  const clearColor = { r: 0, g: 0, b: 0, a: 1 };

  const colorAttachment = {
    view: undefined as unknown as GPUTextureView,
    clearValue: clearColor,
    loadOp: 'clear' as const,
    storeOp: 'store' as const
  } as GPURenderPassColorAttachment;

  const renderPassDesc: GPURenderPassDescriptor = {
    colorAttachments: [colorAttachment]
  };

  function frame(): void {
    // Acquire the current texture view from the context (required per-frame)
    const currentView = context.getCurrentTexture().createView();
    colorAttachment.view = currentView;

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDesc);
    passEncoder.end();

    queue.submit([commandEncoder.finish()]);
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);

  return function stop() {
    cancelAnimationFrame(rafId);
  };
}
