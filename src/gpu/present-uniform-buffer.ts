import { GpuResourceScope } from '@backend/resource-tracker';
import { PresentUniformLayout } from '@backend/layouts';

/**
 * Wrapper for present-stage uniform buffer.
 */
export class PresentUniformBuffer {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            this.device.createBuffer({
                label: 'Present Uniform Buffer',
                size: PresentUniformLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(PresentUniformLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    update(params: {
        width: number;
        height: number;
        time: number;
        vignetteStrength: number;
        scanlineStrength: number;
        noiseAmplitude: number;
        curvature: number;
        tint: [number, number, number];
        scanlineFreq: number;
        bloomIntensity: number;
    }): void {
        this.view.setFloat32(PresentUniformLayout.offsets.width, params.width, true);
        this.view.setFloat32(PresentUniformLayout.offsets.height, params.height, true);
        this.view.setFloat32(PresentUniformLayout.offsets.time, params.time, true);
        this.view.setFloat32(PresentUniformLayout.offsets.vignetteStrength, params.vignetteStrength, true);
        this.view.setFloat32(PresentUniformLayout.offsets.scanlineStrength, params.scanlineStrength, true);
        this.view.setFloat32(PresentUniformLayout.offsets.noiseAmplitude, params.noiseAmplitude, true);
        this.view.setFloat32(PresentUniformLayout.offsets.curvature, params.curvature, true);
        this.view.setFloat32(PresentUniformLayout.offsets.tintR, params.tint[0], true);
        this.view.setFloat32(PresentUniformLayout.offsets.tintG, params.tint[1], true);
        this.view.setFloat32(PresentUniformLayout.offsets.tintB, params.tint[2], true);
        this.view.setFloat32(PresentUniformLayout.offsets.scanlineFreq, params.scanlineFreq, true);
        this.view.setFloat32(PresentUniformLayout.offsets.bloomIntensity, params.bloomIntensity, true);

        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }
}
