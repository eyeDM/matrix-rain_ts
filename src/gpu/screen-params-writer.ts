import { CanvasParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

export type ScreenParams = {
    width: number;
    height: number;
};

/**
 * Wrapper around a GPU uniform buffer that stores
 * the canvas/screen size for shaders.
 * It creates a GPUBuffer of `CanvasParamsLayout.SIZE`
 * and exposes `update({width, height})` which writes two f32s (width, height)
 * into the buffer.
 */
export class ScreenParamsWriter {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            this.device.createBuffer({
                label: 'CanvasParams Uniform Buffer',
                size: CanvasParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(CanvasParamsLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    set(params: ScreenParams): void {
        this.view.setFloat32(CanvasParamsLayout.offsets.width, params.width, true);
        this.view.setFloat32(CanvasParamsLayout.offsets.height, params.height, true);
    }

    flush(): void {
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    /**
     * Call after init and on canvas resize.
     */
    update(params: ScreenParams): void {
        this.set(params);
        this.flush();
    }
}
