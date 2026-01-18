import { SimulationUniformWriter } from '@engine/simulation/simulation-uniform-writer';

import { SimulationUniformLayout } from '@platform/webgpu/layouts';
import {GpuResourceScope} from "@platform/webgpu/resource-manager";

export type StreamBuffers = {
    cols: number;
    rows: number;

    // GPU buffers
    heads: GPUBuffer;   // array<f32> length = cols
    speeds: GPUBuffer;  // array<f32> length = cols
    lengths: GPUBuffer; // array<u32> length = cols
    seeds: GPUBuffer;   // array<u32> length = cols
    columns: GPUBuffer; // array<u32> length = cols (optional index buffer)
    energy: GPUBuffer;  // array<f32> length = cols
    simulationUniforms: GPUBuffer;
    simulationWriter: SimulationUniformWriter;

    writeFrame(dt: number): void;
    destroy(): void;
};

/**
 * Create and initialize storage buffers for the compute simulation.
 * This is an init-time operation only; no per-frame allocations are performed here.
 */
export function createStreamBuffers(
    device: GPUDevice,
    surfaceScope: GpuResourceScope,
    cols: number,
    rows: number,
    glyphCount: number,
    cellWidth: number,
    cellHeight: number,
    maxTrail: number,
): StreamBuffers {
    const MIN_SPEED_CELLS_PER_SEC = 6.0;
    const SPEED_VARIANCE = 40.0;
    const MIN_TRAIL_LENGTH = 3;
    const TRAIL_LENGTH_VARIANCE = 20;

    // Initialize CPU-side arrays
    const heads = new Float32Array(cols);
    const speeds = new Float32Array(cols);
    const lengths = new Uint32Array(cols);
    const seeds = new Uint32Array(cols);
    const columns = new Uint32Array(cols);
    const energy = new Float32Array(cols);

    // Populate with sensible defaults/random values
    const cryptoAvailable = typeof crypto !== 'undefined' && typeof (crypto as any).getRandomValues === 'function';
    const rndU32 = () => (cryptoAvailable
        ? (crypto as any).getRandomValues(new Uint32Array(1))[0]
        : Math.floor(Math.random() * 0xffffffff));

    for (let i = 0; i < cols; i++) {
        heads[i] = Math.random() * rows; // random starting head position
        speeds[i] = MIN_SPEED_CELLS_PER_SEC + Math.random() * SPEED_VARIANCE; // cells per second
        lengths[i] = MIN_TRAIL_LENGTH + Math.floor(Math.random() * TRAIL_LENGTH_VARIANCE); // trail length
        seeds[i] = rndU32();
        columns[i] = i;
        energy[i] = 0;
    }

    // WebGPU requires buffer sizes to be aligned to 4 bytes
    function alignTo4(n: number): number {
        return (n + 3) & ~3;
    }

    // Helper to create mapped GPUBuffer and initialize with typed array
    function createMappedBuffer(
        data: Float32Array | Uint32Array,
        usage: GPUBufferUsageFlags
    ): GPUBuffer {
        const buffer = surfaceScope.trackDestroyable(
            device.createBuffer({
                size: alignTo4(data.byteLength),
                usage: usage | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true,
            })
        );

        new (data.constructor as any)(buffer.getMappedRange()).set(data);
        buffer.unmap();
        return buffer;
    }

    function writeFrame(dt: number): void {
        simulationWriter.writeFrame(dt);
        simulationWriter.flush(device.queue, simulationUniforms);
    }

    function safeDestroy(buffer?: GPUBuffer): void {
        if (!buffer) return;
        try {
            buffer.destroy();
        } catch {
            /* buffer may already be destroyed */
        }
    }

    const headsBuf = createMappedBuffer(heads, GPUBufferUsage.STORAGE);
    const speedsBuf = createMappedBuffer(speeds, GPUBufferUsage.STORAGE);
    const lengthsBuf = createMappedBuffer(lengths, GPUBufferUsage.STORAGE);
    const seedsBuf = createMappedBuffer(seeds, GPUBufferUsage.STORAGE);
    const columnsBuf = createMappedBuffer(columns, GPUBufferUsage.STORAGE);
    const energyBuf = createMappedBuffer(energy, GPUBufferUsage.STORAGE);

    const simulationUniforms = device.createBuffer({
        label: 'SimulationUniforms',
        size: SimulationUniformLayout.SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const simulationWriter = new SimulationUniformWriter();
    simulationWriter.writeStatic(
        rows,
        cols,
        glyphCount,
        cellWidth,
        cellHeight,
        maxTrail
    );
    writeFrame(0.0);

    return {
        cols,
        rows,
        heads: headsBuf,
        speeds: speedsBuf,
        lengths: lengthsBuf,
        seeds: seedsBuf,
        columns: columnsBuf,
        energy: energyBuf,
        simulationUniforms,
        simulationWriter,

        writeFrame,
        destroy() {
            safeDestroy(headsBuf);
            safeDestroy(speedsBuf);
            safeDestroy(lengthsBuf);
            safeDestroy(seedsBuf);
            safeDestroy(columnsBuf);
            safeDestroy(energyBuf);
            safeDestroy(simulationUniforms);
        },
    };
}
