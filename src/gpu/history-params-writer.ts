import { HistoryParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

export type HistoryParams = {
    retention: number;
};

/**
 * CPU-side writer for `HistoryParams`.
 */
export class HistoryParamsWriter {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            this.device.createBuffer({
                label: 'HistoryParams Uniform Buffer',
                size: HistoryParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(HistoryParamsLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    set(params: HistoryParams): void {
        this.view.setFloat32(
            HistoryParamsLayout.offsets.retention,
            params.retention,
            true
        );
    }

    flush(): void {
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    update(params: HistoryParams): void {
        this.set(params);
        this.flush();
    }
}
