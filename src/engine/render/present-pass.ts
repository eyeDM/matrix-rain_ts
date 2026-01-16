import { RGPassType, RGPass, RenderContext } from '@engine/render/render-graph';

/**
 * FIXME: bindGroup здесь всё ещё создаётся per-frame.
 * Следующее улучшение — хранить bindGroup и пересоздавать его
 * только при resize / смене sceneColor texture,
 * что полностью уберёт CPU allocations из present-pass.
 */

export class PresentPassBuilder {
    private readonly sampler: GPUSampler;
    private readonly bindGroupLayout: GPUBindGroupLayout;
    private readonly renderPipeline: GPURenderPipeline;

    private isBuilt: boolean = false;

    constructor(
        private readonly device: GPUDevice,
        format: GPUTextureFormat,
        shader: GPUShaderModule,
        private readonly colorTextureName: string,
    ) {
        this.sampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });

        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'Present BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            ],
        });

        const pipelineLayout = device.createPipelineLayout({
            label: 'Present Pipeline Layout',
            bindGroupLayouts: [this.bindGroupLayout],
        });

        this.renderPipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shader,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shader,
                entryPoint: 'fs_main',
                targets: [{ format: format }],
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    build(): RGPass {
        const execute= (ctx: RenderContext): void => {
            const srcView = ctx.resources.getTexture(this.colorTextureName);
            const dstView = ctx.acquireView();
            if (!dstView) return;

            const bindGroup = this.device.createBindGroup({
                label: 'Present Bind Group',
                layout: this.bindGroupLayout,
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: srcView },
                ],
            });

            const pass = ctx.encoder.beginRenderPass({
                colorAttachments: [{
                    view: dstView,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                }],
            });

            pass.setPipeline(this.renderPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.draw(3); // fullscreen triangle
            pass.end();
        };

        this.isBuilt = true;

        return {
            name: 'PresentPass',
            type: 'present' as RGPassType,
            reads: [this.colorTextureName],
            writes: [],
            execute: execute,
        };
    }

    rebuild(): RGPass {
        return this.build();
    }
}
