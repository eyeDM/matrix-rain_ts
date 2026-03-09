import { BlurParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

import { RenderContext } from '@gpu/render-graph';

const COLOR_FORMAT_HDR: GPUTextureFormat = 'rgba16float';

/**
 * Device-lifetime resources
 */
export type BlurDeviceResources = {
    readonly pipeline: GPURenderPipeline;
    readonly sampler: GPUSampler;
};

export function createBlurDeviceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    shader: GPUShaderModule,
): BlurDeviceResources {
    const bindGroupLayout = scope.track(
        device.createBindGroupLayout({
            label: 'Blur BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            ],
        })
    );

    const pipelineLayout = scope.track(
        device.createPipelineLayout({
            label: 'Blur Pipeline Layout',
            bindGroupLayouts: [bindGroupLayout],
        })
    );

    const pipeline = scope.track(
        device.createRenderPipeline({
            label: 'Blur Pipeline',
            layout: pipelineLayout,
            vertex: { module: shader, entryPoint: 'vs_main' },
            fragment: {
                module: shader,
                entryPoint: 'fs_main',
                targets: [{ format: COLOR_FORMAT_HDR }],
            },
            primitive: { topology: 'triangle-list' },
        })
    );

    const sampler = scope.track(
        device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        })
    );

    return { pipeline, sampler };
}

/**
 * Surface-lifetime resources
 */
export type BlurSurfaceResources = {
    readonly texTemp: GPUTexture;
    readonly texResult: GPUTexture;
    readonly bindGroupH: GPUBindGroup;
    readonly bindGroupV: GPUBindGroup;
};

export function createBlurSurfaceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    pipeline: GPURenderPipeline,
    sampler: GPUSampler,
    inputTex: GPUTexture,
    viewportWidth: number,
    viewportHeight: number,
): BlurSurfaceResources {
    const createBindGroup = (
        texture: GPUTexture,
        paramsBuffer: GPUBuffer,
    ): GPUBindGroup => {
        const bindGroupLayout = pipeline.getBindGroupLayout(0);
        return scope.track(
            device.createBindGroup({
                label: 'Blur Surface BG',
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: sampler },
                    { binding: 1, resource: texture.createView() },
                    { binding: 2, resource: { buffer: paramsBuffer } },
                ],
            })
        );
    }

    const createParamsBuffer = (label: string): GPUBuffer => {
        return scope.trackDestroyable(
            device.createBuffer({
                label: label,
                size: BlurParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );
    }

    const writeParamsBuffer = (
        dirX: number,
        dirY: number,
        texelSize: number,
        buffer: GPUBuffer,
    ): void => {
        const staging = new ArrayBuffer(BlurParamsLayout.SIZE);
        const view = new DataView(staging);
        view.setFloat32(BlurParamsLayout.offsets.dirX, dirX, true);
        view.setFloat32(BlurParamsLayout.offsets.dirY, dirY, true);
        view.setFloat32(BlurParamsLayout.offsets.texelSize, texelSize, true);
        device.queue.writeBuffer(buffer, 0, staging);
    };

    // render blur at lower resolution to save bandwidth (half-res)
    const BLUR_SCALE = 2; // 2 = half-res, 4 = quarter-res
    const blurW = Math.max(1, Math.floor(viewportWidth / BLUR_SCALE));
    const blurH = Math.max(1, Math.floor(viewportHeight / BLUR_SCALE));

    const createTexture = (label: string): GPUTexture => {
        return scope.trackDestroyable(
            device.createTexture({
                label: label,
                size: [blurW, blurH],
                format: COLOR_FORMAT_HDR,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            })
        );
    };

    const texTemp = createTexture('Blur Temporary Texture');
    const texResult = createTexture('Blur Result Texture');

    const blurParamsH = createParamsBuffer('Blur Params H');
    const blurParamsV = createParamsBuffer('Blur Params V');

    // write horizontal params: dir=(1,0)
    writeParamsBuffer(
        1.0,
        0.0,
        1.0 / viewportWidth, // texelSize for sampling the source scene texture (full-res)
        blurParamsH,
    );
    // write vertical params: dir=(0,1)
    writeParamsBuffer(
        0.0,
        1.0,
        1.0 / blurH, // vertical pass samples from the half-res intermediate, so texelSize must match its height
        blurParamsV,
    );

    const bindGroupH = createBindGroup(inputTex, blurParamsH);
    const bindGroupV = createBindGroup(texTemp, blurParamsV);

    return {
        texTemp,
        texResult,
        bindGroupH,
        bindGroupV,
    };
}

export class BlurPass {
    // cache view to avoid creating it every frame
    private readonly targetTexView: GPUTextureView;

    constructor(
        private readonly pipeline: GPURenderPipeline,
        private readonly bindGroup: GPUBindGroup,
        targetTex: GPUTexture,
    ) {
        this.targetTexView = targetTex.createView();
    }

    execute(ctx: RenderContext): void {
        const pass = ctx.encoder.beginRenderPass({
            colorAttachments: [{
                view: this.targetTexView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);

        pass.draw(3);
        pass.end();
    }
}
