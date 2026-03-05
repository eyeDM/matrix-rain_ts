import { DrawParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

export type DrawParams = {
    cellWidth: number;
    cellHeight: number;
    atlasWidth: number;
    atlasHeight: number;
    glyphCount: number;

    canvasWidth: number;
    canvasHeight: number;
    gridCols: number;
    gridRows: number;
    maxTrail: number;

    flickerAmplitude: number;
    flickerFrequency: number;
}

/**
 * CPU-side writer for `DrawParams`.
 * Owns the full layout and guarantees a single upload per frame.
 */
export class DrawParamsWriter {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly viewF32: Float32Array;
    private readonly viewU32: Uint32Array;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            device.createBuffer({
                label: 'DrawParams Uniform Buffer',
                size: DrawParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(DrawParamsLayout.SIZE);
        this.viewF32 = new Float32Array(this.staging);
        this.viewU32 = new Uint32Array(this.staging);
    }

    /**
     * Set all Surface-Lifetime parameters.
     * Intended for init-time or resize-time updates.
     */
    set(params: DrawParams): void {
        this.viewF32[DrawParamsLayout.offsets.cellSize / 4] =
            params.cellWidth;
        this.viewF32[DrawParamsLayout.offsets.cellSize / 4 + 1] =
            params.cellHeight;

        this.viewF32[DrawParamsLayout.offsets.atlasTexelSize / 4] =
            1.0 / params.atlasWidth;
        this.viewF32[DrawParamsLayout.offsets.atlasTexelSize / 4 + 1] =
            1.0 / params.atlasHeight;

        this.viewU32[DrawParamsLayout.offsets.glyphCount / 4] =
            params.glyphCount;

        this.viewF32[DrawParamsLayout.offsets.canvasSize / 4] =
            params.canvasWidth;
        this.viewF32[DrawParamsLayout.offsets.canvasSize / 4 + 1] =
            params.canvasHeight;

        this.viewU32[DrawParamsLayout.offsets.cols / 4] =
            params.gridCols;
        this.viewU32[DrawParamsLayout.offsets.rows / 4] =
            params.gridRows;

        this.viewU32[DrawParamsLayout.offsets.maxTrail / 4] =
            params.maxTrail;

        this.viewF32[DrawParamsLayout.offsets.flickerAmplitude / 4] =
            params.flickerAmplitude;
        this.viewF32[DrawParamsLayout.offsets.flickerFrequency / 4] =
            params.flickerFrequency;
    }

    /**
     * Upload current staging contents to GPU.
     * Caller controls when GPU queue write is issued.
     */
    flush(): void {
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    update(params: DrawParams): void {
        this.set(params);
        this.flush();
    }
}
