import { RenderPass, PassKind } from '@engine/render/render-graph';
import { createStreamBuffers, StreamBuffers } from '@engine/simulation/streams';
import { createSimulationGraph } from '@engine/simulation/simulation-graph';

const WORKGROUP_SIZE_X = 64; // must match WGSL @workgroup_size

export type SimulationEngine = {
    readonly instanceBuffer: GPUBuffer;
    readonly computePass: {
        name: string;
        kind: PassKind;
        deps?: string[];
        execute(
            encoder: GPUCommandEncoder,
            _view: GPUTextureView,
            dt: number
        ): void;
    };
    destroy(): void;
};

type Params = {
    device: GPUDevice;
    shader: GPUShaderModule;
    glyphUVsBuffer: GPUBuffer;
    instanceBuffer: GPUBuffer;
    cols: number;
    rows: number;
    glyphCount: number;
    cellWidth: number;
    cellHeight: number;
    maxTrail: number;
};

export function createSimulationEngine(params: Params): SimulationEngine {
    const {
        device,
        shader,
        glyphUVsBuffer,
        instanceBuffer,
        cols,
        rows,
        glyphCount,
        cellWidth,
        cellHeight,
        maxTrail,
    } = params;

    const streams: StreamBuffers = createStreamBuffers(
        device,
        cols,
        rows,
        glyphCount,
        cellWidth,
        cellHeight,
        maxTrail
    );

    /** Persistent GPU resource – destroyed only on app shutdown */

    // --- Compute pipeline ---
    const bindGroupLayout = device.createBindGroupLayout({
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

    const pipeline = device.createComputePipeline({
        label: 'Matrix Simulation Pipeline',
        layout: device.createPipelineLayout({
            label: 'Simulation Pipeline Layout',
            bindGroupLayouts: [bindGroupLayout],
        }),
        compute: {
            module: shader,
            entryPoint: 'main',
        },
    });

    const bindGroup = device.createBindGroup({
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
            { binding: 7, resource: { buffer: glyphUVsBuffer } },
            { binding: 8, resource: { buffer: instanceBuffer } },
        ],
    });

    const simGraph = createSimulationGraph();

    simGraph.addPass({
        name: 'simulation-step',
        execute(encoder: GPUCommandEncoder) {
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(cols / WORKGROUP_SIZE_X));
            pass.end();
        },
    });

    const computePass: RenderPass = {
        name: 'matrix-compute',
        kind: 'compute' as PassKind,
        deps: [],
        execute(
            encoder: GPUCommandEncoder,
            _view: GPUTextureView,
            dt: number
        ): void {
            streams.simulationWriter.writeFrame(dt);
            streams.simulationWriter.flush(device.queue, streams.simulationUniforms);
            simGraph.execute(encoder);
        },
    };

    return {
        instanceBuffer,
        computePass,
        destroy(): void {
            streams.destroy();
        },
    };
}
