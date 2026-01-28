import { HistoryParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

import { RenderContext } from '@gpu/render-graph';

/**
 * Device-lifetime resources for the history accumulation compute pass.
 */
export type HistoryDeviceResources = {
    readonly pipeline: GPUComputePipeline;
    readonly sampler: GPUSampler;
};

export function createHistoryDeviceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    shader: GPUShaderModule,
): HistoryDeviceResources {
    const bindGroupLayout = scope.track(
        device.createBindGroupLayout({
            label: 'History Compute BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } }, // sampler
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // scene
                { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // prev history
                { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } }, // dst history
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // params
            ],
        })
    );

    const pipelineLayout = scope.track(
        device.createPipelineLayout({
            label: 'History Compute Pipeline Layout',
            bindGroupLayouts: [bindGroupLayout],
        })
    );

    const pipeline = scope.track(
        device.createComputePipeline({
            layout: pipelineLayout,
            compute: { module: shader, entryPoint: 'cs_main' },
        })
    );

    const sampler = scope.track(
        device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    );

    return { pipeline, sampler };
}

/**
 * Surface-lifetime resources
 */
export type HistorySurfaceResources = {
    readonly historyTexA: GPUTexture;
    readonly historyTexB: GPUTexture;
    readonly paramsBuffer: GPUBuffer;
};

export function createHistorySurfaceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    colorFormat: GPUTextureFormat,
    viewportWidth: number,
    viewportHeight: number,
): HistorySurfaceResources {
    const historyTexA = scope.trackDestroyable(
        device.createTexture({
            size: [viewportWidth, viewportHeight],
            format: colorFormat,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        })
    );

    const historyTexB = scope.trackDestroyable(
        device.createTexture({
            size: [viewportWidth, viewportHeight],
            format: colorFormat,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        })
    );

    const paramsBuffer = scope.trackDestroyable(
        device.createBuffer({
            label: 'History Params',
            size: HistoryParamsLayout.SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
    );

    return { historyTexA, historyTexB, paramsBuffer };
}

export class HistoryComputePass {
    private prev: GPUTexture;
    private dst: GPUTexture;

    constructor(
        private readonly frameScope: GpuResourceScope,
        private readonly pipeline: GPUComputePipeline,
        private readonly sampler: GPUSampler,
        // scene texture produced by DrawPass
        private readonly sceneTexture: GPUTexture,
        // history textures: allocate two textures and ping-pong between them
        historyA: GPUTexture,
        historyB: GPUTexture,
        private readonly paramsBuffer: GPUBuffer,
        private readonly viewportWidth: number,
        private readonly viewportHeight: number,
    ) {
        this.prev = historyA;
        this.dst = historyB;
    }

    getOutputView(): GPUTextureView {
        return this.dst.createView();
    }

    execute(ctx: RenderContext): void {
        const encoder = ctx.encoder;

        const bindGroup = this.frameScope.track(
            ctx.device.createBindGroup({
                label: 'History Compute BG (frame)',
                layout: this.pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: this.sceneTexture.createView() },
                    { binding: 2, resource: this.prev.createView() },
                    { binding: 3, resource: this.dst.createView() },
                    { binding: 4, resource: { buffer: this.paramsBuffer } },
                ],
            })
        );

        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);

        // dispatch size: use 8x8 workgroups based on viewport size passed from the host
        const workX = Math.ceil(this.viewportWidth / 8);
        const workY = Math.ceil(this.viewportHeight / 8);

        pass.dispatchWorkgroups(workX, workY);
        pass.end();

        // swap prev/dst for next frame
        const t = this.prev;
        this.prev = this.dst;
        this.dst = t;
    }
}
