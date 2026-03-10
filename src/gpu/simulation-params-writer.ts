import { SimulationParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

export type SimulationParams = {
    flickerAmplitude: number;
    flickerFrequency: number;
}

export class SimulationParamsWriter {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            device.createBuffer({
                label: 'SimulationParams Uniform Buffer',
                size: SimulationParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(SimulationParamsLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    set(params: SimulationParams): void {
        this.view.setFloat32(
            SimulationParamsLayout.offsets.flickerAmplitude,
            params.flickerAmplitude,
            true
        );
        this.view.setFloat32(
            SimulationParamsLayout.offsets.flickerFrequency,
            params.flickerFrequency,
            true
        );
    }

    /**
     * Upload current staging contents to GPU.
     * Caller controls when GPU queue write is issued.
     */
    flush(): void {
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    update(params: SimulationParams): void {
        this.set(params);
        this.flush();
    }
}
