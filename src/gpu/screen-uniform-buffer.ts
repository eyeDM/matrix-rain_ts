import { ScreenLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

/**
 * ScreenUniformBuffer is a tiny wrapper around a GPU uniform buffer
 * that stores the canvas/screen size for shaders.
 * It creates a GPUBuffer of `ScreenLayout.SIZE`
 * and exposes `update(width, height)` which writes two f32s (width, height)
 * into the buffer.
 */
export class ScreenUniformBuffer {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            this.device.createBuffer({
                label: 'Screen Uniform Buffer',
                size: ScreenLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(ScreenLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    /**
     * Call after init and on canvas resize.
     */
    update(
        width: number,
        height: number,
    ): void {
        this.view.setFloat32(ScreenLayout.offsets.width, width, true);
        this.view.setFloat32(ScreenLayout.offsets.height, height, true);
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }
}
