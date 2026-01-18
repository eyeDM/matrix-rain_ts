import { InstanceLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

import { RenderContext } from '@gpu/render-graph';
import { StreamBuffers, createStreamBuffers } from '@gpu/streams';

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
    const bindGroupLayout = scope.track(
        device.createBindGroupLayout({
            label: 'Simulation BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },  // SimulationUniforms
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },  // Columns
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Seeds
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Heads
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Speeds
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Lengths
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Energy
                { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },  // GlyphUVs
                { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // InstanceData
            ],
        })
    );

    const pipelineLayout = scope.track(
        device.createPipelineLayout({
            label: 'Simulation Pipeline Layout',
            bindGroupLayouts: [bindGroupLayout],
        })
    );

    const pipeline = scope.track(
        device.createComputePipeline({
            label: 'Matrix Rain Simulation Pipeline',
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
    readonly instanceBuffer: GPUBuffer;
    readonly streamBuffers: StreamBuffers;
    readonly bindGroup: GPUBindGroup;
};

export function createSimulationSurfaceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    pipeline: GPUComputePipeline,
    glyphUVsBuffer: GPUBuffer,
    glyphCount: number,
    cellWidth: number,
    cellHeight: number,
    cols: number,
    rows: number,
    maxTrail: number,
    instancesCount: number,
): SimulationSurfaceResources {
    // streamBuffers is columns properties; streamBuffers.columns хранит индекс столбца
    const streamBuffers: StreamBuffers = createStreamBuffers(
        device,
        scope,
        cols,
        rows,
        glyphCount,
        cellWidth,
        cellHeight,
        maxTrail,
    );

    /**
     * Define a GPU buffer specifically for holding instance data (InstanceData[] in WGSL).
     * This buffer acts as the output target for the Compute Shader and the input source
     * for the Render (Draw) Shader.
     */
    const instanceBuffer: GPUBuffer = scope.trackDestroyable(
        device.createBuffer({
            size: instancesCount * InstanceLayout.SIZE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
        })
    );

    const bindGroup = scope.track(
        device.createBindGroup({
            label: 'Simulation Bind Group',
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: streamBuffers.simulationUniforms } },
                { binding: 1, resource: { buffer: streamBuffers.indexes } },
                { binding: 2, resource: { buffer: streamBuffers.seeds } },
                { binding: 3, resource: { buffer: streamBuffers.heads } },
                { binding: 4, resource: { buffer: streamBuffers.speeds } },
                { binding: 5, resource: { buffer: streamBuffers.lengths } },
                { binding: 6, resource: { buffer: streamBuffers.energy } },
                { binding: 7, resource: { buffer: glyphUVsBuffer } },
                { binding: 8, resource: { buffer: instanceBuffer } },
            ],
        })
    );

    return { instanceBuffer, streamBuffers, bindGroup };
}

export class SimulationComputePass {
    constructor(
        private readonly pipeline: GPUComputePipeline,
        private readonly streamBuffers: StreamBuffers,
        private readonly bindGroup: GPUBindGroup,
        private readonly cols: number,
    ) {}

    execute(ctx: RenderContext): void {
        this.streamBuffers.writeFrame(ctx.dt);

        const pass = ctx.encoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.cols / WORKGROUP_SIZE_X),
        );
        pass.end();
    }
}
