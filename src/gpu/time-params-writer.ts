import { TimeParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

export type TimeParams = {
    dt: number;
    pt: number;
}

export class TimeParamsWriter {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            this.device.createBuffer({
                label: 'Time Params',
                size: TimeParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(TimeParamsLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    set(params: TimeParams): void {
        this.view.setFloat32(TimeParamsLayout.offsets.dt, params.dt, true);
        this.view.setFloat32(TimeParamsLayout.offsets.pt, params.pt, true);
    }

    flush(): void {
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    /**
     * Called every frame.
     */
    update(params: TimeParams): void {
        this.set(params);
        this.flush();
    }
}
