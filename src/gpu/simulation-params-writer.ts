import { SimulationParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

export type SimulationSurfaceParams = {
    glyphCount: number;
    cellWidth: number;
    cellHeight: number;
    cols: number;
    rows: number;
    maxTrail: number;
};

export type SimulationFrameParams = {
    dt: number;
    time: number;
    flickerAmplitude: number;
    flickerFrequency: number;
};

/**
 * CPU-side writer for `SimulationParams`.
 * Owns the full layout and guarantees a single upload per frame.
 */
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

    /**
     * Set all static (rarely changing) parameters.
     * Intended for init-time or resize-time updates.
     */
    setSurfaceParams(params: SimulationSurfaceParams): void {
        this.view.setUint32(SimulationParamsLayout.offsets.glyphCount, params.glyphCount, true);
        this.view.setFloat32(SimulationParamsLayout.offsets.cellWidth, params.cellWidth, true);
        this.view.setFloat32(SimulationParamsLayout.offsets.cellHeight, params.cellHeight, true);
        this.view.setUint32(SimulationParamsLayout.offsets.cols, params.cols, true);
        this.view.setUint32(SimulationParamsLayout.offsets.rows, params.rows, true);
        this.view.setUint32(SimulationParamsLayout.offsets.maxTrail, params.maxTrail, true);
    }

    /**
     * Set per-frame parameters.
     */
    setFrameParams(params: SimulationFrameParams): void {
        this.view.setFloat32(SimulationParamsLayout.offsets.dt, params.dt, true);
        this.view.setFloat32(SimulationParamsLayout.offsets.time, params.time, true);
        this.view.setFloat32(SimulationParamsLayout.offsets.flickerAmplitude, params.flickerAmplitude, true);
        this.view.setFloat32(SimulationParamsLayout.offsets.flickerFrequency, params.flickerFrequency, true);
    }

    /**
     * Upload current staging contents to GPU.
     * Caller controls when GPU queue write is issued.
     */
    flush(): void {
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }
}
