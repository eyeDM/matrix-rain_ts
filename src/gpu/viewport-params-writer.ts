import { ViewportParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

export type ViewportParams = {
    width: number;
    height: number;
}

export class ViewportParamsWriter {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            this.device.createBuffer({
                label: 'Viewport Params',
                size: ViewportParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(ViewportParamsLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    set(params: ViewportParams): void {
        this.view.setUint32(ViewportParamsLayout.offsets.width, params.width, true);
        this.view.setUint32(ViewportParamsLayout.offsets.height, params.height, true);
    }

    flush(): void {
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    /**
     * Called on screen resize.
     */
    update(params: ViewportParams): void {
        this.set(params);
        this.flush();
    }
}
