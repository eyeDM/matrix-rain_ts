import { DrawParamsLayout, ColumnStateLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

import { RenderContext } from '@gpu/render-graph';

const WORKGROUP_SIZE_X = 64; // must match WGSL @workgroup_size

/**
 * Device-lifetime resources
 */
export type SimulationDeviceResources = {
    readonly pipeline: GPUComputePipeline;
};

export function createSimulationDeviceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    shader: GPUShaderModule,
): SimulationDeviceResources {
    const bindGroupLayout: GPUBindGroupLayout = scope.track(
        device.createBindGroupLayout({
            label: 'SimulationComputePass BGL',
            entries: [
                /* ---------- binding 0: ColumnState[] ---------- */
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'storage', // read_write
                        minBindingSize: ColumnStateLayout.SIZE,
                    },
                },

                /* ---------- binding 1: DrawParams ---------- */
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        minBindingSize: DrawParamsLayout.SIZE,
                    },
                },
            ],
        })
    );

    const pipelineLayout: GPUPipelineLayout = scope.track(
        device.createPipelineLayout({
            label: 'Simulation Compute Pipeline Layout',
            bindGroupLayouts: [bindGroupLayout],
        })
    );

    const pipeline: GPUComputePipeline = scope.track(
        device.createComputePipeline({
            label: 'Simulation Compute Pipeline',
            layout: pipelineLayout,
            compute: {
                module: shader,
                entryPoint: 'main',
            },
        })
    );

    return { pipeline };
}

/**
 * Surface-lifetime resources
 */
export type SimulationSurfaceResources = {
    readonly bindGroup: GPUBindGroup;
};

export function createSimulationSurfaceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    pipeline: GPUComputePipeline,
    resources: {
        atlasSampler: GPUSampler,
        atlasTextureView: GPUTextureView,
        drawParamsBuffer: GPUBuffer,
        columnStateBuffer: GPUBuffer,
        glyphUVsBuffer: GPUBuffer,
    },
): SimulationSurfaceResources {
    const bindGroup = scope.track(
        device.createBindGroup({
            label: 'Simulation Bind Group',
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: resources.columnStateBuffer,
                        offset: 0,
                    },
                },
                {
                    binding: 1,
                    resource: {
                        buffer: resources.drawParamsBuffer,
                        offset: 0,
                        size: DrawParamsLayout.SIZE,
                    },
                },
            ],
        })
    );

    return { bindGroup };
}

export class SimulationComputePass {
    constructor(
        private readonly pipeline: GPUComputePipeline,
        private readonly bindGroup: GPUBindGroup,
        private readonly cols: number,
    ) {}

    execute(ctx: RenderContext): void {
        const pass = ctx.encoder.beginComputePass();

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        const groups = Math.ceil(this.cols / WORKGROUP_SIZE_X);
        pass.dispatchWorkgroups(groups);

        pass.end();
    }
}
