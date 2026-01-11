import { RenderContext } from '@engine/render/render-graph';
import { createInstanceBuffer } from '@engine/render/resources';
import { createStreamBuffers, StreamBuffers } from '@engine/simulation/streams';

const WORKGROUP_SIZE_X = 64; // must match WGSL @workgroup_size

export type SimulationEngine = {
    readonly instances: GPUBuffer;
    execute(ctx: RenderContext): void;
    destroy(): void; // Destroy internally created GPU resources
};

export function createSimulationEngine(params: {
    device: GPUDevice;
    shader: GPUShaderModule;
    glyphUVsBuffer: GPUBuffer;
    cols: number;
    rows: number;
    glyphCount: number;
    cellWidth: number;
    cellHeight: number;
    maxTrail: number;
}): SimulationEngine {
    const streams: StreamBuffers = createStreamBuffers(
        params.device,
        params.cols,
        params.rows,
        params.glyphCount,
        params.cellWidth,
        params.cellHeight,
        params.maxTrail
    );

    const instances: GPUBuffer = createInstanceBuffer(
        params.device,
        params.cols * params.maxTrail
    );

    /** Persistent GPU resource – destroyed only on app shutdown */

    // --- Compute pipeline ---

    const bindGroupLayout = params.device.createBindGroupLayout({
        label: 'Simulation BGL',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },  // SimulationUniforms
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Heads
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Speeds
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Lengths
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Seeds
            { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },  // Columns
            { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Energy
            { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },  // GlyphUVs
            { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // InstanceData
        ],
    });

    const pipeline = params.device.createComputePipeline({
        label: 'Matrix Simulation Pipeline',
        layout: params.device.createPipelineLayout({
            label: 'Simulation Pipeline Layout',
            bindGroupLayouts: [bindGroupLayout],
        }),
        compute: {
            module: params.shader,
            entryPoint: 'main',
        },
    });

    const bindGroup = params.device.createBindGroup({
        label: 'Simulation Bind Group',
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: streams.simulationUniforms } },
            { binding: 1, resource: { buffer: streams.heads } },
            { binding: 2, resource: { buffer: streams.speeds } },
            { binding: 3, resource: { buffer: streams.lengths } },
            { binding: 4, resource: { buffer: streams.seeds } },
            { binding: 5, resource: { buffer: streams.columns } },
            { binding: 6, resource: { buffer: streams.energy } },
            { binding: 7, resource: { buffer: params.glyphUVsBuffer } },
            { binding: 8, resource: { buffer: instances } },
        ],
    });

    function execute(ctx: RenderContext): void {
        streams.simulationWriter.writeFrame(ctx.dt);
        streams.simulationWriter.flush(params.device.queue, streams.simulationUniforms);

        const pass = ctx.encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(params.cols / WORKGROUP_SIZE_X),
        );
        pass.end();
    }

    return {
        instances,
        execute,
        destroy(): void {
            instances.destroy();
            streams.destroy();
        },
    };
}
