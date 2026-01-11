import { RenderContext } from '@engine/render/render-graph';

export type PresentPass = {
    execute(ctx: RenderContext): void;
};

/**
 * FIXME: bindGroup здесь всё ещё создаётся per-frame.
 * Следующее улучшение — хранить bindGroup и пересоздавать его
 * только при resize / смене sceneColor texture,
 * что полностью уберёт CPU allocations из present-pass.
 */

export function createPresentPass(
    device: GPUDevice,
    format: GPUTextureFormat,
    shader: GPUShaderModule,
    sceneColorName: string,
): PresentPass {
    const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
    });

    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        }),
        vertex: {
            module: shader,
            entryPoint: 'vs_main',
        },
        fragment: {
            module: shader,
            entryPoint: 'fs_main',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-list' },
    });

    function execute(ctx: RenderContext): void {
        const srcView = ctx.resources.getTexture(sceneColorName);
        const dstView = ctx.acquireView();
        if (!dstView) return;

        const bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: sampler },
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

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3); // fullscreen triangle
        pass.end();
    }

    return { execute };
}
