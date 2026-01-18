import { GpuResourceScope } from '@backend/resource-tracker';

import { RenderContext } from '@gpu/render-graph';

/**
 * Device-lifetime resources
 */
export type PresentDeviceResources = {
    readonly pipeline: GPURenderPipeline;
    readonly sampler: GPUSampler;
};

export function createPresentDeviceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    shader: GPUShaderModule,
    format: GPUTextureFormat,
): PresentDeviceResources {
    const bindGroupLayout = scope.track(
        device.createBindGroupLayout({
            label: 'Present BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            ],
        })
    );

    const pipelineLayout = scope.track(
        device.createPipelineLayout({
            label: 'Present Pipeline Layout',
            bindGroupLayouts: [bindGroupLayout],
        })
    );

    const pipeline = scope.track(
        device.createRenderPipeline({
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
        })
    );

    const sampler = scope.track(
        device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        })
    );

    return {
        pipeline,
        sampler,
    };
}

/**
 * Surface-lifetime resources
 */
export type PresentSurfaceResources = {
    readonly bindGroup: GPUBindGroup;
};

export function createPresentSurfaceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    pipeline: GPURenderPipeline,
    sampler: GPUSampler,
    colorView: GPUTexture,
): PresentSurfaceResources {
    const bindGroup = scope.track(
        device.createBindGroup({
            label: 'Present Bind Group',
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: colorView },
            ],
        })
    );

    return { bindGroup };
}

export class PresentPass {
    constructor(
        private readonly pipeline: GPURenderPipeline,
        private readonly bindGroup: GPUBindGroup,
    ) {}

    execute(ctx: RenderContext): void {
        const dstView = ctx.acquireView();
        if (!dstView) return;

        const pass = ctx.encoder.beginRenderPass({
            colorAttachments: [{
                view: dstView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(3); // fullscreen triangle
        pass.end();
    }
}
