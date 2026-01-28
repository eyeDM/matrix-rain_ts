import { GpuResourceScope } from '@backend/resource-tracker';

import { RenderContext } from '@gpu/render-graph';

export type BlurDeviceResources = {
    readonly pipeline: GPURenderPipeline;
    readonly sampler: GPUSampler;
};

export function createBlurDeviceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    shader: GPUShaderModule,
    format: GPUTextureFormat,
): BlurDeviceResources {
    const bindGroupLayout = scope.track(
        device.createBindGroupLayout({
            label: 'Blur BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            ],
        })
    );

    const pipelineLayout = scope.track(
        device.createPipelineLayout({
            label: 'Blur Pipeline Layout',
            bindGroupLayouts: [bindGroupLayout],
        })
    );

    const pipeline = scope.track(
        device.createRenderPipeline({
            label: 'Blur Pipeline',
            layout: pipelineLayout,
            vertex: { module: shader, entryPoint: 'vs_main' },
            fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
        })
    );

    const sampler = scope.track(
        device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    );

    return { pipeline, sampler };
}

export type BlurSurfaceResources = {
    readonly bindGroup: GPUBindGroup;
};

export function createBlurSurfaceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    pipeline: GPURenderPipeline,
    sampler: GPUSampler,
    inputView: GPUTextureView,
    paramsBuffer: GPUBuffer,
): BlurSurfaceResources {
    const bindGroupLayout = pipeline.getBindGroupLayout(0);
    const bindGroup = scope.track(
        device.createBindGroup({
            label: 'Blur Surface BG',
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: inputView },
                { binding: 2, resource: { buffer: paramsBuffer } },
            ],
        })
    );

    return { bindGroup };
}

export class BlurPass {
    constructor(
        private readonly pipeline: GPURenderPipeline,
        private readonly bindGroup: GPUBindGroup,
        private readonly target: GPUTexture,
    ) {}

    execute(ctx: RenderContext): void {
        const pass = ctx.encoder.beginRenderPass({
            colorAttachments: [{
                view: this.target.createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(3);
        pass.end();
    }
}
