import { RenderPass, PassKind } from '@engine/render/render-graph';

import { ScreenLayout } from '@platform/webgpu/layouts';
import { createResourceManager } from '@platform/webgpu/resource-manager';

export type Renderer = {
    readonly computePass: RenderPass;
    readonly drawPass: RenderPass;
    destroy: () => void; // Destroy internally created GPU resources
};

/**
 * Create renderer that runs a compute pass (simulation) then a render pass.
 * - Loads WGSL compute shader at runtime.
 * - Creates compute pipeline & bind groups once and reuses them.
 * - The returned object exposes RenderPasses that can be integrated into a RenderGraph.
 */
export function createRenderer(
    device: GPUDevice,
    canvasEl: HTMLCanvasElement,
    format: GPUTextureFormat,
    shader: GPUShaderModule,
    atlasTexture: GPUTexture,
    atlasSampler: GPUSampler,
    instancesBuffer: GPUBuffer,
    instanceCount: number,
    computePass: RenderPass,
): Renderer {
    const rm = createResourceManager(device);

    // --- Render Pipeline Setup ---

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

    // Screen uniform buffer
    const screenBuffer = rm.createBuffer({
        size: ScreenLayout.SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Screen Uniform Buffer',
    });

    const renderBindGroupLayout = device.createBindGroupLayout({
        label: 'Render BGL',
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, // Atlas Sampler
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, // Atlas Texture
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // InstanceData
            { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, // ScreenLayout
        ],
    });

    const renderPipelineLayout = device.createPipelineLayout({
        label: 'Render Pipeline Layout',
        bindGroupLayouts: [renderBindGroupLayout],
    });

    const renderPipeline = device.createRenderPipeline({
        label: 'Matrix Rain Render Pipeline',
        layout: renderPipelineLayout,
        vertex: {
            module: shader,
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
            module: shader,
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

    const renderBindGroup = device.createBindGroup({
        label: 'Render Bind Group',
        layout: renderBindGroupLayout,
        entries: [
            { binding: 0, resource: atlasSampler },
            { binding: 1, resource: atlasView },
            { binding: 2, resource: { buffer: instancesBuffer } },
            { binding: 3, resource: { buffer: screenBuffer } },
        ],
    });

    // --- Pass Definitions (RenderPass objects for RenderGraph) ---

    const drawPass: RenderPass = {
        name: 'matrix-draw',
        kind: 'draw' as PassKind,
        deps: ['matrix-compute'], // Depends on compute simulation finishing
        execute: (encoder: GPUCommandEncoder, currentView: GPUTextureView, _dt: number) => {
            // 1. Update Screen Uniforms (must be done before render pass)
            const staging = new ArrayBuffer(ScreenLayout.SIZE);
            const view = new DataView(staging);
            view.setFloat32(ScreenLayout.offsets.width, canvasEl.width, true);
            view.setFloat32(ScreenLayout.offsets.height, canvasEl.height, true);
            device.queue.writeBuffer(screenBuffer, 0, staging);

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

    return {
        computePass,
        drawPass,
        destroy(): void {
            rm.destroyAll();
        }
    };
}
