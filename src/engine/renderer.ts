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
export async function createRenderer(
  device: GPUDevice,
  cols: number,
  rows: number,
  paramsBuffer: GPUBuffer,
  heads: GPUBuffer,
  speeds: GPUBuffer,
  lengths: GPUBuffer,
  seeds: GPUBuffer,
  columns: GPUBuffer,
  glyphUVsBuffer: GPUBuffer,
  instancesBuffer: GPUBuffer,
  glyphCount: number,
  cellWidth: number,
  cellHeight: number
  , atlasTexture: GPUTexture,
  atlasSampler: GPUSampler,
  canvasEl: HTMLCanvasElement,
  format: GPUTextureFormat
): Promise<Renderer> {
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
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
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
      { binding: 5, resource: { buffer: columns } },
      { binding: 6, resource: { buffer: glyphUVsBuffer } },
      { binding: 7, resource: { buffer: instancesBuffer } }
    ]
  });

  // Precompute dispatch size
  const workgroupSize = 64;
  const dispatchX = Math.ceil(cols / workgroupSize);

  // --- Render pipeline setup ---
  // Load draw shader
  const drawResp = await fetch('/src/shaders/draw-symbols.wgsl');
  const drawCode = await drawResp.text();
  const drawModule = device.createShaderModule({ code: drawCode });

  // Vertex buffer: unit quad (two triangles), attrs: pos.xy, uv.xy
  const quadVerts = new Float32Array([
    // x, y, u, v
    -0.5, -0.5, 0.0, 0.0,
     0.5, -0.5, 1.0, 0.0,
    -0.5,  0.5, 0.0, 1.0,

     0.5, -0.5, 1.0, 0.0,
     0.5,  0.5, 1.0, 1.0,
    -0.5,  0.5, 0.0, 1.0
  ]);

  const vertexBuffer = device.createBuffer({
    size: quadVerts.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vertexBuffer, 0, quadVerts.buffer);

  // Screen uniform buffer (vec2<f32>), align to 16 bytes
  const screenBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const renderBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
    ]
  });

  const renderPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] });

  const renderPipeline = device.createRenderPipeline({
    layout: renderPipelineLayout,
    vertex: {
      module: drawModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' }
          ]
        }
      ]
    },
    fragment: {
      module: drawModule,
      entryPoint: 'fs_main',
      targets: [{ format }]
    },
    primitive: { topology: 'triangle-list' }
  });

  // Note: atlas texture & sampler will be bound per-frame via a persistent bind group created in main
  const renderBindGroup = device.createBindGroup({
    layout: renderBindGroupLayout,
    entries: [
      { binding: 0, resource: atlasSampler },
      { binding: 1, resource: atlasTexture.createView() },
      { binding: 2, resource: { buffer: instancesBuffer } },
      { binding: 3, resource: { buffer: screenBuffer } }
    ]
  });

  function encodeFrame(encoder: GPUCommandEncoder, currentView: GPUTextureView, dt: number) {
    // Update params buffer with dt, rows, cols, glyphCount and cell sizes
    updateParams(device.queue, paramsBuffer, dt, rows, cols, glyphCount, cellWidth, cellHeight);

    // Compute pass
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(computePipeline);
    cpass.setBindGroup(0, computeBindGroup);
    cpass.dispatchWorkgroups(dispatchX);
    cpass.end();

    // Render pass
    const colorAttachment: GPURenderPassColorAttachment = {
      view: currentView,
      clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
      loadOp: 'clear',
      storeOp: 'store'
    };

    const rpassDesc: GPURenderPassDescriptor = { colorAttachments: [colorAttachment] };
    const rpass = encoder.beginRenderPass(rpassDesc);

    // Update screen uniform
    // screen: vec2<f32> -> write canvas size (pixels)
    // We cannot access the canvas size from here; caller should update screenBuffer via device.queue prior to frame
    // write current screen size into screenBuffer
    const screenBuf = new Float32Array([canvasEl.width, canvasEl.height]);
    device.queue.writeBuffer(screenBuffer, 0, screenBuf.buffer);

    rpass.setPipeline(renderPipeline);
    // bind group 0 reserved for compute; render uses bind group 0 as its own group in this pipeline layout
    // Set vertex buffer and draw instanced (one instance per column)
    rpass.setVertexBuffer(0, vertexBuffer);
    rpass.setBindGroup(0, renderBindGroup);
    // The render bind group must be provided externally; we expect caller to bind it in a future patch
    rpass.draw(6, cols, 0, 0);
    rpass.end();
  }

  return { encodeFrame };
}
