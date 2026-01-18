import { RenderContext } from '@engine/render/render-graph';

import { GpuResourceScope } from '@platform/webgpu/resource-manager';

/**
 * Device-lifetime resources
 */
export type DrawDeviceResources = {
    readonly vertexBuffer: GPUBuffer;
};

export function createDrawDeviceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
): DrawDeviceResources {
    // --- Static quad geometry (cell-local space) ---

    const vertexData = new Float32Array([
        // posX, posY, uvU, uvV
        -0.5, -0.5, 0.0, 0.0,
         0.5, -0.5, 1.0, 0.0,
        -0.5,  0.5, 0.0, 1.0,

         0.5, -0.5, 1.0, 0.0,
         0.5,  0.5, 1.0, 1.0,
        -0.5,  0.5, 0.0, 1.0,
    ]);

    const vertexBuffer = scope.trackDestroyable(
        device.createBuffer({
            label: 'Quad Vertex Buffer',
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        })
    );

    new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
    vertexBuffer.unmap();

    return { vertexBuffer };
}

/**
 * Surface-lifetime resources
 */
export type DrawSurfaceResources = {
    readonly bindGroup: GPUBindGroup;
    readonly pipeline: GPURenderPipeline;
    readonly colorView: GPUTexture,
    readonly depthView: GPUTexture,
};

export function createDrawSurfaceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    shader: GPUShaderModule,
    atlasSampler: GPUSampler,
    atlasTextureView: GPUTextureView,
    instanceBuffer: GPUBuffer,
    screenBuffer: GPUBuffer,
    colorFormat: GPUTextureFormat,
    depthFormat: GPUTextureFormat,
    viewportWidth: number,
    viewportHeight: number,
): DrawSurfaceResources {
    // --- Bind group layout & pipeline ---

    const bindGroupLayout = scope.track(
        device.createBindGroupLayout({
            label: 'Render BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }, // Atlas Sampler
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, // Atlas Texture
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // InstanceData
                { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, // ScreenLayout
            ],
        })
    );

    const bindGroup = scope.track(
        device.createBindGroup({
            label: 'Render Bind Group',
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: atlasSampler },
                { binding: 1, resource: atlasTextureView },
                { binding: 2, resource: { buffer: instanceBuffer } },
                { binding: 3, resource: { buffer: screenBuffer } },
            ],
        })
    );

    const pipelineLayout = scope.track(
        device.createPipelineLayout({
            label: 'Render Pipeline Layout',
            bindGroupLayouts: [bindGroupLayout],
        })
    );

    const pipeline = scope.track(
        device.createRenderPipeline({
            label: 'Matrix Rain Render Pipeline',
            layout: pipelineLayout,
            vertex: {
                module: shader,
                entryPoint: 'vs_main',
                buffers: [
                    // Quad
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
                    format: colorFormat,
                    blend: {
                        color: {
                            srcFactor: 'src-alpha',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add',
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add',
                        },
                    },
                }],
            },
            depthStencil: {
                format: depthFormat,
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
            primitive: { topology: 'triangle-list' },
        })
    );

    // --- Color and Depth textures ---

    const colorView = scope.trackDestroyable(
        device.createTexture({
            size: [viewportWidth, viewportHeight],
            format: colorFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            //usage: GPUTextureUsage.RENDER_ATTACHMENT,
        })
    );
    const depthView = scope.trackDestroyable(
        device.createTexture({
            size: [viewportWidth, viewportHeight],
            format: depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        })
    );

    return {
        bindGroup,
        pipeline,
        colorView,
        depthView,
    };
}

export class DrawPass {
    constructor(
        private readonly vertexBuffer: GPUBuffer,
        private readonly pipeline: GPURenderPipeline,
        private readonly bindGroup: GPUBindGroup,
        private readonly colorView: GPUTexture,
        private readonly depthView: GPUTexture,
        private readonly instanceCount: number,
    ) {}

    execute(ctx: RenderContext): void {
        const pass = ctx.encoder.beginRenderPass({
            colorAttachments: [{
                view: this.colorView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
            depthStencilAttachment: {
                view: this.depthView,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                depthClearValue: 1.0,
            },
        });

        pass.setPipeline(this.pipeline);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setBindGroup(0, this.bindGroup);
        // 6 vertices = 2 triangles forming a quad;
        // instanced `instanceCount` times (one instance per glyph)
        pass.draw(6, this.instanceCount);

        pass.end();
    }
}
