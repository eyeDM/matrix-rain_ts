/**
 * FrameUniforms
 *
 * Single uniform buffer updated once per frame.
 * Acts as the global clock & deterministic time source for all GPU logic.
 */

export type FrameUniforms = {
    buffer: GPUBuffer;
    staging: ArrayBuffer;
    update: (queue: GPUQueue, dt: number) => void;
};

export function createFrameUniforms(device: GPUDevice): FrameUniforms {
    // WGSL layout:
    // struct Frame {
    //   time: f32;
    //   dt: f32;
    //   frameIndex: u32;
    //   noisePhase: f32;
    // };

    const SIZE = 16; // Exact uniform buffer size of Frame without padding

    const NOISE_TIME_SCALE = 0.17;

    const buffer = device.createBuffer({
        size: SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'FrameUniforms',
    });

    const staging = new ArrayBuffer(SIZE);
    const f32 = new Float32Array(staging);
    const u32 = new Uint32Array(staging);

    let time = 0;
    let frameIndex = 0;

    return {
        buffer,
        staging,
        update(queue, dt) {
            time += dt;
            frameIndex++;

            f32[0] = time;
            f32[1] = dt;
            u32[2] = frameIndex;
            f32[3] = time * NOISE_TIME_SCALE;

            queue.writeBuffer(buffer, 0, staging);
        },
    };
}
