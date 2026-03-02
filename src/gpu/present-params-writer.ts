import { PresentParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

export type PresentParams = {
    vignetteStrength: number;
    scanlineStrength: number;
    noiseAmplitude: number;
    curvature: number;
    tint: [number, number, number];
    scanlineFreq: number;
    bloomIntensity: number;
};

/**
 * Wrapper for present-stage uniform buffer.
 */
export class PresentParamsWriter {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            this.device.createBuffer({
                label: 'PresentParams Uniform Buffer',
                size: PresentParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(PresentParamsLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    set(params: PresentParams): void {
        this.view.setFloat32(PresentParamsLayout.offsets.vignetteStrength, params.vignetteStrength, true);
        this.view.setFloat32(PresentParamsLayout.offsets.scanlineFreq, params.scanlineFreq, true);
        this.view.setFloat32(PresentParamsLayout.offsets.scanlineStrength, params.scanlineStrength, true);
        this.view.setFloat32(PresentParamsLayout.offsets.noiseAmplitude, params.noiseAmplitude, true);
        this.view.setFloat32(PresentParamsLayout.offsets.curvature, params.curvature, true);
        this.view.setFloat32(PresentParamsLayout.offsets.tintR, params.tint[0], true);
        this.view.setFloat32(PresentParamsLayout.offsets.tintG, params.tint[1], true);
        this.view.setFloat32(PresentParamsLayout.offsets.tintB, params.tint[2], true);
        this.view.setFloat32(PresentParamsLayout.offsets.bloomIntensity, params.bloomIntensity, true);
    }

    flush(): void {
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    /**
     * Call after init and on canvas resize.
     */
    update(params: PresentParams): void {
        this.set(params);
        this.flush();
    }
}
