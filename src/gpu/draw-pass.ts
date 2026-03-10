import { ViewportParamsLayout, GlyphGridParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

import { RenderContext } from '@gpu/render-graph';

const COLOR_FORMAT_LDR: GPUTextureFormat = 'bgra8unorm-srgb';
const COLOR_FORMAT_HDR: GPUTextureFormat = 'rgba16float';

//
// @location(0) pos : vec2<f32>
// @location(1) uv  : vec2<f32>
//
const QuadVertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 4 * 4, // 4 floats * 4 bytes
    stepMode: 'vertex',
    attributes: [
        {
            shaderLocation: 0, // pos
            offset: 0,
            format: 'float32x2',
        },
        {
            shaderLocation: 1, // uv
            offset: 2 * 4,
            format: 'float32x2',
        },
    ],
};

/**
 * Device-lifetime resources
 */
export type DrawDeviceResources = {
    readonly vertexBuffer: GPUBuffer;
    readonly bindGroupLayout: GPUBindGroupLayout;
};

export function createDrawDeviceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    glyphUVsMinBindingSize: number,
): DrawDeviceResources {
    // --- Static quad geometry (cell-local space) ---

    const vertexData = new Float32Array([
        // posX, posY, uvU, uvV
        -0.5, -0.5, 0.0, 0.0,
         0.5, -0.5, 1.0, 0.0,
        -0.5,  0.5, 0.0, 1.0,

         0.5, -0.5, 1.0, 0.0,
         0.5,  0.5, 1.0, 1.0,
        -0.5,  0.5, 0.0, 1.0,
    ]);

    const vertexBuffer = scope.trackDestroyable(
        device.createBuffer({
            label: 'Quad Vertex Buffer',
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        })
    );

    new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
    vertexBuffer.unmap();

    const bindGroupLayout = scope.track(
        device.createBindGroupLayout({
            label: 'DrawPass BGL',
            entries: [
                /* --- ViewportParams uniform --- */
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                        type: 'uniform',
                        minBindingSize: ViewportParamsLayout.SIZE,
                    },
                },

                /* --- GlyphGridParams uniform --- */
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                        type: 'uniform',
                        minBindingSize: GlyphGridParamsLayout.SIZE,
                    },
                },

                /* --- ColumnState[] storage --- */
                {
                    binding: 2,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                        type: 'read-only-storage',
                        //minBindingSize: ColumnStateLayout.SIZE,
                    },
                },

                /* --- Glyph UV rects --- */
                {
                    binding: 3,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                        type: 'read-only-storage',
                        minBindingSize: glyphUVsMinBindingSize,
                    },
                },

                /* --- Atlas texture --- */
                {
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false,
                    },
                },

                /* --- Atlas sampler --- */
                {
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: 'filtering',
                    },
                },
            ],
        })
    );

    return { vertexBuffer, bindGroupLayout };
}

/**
 * Surface-lifetime resources
 */
export type DrawSurfaceResources = {
    readonly bindGroup: GPUBindGroup;
    readonly pipeline: GPURenderPipeline;
    readonly colorTex: GPUTexture;
    readonly brightTex: GPUTexture;
};

export function createDrawSurfaceResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    shader: GPUShaderModule,
    bindGroupLayout: GPUBindGroupLayout,
    resources: {
        atlasTextureView: GPUTextureView,
        atlasSampler: GPUSampler,
        glyphUVsBuffer: GPUBuffer,
        columnStateBuffer: GPUBuffer,
        viewportParamsBuffer: GPUBuffer,
        glyphGridParamsBuffer: GPUBuffer,
    },
    glyphUVsMinBindingSize: number,
    viewportWidth: number,
    viewportHeight: number,
): DrawSurfaceResources {
    const bindGroup = scope.track(
        device.createBindGroup({
            label: 'DrawPass Bind Group',
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: resources.viewportParamsBuffer,
                        offset: 0,
                        size: ViewportParamsLayout.SIZE,
                    },
                },
                {
                    binding: 1,
                    resource: {
                        buffer: resources.glyphGridParamsBuffer,
                        offset: 0,
                        size: GlyphGridParamsLayout.SIZE,
                    },
                },
                {
                    binding: 2,
                    resource: {
                        buffer: resources.columnStateBuffer,
                        offset: 0,
                        // size intentionally omitted:
                        // full buffer visible to shader
                    },
                },
                {
                    binding: 3,
                    resource: {
                        buffer: resources.glyphUVsBuffer,
                        offset: 0,
                        size: glyphUVsMinBindingSize,
                    },
                },
                {
                    binding: 4,
                    resource: resources.atlasTextureView,
                },
                {
                    binding: 5,
                    resource: resources.atlasSampler,
                },
            ],
        })
    );

    const pipelineLayout = scope.track(
        device.createPipelineLayout({
            label: 'DrawPass Pipeline Layout',
            bindGroupLayouts: [bindGroupLayout],
        })
    );

    const pipeline = scope.track(
        device.createRenderPipeline({
            label: 'Matrix Rain Render Pipeline',
            layout: pipelineLayout,
            vertex: {
                module: shader,
                entryPoint: 'vs_main',
                buffers: [QuadVertexBufferLayout],
            },
            fragment: {
                module: shader,
                entryPoint: 'fs_main',
                targets: [
                    // colorTex
                    {
                        format: COLOR_FORMAT_LDR,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                        },
                        writeMask: GPUColorWrite.ALL,
                    },
                    // brightTex
                    {
                        format: COLOR_FORMAT_HDR,
                        blend: {
                            color: {
                                srcFactor: 'one',
                                dstFactor: 'one',
                                operation: 'add',
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one',
                                operation: 'add',
                            },
                        },
                        writeMask: GPUColorWrite.ALL,
                    },
                ],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none',
                frontFace: 'ccw',
            },
            multisample: {
                count: 1,
            },
        })
    );

    // --- Color and Depth textures ---

    const colorTex = scope.trackDestroyable(
        device.createTexture({
            label: 'Draw Color Texture',
            size: [viewportWidth, viewportHeight],
            format: COLOR_FORMAT_LDR,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
    );
    const brightTex = scope.trackDestroyable(
        device.createTexture({
            label: 'Draw Bright Texture',
            size: [viewportWidth, viewportHeight],
            format: COLOR_FORMAT_HDR,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
    );

    return {
        bindGroup,
        pipeline,
        colorTex,
        brightTex,
    };
}

/**
 * Renders all glyph instances into an offscreen color target
 */
export class DrawPass {
    // cache view to avoid creating it every frame
    private readonly colorTexView: GPUTextureView;
    private readonly brightTexView: GPUTextureView;

    constructor(
        private readonly vertexBuffer: GPUBuffer,
        private readonly pipeline: GPURenderPipeline,
        private readonly bindGroup: GPUBindGroup,
        colorTex: GPUTexture,
        brightTex: GPUTexture,
        private readonly instanceCount: number,
    ) {
        this.colorTexView = colorTex.createView();
        this.brightTexView = brightTex.createView();
    }

    execute(ctx: RenderContext): void {
        const pass = ctx.encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.colorTexView,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
                {
                    view: this.brightTexView,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        });

        pass.setPipeline(this.pipeline);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setBindGroup(0, this.bindGroup);

        // 6 vertices = 2 triangles forming a quad;
        // instanced `instanceCount` times (one instance per glyph)
        pass.draw(6, this.instanceCount);
        pass.end();
    }
}
