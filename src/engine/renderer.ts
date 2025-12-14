import { updateParams } from '../sim/streams';
import { RenderPass, PassKind } from './render-graph';
import { createResourceManager } from './resource-manager';

export type Renderer = {
    computePass: RenderPass;
    drawPass: RenderPass;
    destroy: () => void; // Destroy internally created GPU resources
};

/**
 * Create renderer that runs a compute pass (simulation) then a render pass.
 * - Loads WGSL compute shader at runtime.
 * - Creates compute pipeline & bind groups once and reuses them.
 * - The returned object exposes RenderPasses that can be integrated into a RenderGraph.
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
    cellHeight: number,
    atlasTexture: GPUTexture,
    atlasSampler: GPUSampler,
    canvasEl: HTMLCanvasElement,
    format: GPUTextureFormat
): Promise<Renderer> {
    const rm = createResourceManager(device);

    // --- 1. Load Shaders (Compute & Draw) ---

    // Load compute WGSL (use URL relative to this module so bundlers/dev-servers resolve correctly)
    const computeShaderUrl = new URL('../sim/gpu-update.wgsl', import.meta.url).href;
    const computeCode = await fetch(computeShaderUrl).then(res => res.text());
    const computeModule = rm.createShaderModule({
        code: computeCode,
        label: 'Matrix Compute Shader Module',
    });

    // Load draw shader (URL relative to this module)
    const drawShaderUrl = new URL('../shaders/draw-symbols.wgsl', import.meta.url).href;
    const drawCode = await fetch(drawShaderUrl).then(res => res.text());
    const drawModule = rm.createShaderModule({
        code: drawCode,
        label: 'Matrix Draw Shader Module',
    });

    // --- 2. Compute Pipeline Setup ---

    /** Persistent GPU resource – destroyed only on app shutdown */
    // Layout for: Params, Heads, Speeds, Lengths, Seeds, Columns, GlyphUVs, InstancesOut
    const computeBindGroupLayout = device.createBindGroupLayout({
        label: 'Compute BGL',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },     // Params
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },     // Heads
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },     // Speeds
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },     // Lengths
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },     // Seeds
            { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // Columns (read-only)
            { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // GlyphUVs (read-only)
            { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },     // InstancesOut
        ]
    });

    /** Persistent GPU resource – destroyed only on app shutdown */
    const computePipelineLayout = device.createPipelineLayout({
        label: 'Compute Pipeline Layout',
        bindGroupLayouts: [computeBindGroupLayout],
    });

    const computePipeline = rm.createComputePipeline({
        label: 'Matrix Compute Pipeline',
        layout: computePipelineLayout,
        compute: {
            module: computeModule,
            entryPoint: 'main',
        },
    });

    const computeBindGroup = rm.createBindGroup({
        label: 'Compute Bind Group',
        layout: computeBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 1, resource: { buffer: heads } },
            { binding: 2, resource: { buffer: speeds } },
            { binding: 3, resource: { buffer: lengths } },
            { binding: 4, resource: { buffer: seeds } },
            { binding: 5, resource: { buffer: columns } },
            { binding: 6, resource: { buffer: glyphUVsBuffer } },
            { binding: 7, resource: { buffer: instancesBuffer } },
        ]
    });

    // --- 3. Render Pipeline Setup ---

    // Quad Vertex Buffer (a simple quad that covers one cell space [-0.5, 0.5])
    // Data: position (vec2f), uv (vec2f)
    const vertexData = new Float32Array([
        // posX, posY, uvU, uvV
        -0.5, -0.5, 0.0, 0.0,
        0.5, -0.5, 1.0, 0.0,
        -0.5,  0.5, 0.0, 1.0,

        0.5, -0.5, 1.0, 0.0,
        0.5,  0.5, 1.0, 1.0,
        -0.5,  0.5, 0.0, 1.0
    ]);

    const vertexBuffer = rm.createBuffer({
        label: 'Quad Vertex Buffer',
        size: vertexData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true, // ?
    });
    new Float32Array(vertexBuffer.getMappedRange()).set(vertexData); // ?
    vertexBuffer.unmap(); // ?

    // Screen uniform buffer (vec2<f32>), align to 16 bytes
    const screenBuffer = rm.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Screen Uniform Buffer',
    });

    // Layout for: Sampler, Texture, Instances, ScreenUniform
    const renderBindGroupLayout = device.createBindGroupLayout({
        label: 'Render BGL',
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, // Atlas Sampler
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, // Atlas Texture
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // InstanceData (read-only)
            { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, // ScreenUniform
        ]
    });

    const renderPipelineLayout = device.createPipelineLayout({
        label: 'Render Pipeline Layout',
        bindGroupLayouts: [renderBindGroupLayout],
    });

    const renderPipeline = rm.createRenderPipeline({
        label: 'Matrix Rain Render Pipeline',
        layout: renderPipelineLayout,
        vertex: {
            module: drawModule,
            entryPoint: 'vs_main',
            buffers: [
                {
                    arrayStride: 4 * 4, // 4 floats (pos, uv) * 4 bytes/float
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x2' }, // pos: @location(0)
                        { shaderLocation: 1, offset: 2 * 4, format: 'float32x2' }, // uv: @location(1)
                    ],
                },
            ],
        },
        fragment: {
            module: drawModule,
            entryPoint: 'fs_main',
            targets: [{
                format: format,
                blend: {
                    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                },
            }],
        },
        primitive: { topology: 'triangle-list' },
    });

    // Note: atlas texture & sampler will be bound per-frame via a persistent bind group created in main
    // Create and reuse a single texture view for the atlas (no need to recreate per-frame)
    const atlasView = atlasTexture.createView();

    const renderBindGroup = rm.createBindGroup({
        label: 'Render Bind Group',
        layout: renderBindGroupLayout,
        entries: [
            { binding: 0, resource: atlasSampler },
            { binding: 1, resource: atlasView },
            { binding: 2, resource: { buffer: instancesBuffer } },
            { binding: 3, resource: { buffer: screenBuffer } },
        ],
    });

    // --- 4. Pass Definitions (RenderPass objects for RenderGraph) ---

    const computePass: RenderPass = {
        name: 'matrix-compute',
        kind: 'compute' as PassKind,
        deps: [],
        execute: (encoder: GPUCommandEncoder, _currentView: GPUTextureView, dt: number) => {
            // 1. Update Uniforms (CPU copy to GPU)
            updateParams(device.queue, paramsBuffer, paramsStaging, dt, rows, cols, glyphCount, cellWidth, cellHeight);

            // 2. Encode the Compute Pass
            const cpass = encoder.beginComputePass();
            cpass.setPipeline(computePipeline);
            cpass.setBindGroup(0, computeBindGroup);

            // Dispatch one workgroup per column.
            const workgroupsX = Math.ceil(cols / 64);
            cpass.dispatchWorkgroups(workgroupsX);

            cpass.end();
        }
    };

    const drawPass: RenderPass = {
        name: 'matrix-draw',
        kind: 'draw' as PassKind,
        deps: ['matrix-compute'], // Depends on compute simulation finishing
        execute: (encoder: GPUCommandEncoder, currentView: GPUTextureView, _dt: number) => {
            // 1. Update Screen Uniforms (must be done before render pass)
            const screenData = new Float32Array([canvasEl.width, canvasEl.height]);
            device.queue.writeBuffer(screenBuffer, 0, screenData);

            // 2. Prepare Render Pass Descriptor
            const renderPassDesc: GPURenderPassDescriptor = {
                colorAttachments: [{
                    view: currentView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as const,
                    storeOp: 'store' as const,
                }]
            };

            // 3. Encode the Render Pass
            const rpass = encoder.beginRenderPass(renderPassDesc);
            rpass.setPipeline(renderPipeline);
            rpass.setVertexBuffer(0, vertexBuffer);
            rpass.setBindGroup(0, renderBindGroup);

            // Draw 6 vertices (quad) per instance (total instanceCount symbols)
            rpass.draw(6, instanceCount);
            rpass.end();
        }
    };

    // --- 5. Destruction Logic ---

    const destroy = () => {
        rm.destroyAll();
    };

    return { computePass, drawPass, destroy };
}
