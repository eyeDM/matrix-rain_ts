import { ScreenLayout } from '@platform/webgpu/layouts';

export class ScreenUniformController {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(device: GPUDevice) {
        this.buffer = device.createBuffer({
            label: 'Screen Uniform Buffer',
            size: ScreenLayout.SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.staging = new ArrayBuffer(ScreenLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    update(
        device: GPUDevice,
        width: number,
        height: number
    ): void {
        this.view.setFloat32(ScreenLayout.offsets.width, width, true);
        this.view.setFloat32(ScreenLayout.offsets.height, height, true);
        device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    destroy(): void {
        this.buffer.destroy();
    }
}
