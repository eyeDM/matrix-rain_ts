export type TrackedResource = GPUBuffer | GPUTexture | GPUSampler | GPUBindGroup | GPURenderPipeline | GPUComputePipeline | GPUShaderModule;

export class ResourceManager {
    private device: GPUDevice;
    private resources = new Set<TrackedResource>();

    constructor(device: GPUDevice) {
        this.device = device;
    }

    track(r: TrackedResource | null | undefined) {
        if (!r) return;
        this.resources.add(r);
    }

    createBuffer(desc: GPUBufferDescriptor) {
        const b = this.device.createBuffer(desc);
        this.resources.add(b);
        return b;
    }

    createTexture(desc: GPUTextureDescriptor) {
        const t = this.device.createTexture(desc);
        this.resources.add(t);
        return t;
    }

    createSampler(desc: GPUSamplerDescriptor) {
        const s = this.device.createSampler(desc);
        this.resources.add(s);
        return s;
    }

    createShaderModule(desc: GPUShaderModuleDescriptor) {
        const m = this.device.createShaderModule(desc);
        this.resources.add(m as GPUShaderModule);
        return m;
    }

    createComputePipeline(desc: GPUComputePipelineDescriptor) {
        const p = this.device.createComputePipeline(desc);
        this.resources.add(p as unknown as GPUComputePipeline);
        return p;
    }

    createRenderPipeline(desc: GPURenderPipelineDescriptor) {
        const p = this.device.createRenderPipeline(desc);
        this.resources.add(p as unknown as GPURenderPipeline);
        return p;
    }

    createBindGroup(desc: GPUBindGroupDescriptor) {
        const bg = this.device.createBindGroup(desc);
        this.resources.add(bg);
        return bg;
    }

    destroyAll() {
        for (const r of this.resources) {
            try {
                if (r && typeof (r as any).destroy === 'function') (r as any).destroy();
            } catch (e) {
                /* ignore */
            }
        }
        this.resources.clear();
    }
}

export function createResourceManager(device: GPUDevice) {
    return new ResourceManager(device);
}
