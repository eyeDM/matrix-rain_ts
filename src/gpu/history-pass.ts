import {
    ViewportParamsLayout,
    FrameParamsLayout,
    HistoryParamsLayout,
} from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

import { RenderContext } from '@gpu/render-graph';

const COLOR_FORMAT_HDR: GPUTextureFormat = 'rgba16float';

/**
 * These values MUST stay synchronized with the WGSL declaration:
 *
 *     @compute @workgroup_size(HISTORY_WORKGROUP_SIZE.x, HISTORY_WORKGROUP_SIZE.y)
 */
const HISTORY_WORKGROUP_SIZE = {
    x: 8,
    y: 8,
};

/**
 * Device-lifetime resources for the history accumulation compute pass.
 */
export type HistoryDeviceResources = {
    readonly pipeline: GPUComputePipeline;
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
                /* --- Scene texture --- */
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: 'unfilterable-float' },
                },

                /* --- prev texture --- */
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: 'unfilterable-float' },
                },

                /* --- dst texture storage --- */
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { access: 'write-only', format: COLOR_FORMAT_HDR },
                },

                /* --- ViewportParams uniform --- */
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        minBindingSize: ViewportParamsLayout.SIZE,
                    },
                },

                /* --- FrameParams uniform --- */
                {
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        minBindingSize: FrameParamsLayout.SIZE,
                    },
                },

                /* --- HistoryParams uniform --- */
                {
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        minBindingSize: HistoryParamsLayout.SIZE,
                    },
                },
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

    return { pipeline };
}

/**
 * Surface-lifetime resources
 */
export type HistorySurfaceResources = {
    readonly historyTexA: GPUTexture;
    readonly historyTexB: GPUTexture;
};


/**
 * Usage flags for temporal history buffers.
 *
 * Required capabilities:
 *
 * STORAGE_BINDING
 *   HistoryComputePass writes accumulated result.
 *
 * TEXTURE_BINDING
 *   HistoryComputePass reads previous frame.
 *   PresentPass samples history during final composition.
 *
 * Note:
 * COPY_SRC / COPY_DST intentionally omitted to prevent accidental
 * readbacks or staging copies that would stall the GPU pipeline.
 */
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

    // cached bind groups (ping / pong)
    private readonly bindGroupPing: GPUBindGroup;
    private readonly bindGroupPong: GPUBindGroup;

    private ping = 0;

    constructor(
        device: GPUDevice,
        surfaceScope: GpuResourceScope,
        private readonly pipeline: GPUComputePipeline,
        // scene texture produced by DrawPass
        sceneTex: GPUTexture,
        // history textures: allocate two textures and ping-pong between them
        historyTexA: GPUTexture,
        historyTexB: GPUTexture,
        private readonly viewportParamsBuffer: GPUBuffer,
        private readonly frameParamsBuffer: GPUBuffer,
        private readonly paramsBuffer: GPUBuffer,
        private readonly viewportWidth: number,
        private readonly viewportHeight: number,
    ) {
        this.sceneView = sceneTex.createView();
        this.historyViewA = historyTexA.createView();
        this.historyViewB = historyTexB.createView();

        const layout = this.pipeline.getBindGroupLayout(0);

        // ping = 0
        // prev = B
        // dst  = A
        this.bindGroupPing = surfaceScope.track(
            device.createBindGroup({
                label: 'History Compute BG (ping)',
                layout,
                entries: [
                    { binding: 0, resource: this.sceneView },
                    { binding: 1, resource: this.historyViewB },
                    { binding: 2, resource: this.historyViewA },
                    {
                        binding: 3,
                        resource: {
                            buffer: this.viewportParamsBuffer,
                            size: ViewportParamsLayout.SIZE,
                        }
                    },
                    {
                        binding: 4,
                        resource: {
                            buffer: this.frameParamsBuffer,
                            size: FrameParamsLayout.SIZE,
                        },
                    },
                    {
                        binding: 5,
                        resource: {
                            buffer: this.paramsBuffer,
                            size: HistoryParamsLayout.SIZE,
                        },
                    },
                ],
            })
        );

        // ping = 1
        // prev = A
        // dst  = B
        this.bindGroupPong = surfaceScope.track(
            device.createBindGroup({
                label: 'History Compute BG (pong)',
                layout,
                entries: [
                    { binding: 0, resource: this.sceneView },
                    { binding: 1, resource: this.historyViewA },
                    { binding: 2, resource: this.historyViewB },
                    {
                        binding: 3,
                        resource: {
                            buffer: this.viewportParamsBuffer,
                            size: ViewportParamsLayout.SIZE,
                        }
                    },
                    {
                        binding: 4,
                        resource: {
                            buffer: this.frameParamsBuffer,
                            size: FrameParamsLayout.SIZE,
                        },
                    },
                    {
                        binding: 5,
                        resource: {
                            buffer: this.paramsBuffer,
                            size: HistoryParamsLayout.SIZE,
                        },
                    },
                ],
            })
        );
    }

    getPrevView(): GPUTextureView {
        return this.ping === 1 ? this.historyViewA : this.historyViewB;
    }

    getOutputView(): GPUTextureView {
        return this.ping === 0 ? this.historyViewA : this.historyViewB;
    }

    execute(ctx: RenderContext): void {
        const encoder = ctx.encoder;

        const bindGroup =
            this.ping === 0
                ? this.bindGroupPing
                : this.bindGroupPong;

        const pass = encoder.beginComputePass();

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);

        // dispatch size: use 8x8 workgroups based on viewport size passed from the host
        const workX = Math.ceil(this.viewportWidth / HISTORY_WORKGROUP_SIZE.x);
        const workY = Math.ceil(this.viewportHeight / HISTORY_WORKGROUP_SIZE.y);

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
