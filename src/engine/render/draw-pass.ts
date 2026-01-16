import { RGPassType, RGPass, RenderContext } from '@engine/render/render-graph';

/**
 * FIXME: RenderGraph пересоздаётся при resize, что вызывает пересоздание
 * Vertex buffer, pipeline, bind group.
 * Возможное решение:
 * - выделить и хранить независимо StaticDrawResources.
 */

export class DrawPassBuilder {
    private readonly vertexBuffer: GPUBuffer;
    private readonly atlasView: GPUTextureView;
    private readonly bindGroupLayout: GPUBindGroupLayout;
    private readonly renderPipeline: GPURenderPipeline;

    private isBuilt: boolean = false;

    constructor(
        private readonly device: GPUDevice,
        shader: GPUShaderModule,
        atlasTexture: GPUTexture,
        private readonly atlasSampler: GPUSampler,
        colorFormat: GPUTextureFormat,
        //depthFormat: GPUTextureFormat,
        private readonly instanceBufferName: string,
        private readonly colorTextureName: string,
        //private readonly depthTextureName: string,
    ) {
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

        this.vertexBuffer = device.createBuffer({
            label: 'Quad Vertex Buffer',
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });

        new Float32Array(this.vertexBuffer.getMappedRange()).set(vertexData);
        this.vertexBuffer.unmap();

        this.atlasView = atlasTexture.createView();

        // --- Bind group layout & pipeline ---

        this.bindGroupLayout = device.createBindGroupLayout({
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
            bindGroupLayouts: [this.bindGroupLayout],
        });

        this.renderPipeline = device.createRenderPipeline({
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
            /*depthStencil: {
                format: depthFormat,
                depthWriteEnabled: true,
                depthCompare: 'less',
            },*/
            primitive: { topology: 'triangle-list' },
        });
    }

    build(
        screenBuffer: GPUBuffer,
        instanceCount: number,
    ): RGPass {
        const execute= (ctx: RenderContext): void => {
            const bindGroup = this.device.createBindGroup({
                label: 'Render Bind Group',
                layout: this.bindGroupLayout,
                entries: [
                    { binding: 0, resource: this.atlasSampler },
                    { binding: 1, resource: this.atlasView },
                    { binding: 2, resource: { buffer: ctx.resources.getBuffer(this.instanceBufferName) } },
                    { binding: 3, resource: { buffer: screenBuffer } },
                ],
            });

            const colorView = ctx.resources.getTexture(this.colorTextureName);
            //const depthView = ctx.resources.getTexture(this.depthTextureName);

            const pass = ctx.encoder.beginRenderPass({
                colorAttachments: [{
                    view: colorView,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                }],
                /*depthStencilAttachment: {
                    view: depthView,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                    depthClearValue: 1.0,
                },*/
            });

            pass.setPipeline(this.renderPipeline);
            pass.setVertexBuffer(0, this.vertexBuffer);
            pass.setBindGroup(0, bindGroup);
            // 6 vertices = 2 triangles forming a quad;
            // instanced `instanceCount` times (one instance per glyph)
            pass.draw(6, instanceCount);

            pass.end();
        };

        this.isBuilt = true;

        return {
            name: 'DrawPass',
            type: 'draw' as RGPassType,
            reads: [this.instanceBufferName],
            writes: [this.colorTextureName],
            execute: execute,
        };
    }

    rebuild(
        screenBuffer: GPUBuffer,
        instanceCount: number,
    ): RGPass {
        if (this.isBuilt) {
            this.destroyResources();
        }

        return this.build(screenBuffer, instanceCount);
    }

    private destroyResources(): void {
        try { this.vertexBuffer.destroy(); } catch {}
    }
}
