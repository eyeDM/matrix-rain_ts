import { RenderPass, PassKind } from '@engine/render/render-graph';

import { ScreenLayout } from '@platform/webgpu/layouts';
import { createResourceManager } from '@platform/webgpu/resource-manager';

export type DrawShaders = {
    draw: GPUShaderModule;
};

export type Renderer = {
    readonly drawPass: RenderPass;
    destroy: () => void; // Destroy internally created GPU resources
};

/**
 * Draw-only renderer.
 * Owns render pipeline, vertex buffers and bind groups.
 * Does NOT know about simulation, time, canvas resize logic.
 */
export function createRenderer(
    device: GPUDevice,
    format: GPUTextureFormat,
    shaders: DrawShaders,
    atlasTexture: GPUTexture,
    atlasSampler: GPUSampler,
    instancesBuffer: GPUBuffer,
    instanceCount: number,
    screenBuffer: GPUBuffer,
): Renderer {
    const rm = createResourceManager(device);

    // ─────────────────────────────────────────────────────────────
    // Static quad geometry (cell-local space)
    // ─────────────────────────────────────────────────────────────
    const vertexData = new Float32Array([
        // posX, posY, uvU, uvV
        -0.5, -0.5, 0.0, 0.0,
         0.5, -0.5, 1.0, 0.0,
        -0.5,  0.5, 0.0, 1.0,

         0.5, -0.5, 1.0, 0.0,
         0.5,  0.5, 1.0, 1.0,
        -0.5,  0.5, 0.0, 1.0,
    ]);

    const vertexBuffer = rm.createBuffer({
        label: 'Quad Vertex Buffer',
        size: vertexData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });

    new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
    vertexBuffer.unmap();

    // ─────────────────────────────────────────────────────────────
    // Bind group layout & pipeline
    // ─────────────────────────────────────────────────────────────

    const bindGroupLayout = device.createBindGroupLayout({
        label: 'Render BGL',
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, // Atlas Sampler
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, // Atlas Texture
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // InstanceData
            { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, // ScreenLayout
        ],
    });

    const pipelineLayout = device.createPipelineLayout({
        label: 'Render Pipeline Layout',
        bindGroupLayouts: [bindGroupLayout],
    });

    const renderPipeline = device.createRenderPipeline({
        label: 'Matrix Rain Render Pipeline',
        layout: pipelineLayout,
        vertex: {
            module: shaders.draw,
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
            module: shaders.draw,
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

    // Screen uniform buffer
    /*const screenBuffer = rm.createBuffer({
        size: ScreenLayout.SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Screen Uniform Buffer',
    });*/

    const bindGroup = device.createBindGroup({
        label: 'Render Bind Group',
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: atlasSampler },
            { binding: 1, resource: atlasView },
            { binding: 2, resource: { buffer: instancesBuffer } },
            { binding: 3, resource: { buffer: screenBuffer } },
        ],
    });

    // ─────────────────────────────────────────────────────────────
    // Draw pass
    // ─────────────────────────────────────────────────────────────

    // --- Pass Definitions (RenderPass objects for RenderGraph) ---

    const drawPass: RenderPass = {
        name: 'matrix-draw',
        kind: 'draw' as PassKind,
        deps: ['matrix-compute'], // explicit dependency, simulation is external
        execute: (
            encoder: GPUCommandEncoder,
            currentView: GPUTextureView
        ): void => {
            // 1. Update Screen Uniforms (must be done before render pass)
            //const staging = new ArrayBuffer(ScreenLayout.SIZE);
            //const view = new DataView(staging);
            //view.setFloat32(ScreenLayout.offsets.width, canvasEl.width, true);
            //view.setFloat32(ScreenLayout.offsets.height, canvasEl.height, true);
            //device.queue.writeBuffer(screenBuffer, 0, staging);

            // Prepare Render Pass Descriptor
            const renderPassDesc: GPURenderPassDescriptor = {
                colorAttachments: [{
                    view: currentView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as const,
                    storeOp: 'store' as const,
                }],
            };

            // Encode the Render Pass
            const pass = encoder.beginRenderPass(renderPassDesc);

            pass.setPipeline(renderPipeline);
            pass.setVertexBuffer(0, vertexBuffer);
            pass.setBindGroup(0, bindGroup);

            // Draw 6 vertices (quad) per instance (total instanceCount symbols)
            pass.draw(6, instanceCount);
            pass.end();
        }
    };

    return {
        drawPass,
        destroy(): void {
            rm.destroyAll();
        }
    };
}
