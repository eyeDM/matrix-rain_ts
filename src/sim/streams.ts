import { ParamsLayout } from '../gpu/layouts';

export type StreamBuffers = {
    cols: number;
    rows: number;

    // GPU buffers
    frame: GPUBuffer;
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
    frameUniforms: GPUBuffer,
    glyphCount: number,
    cellWidth: number,
    cellHeight: number
): StreamBuffers {
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
        speeds[i] = 6.0 + Math.random() * 40.0; // cells per second
        lengths[i] = 3 + Math.floor(Math.random() * 20); // trail length
        seeds[i] = rndU32();
        columns[i] = i;
    }

    // Helper to create mapped GPUBuffer and initialize with typed array
    function createMappedBuffer(arr: ArrayBufferView, usage: GPUBufferUsageFlags): GPUBuffer {
        const byteLength = arr.byteLength;
        const buf = device.createBuffer({
            size: alignTo(byteLength, 4),
            usage: usage | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        const mapped = buf.getMappedRange();
        new (arr.constructor as any)(mapped).set(new (arr.constructor as any)(arr.buffer));
        buf.unmap();
        return buf;
    }

    // Note: GPUBuffer size must be aligned to 4 bytes; alignTo ensures that.
    function alignTo(n: number, align: number) {
        return ((n + align - 1) & ~(align - 1));
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

    function safeDestroy(buffer?: GPUBuffer) {
        if (!buffer) return;
        try {
            buffer.destroy();
        } catch {
            /* noop — buffer may already be destroyed */
        }
    }

    return {
        cols,
        rows,
        frame: frameUniforms,
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
