import { updateParams } from '../sim/streams';

export type Renderer = {
  encodeFrame: (encoder: GPUCommandEncoder, currentView: GPUTextureView, dt: number) => void;
  destroy: () => void;
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
  paramsStaging: ArrayBuffer,
  heads: GPUBuffer,
  speeds: GPUBuffer,
  lengths: GPUBuffer,
  seeds: GPUBuffer,
  columns: GPUBuffer,
  glyphUVsBuffer: GPUBuffer,
  instancesBuffer: GPUBuffer,
  instanceCount: number,
  glyphCount: number,
  cellWidth: number,
  cellHeight: number
  , atlasTexture: GPUTexture,
  atlasSampler: GPUSampler,
  canvasEl: HTMLCanvasElement,
  format: GPUTextureFormat
): Promise<Renderer> {
  // Load compute WGSL (use URL relative to this module so bundlers/dev-servers resolve correctly)
  const computeResp = await fetch(new URL('../sim/gpu-update.wgsl', import.meta.url).href);
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
  // Load draw shader (URL relative to this module)
  const drawResp = await fetch(new URL('../shaders/draw-symbols.wgsl', import.meta.url).href);
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
  const screenStaging = new Float32Array(4); // reuse per-frame

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
  // Create and reuse a single texture view for the atlas (no need to recreate per-frame)
  const atlasView = atlasTexture.createView();
  const renderBindGroup = device.createBindGroup({
    layout: renderBindGroupLayout,
    entries: [
      { binding: 0, resource: atlasSampler },
      { binding: 1, resource: atlasView },
      { binding: 2, resource: { buffer: instancesBuffer } },
      { binding: 3, resource: { buffer: screenBuffer } }
    ]
  });

  // Pre-allocated render pass descriptor templates to avoid per-frame allocations.
  const colorAttachmentTemplate: GPURenderPassColorAttachment = {
    view: {} as GPUTextureView,
    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
    loadOp: 'clear',
    storeOp: 'store'
  };

  const renderPassDescTemplate: GPURenderPassDescriptor = {
    colorAttachments: [colorAttachmentTemplate]
  };

  function encodeFrame(encoder: GPUCommandEncoder, currentView: GPUTextureView, dt: number) {
    // Update params buffer with dt, rows, cols, glyphCount and cell sizes using preallocated staging
    updateParams(device.queue, paramsBuffer, paramsStaging, dt, rows, cols, glyphCount, cellWidth, cellHeight);

    // Compute pass
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(computePipeline);
    cpass.setBindGroup(0, computeBindGroup);
    cpass.dispatchWorkgroups(dispatchX);
    cpass.end();

    // Render pass
    // Reuse color attachment descriptor to avoid allocations
    const colorAttachment = colorAttachmentTemplate;
    colorAttachment.view = currentView;

    const rpass = encoder.beginRenderPass(renderPassDescTemplate);

    // Update screen uniform using staging buffer to avoid allocation
    screenStaging[0] = canvasEl.width;
    screenStaging[1] = canvasEl.height;
    // write entire backing buffer (16 bytes)
    device.queue.writeBuffer(screenBuffer, 0, screenStaging.buffer);

    rpass.setPipeline(renderPipeline);
    rpass.setVertexBuffer(0, vertexBuffer);
    rpass.setBindGroup(0, renderBindGroup);
    // draw all emitted instances (cols * MAX_TRAIL)
    rpass.draw(6, instanceCount, 0, 0);
    rpass.end();
  }

  function destroy() {
    // Destroy GPU resources created by this renderer where the API supports it.
    // We only destroy objects that the renderer created itself; buffers passed in by
    // the caller (like instancesBuffer) must be managed by the caller.

    try {
      if (vertexBuffer && typeof (vertexBuffer as any).destroy === 'function') (vertexBuffer as any).destroy();
    } catch (e) { /* ignore */ }

    try {
      if (screenBuffer && typeof (screenBuffer as any).destroy === 'function') (screenBuffer as any).destroy();
    } catch (e) { /* ignore */ }

    // Some implementations may expose destroy on shader modules, pipelines or bind groups.
    // Call destroy only when present to avoid runtime errors in browsers that don't implement it.
    try { if (typeof (computeModule as any)?.destroy === 'function') (computeModule as any).destroy(); } catch (e) {}
    try { if (typeof (drawModule as any)?.destroy === 'function') (drawModule as any).destroy(); } catch (e) {}

    try { if (typeof (computePipeline as any)?.destroy === 'function') (computePipeline as any).destroy(); } catch (e) {}
    try { if (typeof (renderPipeline as any)?.destroy === 'function') (renderPipeline as any).destroy(); } catch (e) {}

    try { if (typeof (computeBindGroup as any)?.destroy === 'function') (computeBindGroup as any).destroy(); } catch (e) {}
    try { if (typeof (renderBindGroup as any)?.destroy === 'function') (renderBindGroup as any).destroy(); } catch (e) {}

    try { if (typeof (computeBindGroupLayout as any)?.destroy === 'function') (computeBindGroupLayout as any).destroy(); } catch (e) {}
    try { if (typeof (renderBindGroupLayout as any)?.destroy === 'function') (renderBindGroupLayout as any).destroy(); } catch (e) {}

    // Note: do not destroy or null out buffers owned by the caller (paramsBuffer, instancesBuffer, etc.)
  }

  return { encodeFrame, destroy };
}
