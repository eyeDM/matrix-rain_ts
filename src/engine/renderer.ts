import { createStreamBuffers, updateParams } from '../sim/streams';

export type Renderer = {
  encodeFrame: (encoder: GPUCommandEncoder, currentView: GPUTextureView, dt: number) => void;
};

/**
 * Create renderer that runs a compute pass (simulation) then a render pass.
 * - Loads WGSL compute shader at runtime
 * - Creates compute pipeline & bind groups once and reuses them
 * - encodeFrame runs compute dispatch then a simple clear render pass (placeholder)
 */
export async function createRenderer(device: GPUDevice, cols: number, rows: number, paramsBuffer: GPUBuffer, heads: GPUBuffer, speeds: GPUBuffer, lengths: GPUBuffer, seeds: GPUBuffer, columns: GPUBuffer): Promise<Renderer> {
  // Load compute WGSL
  const computeResp = await fetch('/src/sim/gpu-update.wgsl');
  const computeCode = await computeResp.text();
  const computeModule = device.createShaderModule({ code: computeCode });

  // Create an explicit bind group layout that matches the compute shader's expected bindings
  const computeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }
    ]
  });

  const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] });

  const computePipeline = device.createComputePipeline({
    layout: computePipelineLayout,
    compute: { module: computeModule, entryPoint: 'main' }
  });

  const computeBindGroup = device.createBindGroup({
    layout: computeBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: heads } },
      { binding: 2, resource: { buffer: speeds } },
      { binding: 3, resource: { buffer: lengths } },
      { binding: 4, resource: { buffer: seeds } },
      { binding: 5, resource: { buffer: columns } }
    ]
  });

  // Precompute dispatch size
  const workgroupSize = 64;
  const dispatchX = Math.ceil(cols / workgroupSize);

  function encodeFrame(encoder: GPUCommandEncoder, currentView: GPUTextureView, dt: number) {
    // Update params buffer with dt, rows, cols
    updateParams(device.queue, paramsBuffer, dt, rows, cols);

    // Compute pass
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(computePipeline);
    cpass.setBindGroup(0, computeBindGroup);
    cpass.dispatchWorkgroups(dispatchX);
    cpass.end();

    // Render pass (currently a clear only to validate ordering)
    const colorAttachment: GPURenderPassColorAttachment = {
      view: currentView,
      clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
      loadOp: 'clear',
      storeOp: 'store'
    };

    const rpassDesc: GPURenderPassDescriptor = { colorAttachments: [colorAttachment] };
    const rpass = encoder.beginRenderPass(rpassDesc);
    // Placeholder: actual draw calls will be added in Stage 5/6 integration
    rpass.end();
  }

  return { encodeFrame };
}
