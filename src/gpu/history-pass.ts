import { GpuResourceScope } from '@backend/resource-tracker';

import { RenderContext } from '@gpu/render-graph';

const COLOR_FORMAT_HDR: GPUTextureFormat = 'rgba16float';

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
                { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: COLOR_FORMAT_HDR } }, // dst history
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
};

export function createHistorySurfaceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    viewportWidth: number,
    viewportHeight: number,
): HistorySurfaceResources {
    const createTexture = (label: string): GPUTexture => {
        return scope.trackDestroyable(
            device.createTexture({
                label: label,
                size: [viewportWidth, viewportHeight],
                format: COLOR_FORMAT_HDR,
                usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
            })
        );
    };

    const historyTexA = createTexture('History Texture A');
    const historyTexB = createTexture('History Texture B');

    return { historyTexA, historyTexB };
}

export class HistoryComputePass {
    // cache views to avoid creating it every frame
    private readonly sceneView: GPUTextureView;

    private readonly historyViewA: GPUTextureView;
    private readonly historyViewB: GPUTextureView;

    private ping = 0;

    constructor(
        private readonly frameScope: GpuResourceScope,
        private readonly pipeline: GPUComputePipeline,
        private readonly sampler: GPUSampler,
        // scene texture produced by DrawPass
        sceneTex: GPUTexture,
        // history textures: allocate two textures and ping-pong between them
        historyTexA: GPUTexture,
        historyTexB: GPUTexture,
        private readonly paramsBuffer: GPUBuffer,
        private readonly viewportWidth: number,
        private readonly viewportHeight: number,
    ) {
        this.sceneView = sceneTex.createView();

        this.historyViewA = historyTexA.createView();
        this.historyViewB = historyTexB.createView();
    }

    getPrevView(): GPUTextureView {
        return this.ping === 1 ? this.historyViewA : this.historyViewB;
    }

    getOutputView(): GPUTextureView {
        return this.ping === 0 ? this.historyViewA : this.historyViewB;
    }

    execute(ctx: RenderContext): void {
        const encoder = ctx.encoder;

        const bindGroup = this.frameScope.track(
            ctx.device.createBindGroup({
                label: 'History Compute BG (frame)',
                layout: this.pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: this.sceneView },
                    { binding: 2, resource: this.getPrevView() },
                    { binding: 3, resource: this.getOutputView() },
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

        this.swapPingPong();
    }

    /**
     * Internal swap helper — call after compute writes to swap ping/pong.
     * Ensure views remain the same objects (no createView per-frame).
     */
    private swapPingPong(): void {
        this.ping = 1 - this.ping;
    }
}
