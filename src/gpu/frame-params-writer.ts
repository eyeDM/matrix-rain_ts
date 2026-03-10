import { FrameParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

export type FrameParams = {
    dt: number;
    time: number;
}

export class FrameParamsWriter {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            this.device.createBuffer({
                label: 'FrameParams Uniform Buffer',
                size: FrameParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(FrameParamsLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    set(params: FrameParams): void {
        this.view.setFloat32(FrameParamsLayout.offsets.dt, params.dt, true);
        this.view.setFloat32(FrameParamsLayout.offsets.time, params.time, true);
    }

    flush(): void {
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    /**
     * Called every frame.
     */
    update(params: FrameParams): void {
        this.set(params);
        this.flush();
    }
}
