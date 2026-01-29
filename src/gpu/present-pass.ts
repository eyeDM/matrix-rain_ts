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
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
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

// FIXME: DEAD CODE
export function createPresentSurfaceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    pipeline: GPURenderPipeline,
    sampler: GPUSampler,
    colorView: GPUTexture,
    presentUniformBuffer: GPUBuffer,
): PresentSurfaceResources {
    const bindGroup = scope.track(
        device.createBindGroup({
            label: 'Present Bind Group',
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: colorView.createView() },
                { binding: 2, resource: colorView.createView() },
                { binding: 3, resource: { buffer: presentUniformBuffer } },
            ],
        })
    );

    return { bindGroup };
}

export function writeBlurParams(): void {}

export class PresentPass {
    // cache view to avoid creating it every frame
    private readonly bloomTexView: GPUTextureView;

    constructor(
        private readonly frameScope: GpuResourceScope,
        private readonly pipeline: GPURenderPipeline,
        private readonly sampler: GPUSampler,
        private readonly presentUniformBuffer: GPUBuffer,
        /** A callback that returns the current GPUTextureView to sample for presentation. */
        private readonly getTextureView: () => GPUTextureView,
        bloomTexture: GPUTexture,
    ) {
        this.bloomTexView = bloomTexture.createView();
    }

    execute(ctx: RenderContext): void {
        const dstView = ctx.acquireView();
        if (!dstView) return;

        // Create a transient bind group per-frame that points at the current source texture.
        const bindGroup = this.frameScope.track(
            ctx.device.createBindGroup({
                label: 'Present Bind Group (frame)',
                layout: this.pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: this.getTextureView() },
                    { binding: 2, resource: this.bloomTexView },
                    { binding: 3, resource: { buffer: this.presentUniformBuffer } },
                ],
            })
        );

        const pass = ctx.encoder.beginRenderPass({
            colorAttachments: [{
                view: dstView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3); // fullscreen triangle
        pass.end();
    }
}
