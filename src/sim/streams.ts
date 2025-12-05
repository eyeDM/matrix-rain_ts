import type { AtlasResult } from '../engine/resources';

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
};

/**
 * Create and initialize storage buffers for the compute simulation.
 * This is an init-time operation only; no per-frame allocations are performed here.
 */
export function createStreamBuffers(device: GPUDevice, cols: number, rows: number, glyphCount: number, cellWidth: number, cellHeight: number): StreamBuffers {
  // Initialize CPU-side arrays
  const heads = new Float32Array(cols);
  const speeds = new Float32Array(cols);
  const lengths = new Uint32Array(cols);
  const seeds = new Uint32Array(cols);
  const columns = new Uint32Array(cols);

  // Populate with sensible defaults/random values
  const cryptoAvailable = typeof crypto !== 'undefined' && typeof (crypto as any).getRandomValues === 'function';
  const rnd = (n: number) => Math.random() * n;
  const rndU32 = () => (cryptoAvailable ? (crypto as any).getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 0xffffffff));

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
    const buf = device.createBuffer({ size: alignTo(byteLength, 4), usage: usage | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
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

  // Uniform params buffer layout (32 bytes):
  // [dt: f32, rows: u32, cols: u32, glyphCount: u32, cellWidth: f32, cellHeight: f32, pad0: vec2<f32>]
  const paramsBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const initParams = new ArrayBuffer(32);
  const f32v = new Float32Array(initParams);
  const u32v = new Uint32Array(initParams);
  f32v[0] = 0.0;        // dt
  u32v[1] = rows;
  u32v[2] = cols;
  u32v[3] = glyphCount;
  f32v[4] = cellWidth;
  f32v[5] = cellHeight;
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
    paramsStaging: initParams
  };
}

/**
 * Update the uniform params buffer with a new delta-time.
 * Call each frame before dispatching the compute pass to pass `dt`.
 */
export function updateParams(queue: GPUQueue, paramsBuffer: GPUBuffer, staging: ArrayBuffer, dt: number, rows: number, cols: number, glyphCount: number, cellWidth: number, cellHeight: number) {
  // Reuse provided staging ArrayBuffer to avoid per-frame allocations
  const f32 = new Float32Array(staging);
  const u32 = new Uint32Array(staging);
  f32[0] = dt;
  u32[1] = rows;
  u32[2] = cols;
  u32[3] = glyphCount;
  f32[4] = cellWidth;
  f32[5] = cellHeight;
  queue.writeBuffer(paramsBuffer, 0, staging);
}
