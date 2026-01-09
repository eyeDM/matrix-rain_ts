import { PassKind, RenderContext, RenderPass } from '@engine/render/render-graph';

export function createPresentPass(
    device: GPUDevice,
    format: GPUTextureFormat,
    shader: GPUShaderModule,
    sceneColorName: string,
): RenderPass {
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

    function execute(ctx: RenderContext): void  {
        const view = ctx.acquireView();
        if (!view) return;

        const sceneView = ctx.resources.getColor(
            sceneColorName,
            // descriptor already created earlier, reuse by name
            undefined as never,
        );

        const bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: sceneView },
            ],
        });

        const pass = ctx.encoder.beginRenderPass({
            colorAttachments: [
                {
                    view,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        });

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
    }

    return {
        name: 'final-present',
        kind: 'post' as PassKind,
        deps: ['matrix-draw'],
        execute: execute,
    };
}
