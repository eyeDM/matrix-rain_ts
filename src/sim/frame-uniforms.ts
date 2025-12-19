import { FrameLayout } from '../gpu/layouts';

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
    const NOISE_TIME_SCALE = 0.17;

    const buffer = device.createBuffer({
        size: FrameLayout.SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'FrameUniforms',
    });

    const staging = new ArrayBuffer(FrameLayout.SIZE);
    const view = new DataView(staging);

    let time = 0;
    let frameIndex = 0;

    return {
        buffer,
        staging,
        update(queue, dt) {
            time += dt;
            frameIndex++;

            view.setFloat32(FrameLayout.offsets.time, time, true);
            view.setFloat32(FrameLayout.offsets.dt, dt, true);
            view.setUint32(FrameLayout.offsets.frameIndex, frameIndex, true);
            view.setFloat32(FrameLayout.offsets.noisePhase, time * NOISE_TIME_SCALE, true);

            queue.writeBuffer(buffer, 0, staging);
        },
    };
}
