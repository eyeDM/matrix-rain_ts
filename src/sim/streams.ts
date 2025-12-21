import { ParamsLayout } from '../gpu/layouts';

export type StreamBuffers = {
    cols: number;
    rows: number;

    // GPU buffers
    heads: GPUBuffer;   // array<f32> length = cols
    speeds: GPUBuffer;  // array<f32> length = cols
    lengths: GPUBuffer; // array<u32> length = cols
    seeds: GPUBuffer;   // array<u32> length = cols
    columns: GPUBuffer; // array<u32> length = cols (optional index buffer)
    params: GPUBuffer;  // uniform buffer containing dt, rows, cols
    paramsStaging: ArrayBuffer; // preallocated staging buffer for params (reuse to avoid per-frame alloc)

    destroy(): void;
};

/**
 * Create and initialize storage buffers for the compute simulation.
 * This is an init-time operation only; no per-frame allocations are performed here.
 */
export function createStreamBuffers(
    device: GPUDevice,
    cols: number,
    rows: number,
    glyphCount: number,
    cellWidth: number,
    cellHeight: number
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
        const buffer = device.createBuffer({
            size: alignTo4(data.byteLength),
            usage: usage | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });

        new (data.constructor as any)(buffer.getMappedRange()).set(data);
        buffer.unmap();
        return buffer;
    }

    function safeDestroy(buffer?: GPUBuffer): void {
        if (!buffer) return;
        try {
            buffer.destroy();
        } catch {
            /* noop — buffer may already be destroyed */
        }
    }

    const headsBuf = createMappedBuffer(heads, GPUBufferUsage.STORAGE);
    const speedsBuf = createMappedBuffer(speeds, GPUBufferUsage.STORAGE);
    const lengthsBuf = createMappedBuffer(lengths, GPUBufferUsage.STORAGE);
    const seedsBuf = createMappedBuffer(seeds, GPUBufferUsage.STORAGE);
    const columnsBuf = createMappedBuffer(columns, GPUBufferUsage.STORAGE);

    // Uniform params buffer layout
    const paramsBuf = device.createBuffer({
        size: ParamsLayout.SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const initParams = new ArrayBuffer(ParamsLayout.SIZE);
    const view = new DataView(initParams);
    view.setFloat32(ParamsLayout.offsets.dt, 0.0, true);
    view.setUint32(ParamsLayout.offsets.rows, rows, true);
    view.setUint32(ParamsLayout.offsets.cols, cols, true);
    view.setUint32(ParamsLayout.offsets.glyphCount, glyphCount, true);
    view.setFloat32(ParamsLayout.offsets.cellWidth, cellWidth, true);
    view.setFloat32(ParamsLayout.offsets.cellHeight, cellHeight, true);
    // pad left zeroed
    device.queue.writeBuffer(paramsBuf, 0, initParams);

    return {
        cols,
        rows,
        heads: headsBuf,
        speeds: speedsBuf,
        lengths: lengthsBuf,
        seeds: seedsBuf,
        columns: columnsBuf,
        params: paramsBuf,
        paramsStaging: initParams,

        destroy() {
            safeDestroy(headsBuf);
            safeDestroy(speedsBuf);
            safeDestroy(lengthsBuf);
            safeDestroy(seedsBuf);
            safeDestroy(columnsBuf);
            safeDestroy(paramsBuf);
        },
    };
}

/**
 * Update the uniform params buffer with a new delta-time.
 * Call each frame before dispatching the compute pass to pass `dt`.
 */
export function updateParamsStatic(
    queue: GPUQueue,
    paramsBuffer: GPUBuffer,
    staging: ArrayBuffer,
    rows: number,
    cols: number,
    glyphCount: number,
    cellWidth: number,
    cellHeight: number
): void {
    // Reuse provided staging ArrayBuffer to avoid per-frame allocations
    const view = new DataView(staging);
    view.setFloat32(ParamsLayout.offsets.dt, 0.0, true);
    view.setUint32(ParamsLayout.offsets.rows, rows, true);
    view.setUint32(ParamsLayout.offsets.cols, cols, true);
    view.setUint32(ParamsLayout.offsets.glyphCount, glyphCount, true);
    view.setFloat32(ParamsLayout.offsets.cellWidth, cellWidth, true);
    view.setFloat32(ParamsLayout.offsets.cellHeight, cellHeight, true);
    queue.writeBuffer(paramsBuffer, 0, staging);
}
