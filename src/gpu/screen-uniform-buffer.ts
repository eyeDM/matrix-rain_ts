import { ScreenLayout } from '@backend/layouts';

export class ScreenUniformBuffer {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(private readonly device: GPUDevice) {
        this.buffer = this.device.createBuffer({
            label: 'Screen Uniform Buffer',
            size: ScreenLayout.SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.staging = new ArrayBuffer(ScreenLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    update(
        width: number,
        height: number
    ): void {
        this.view.setFloat32(ScreenLayout.offsets.width, width, true);
        this.view.setFloat32(ScreenLayout.offsets.height, height, true);
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    destroy(): void {
        this.buffer.destroy();
    }
}
