interface Destroyable {
    destroy(): void;
}

export class GpuResourceScope {
    private readonly tracked = new Set<object>();
    private readonly destroyable = new Set<Destroyable>();

    /**
     * @param {GPUBindGroup|GPUBindGroupLayout|GPUPipelineLayout|GPURenderPipeline|GPUComputePipeline|GPUShaderModule|GPUSampler|GPUTextureView} r
     */
    track<T extends object>(r: T): T {
        this.tracked.add(r);
        return r;
    }

    /**
     * @param {GPUBuffer|GPUTexture|GPUQuerySet} r
     */
    trackDestroyable<T extends Destroyable>(r: T): T {
        this.destroyable.add(r);
        this.tracked.add(r);
        return r;
    }

    destroyAll(): void {
        for (const r of this.destroyable) {
            r.destroy();
        }
        this.destroyable.clear();
        this.tracked.clear();
    }

    get size() {
        return {
            destroyable: this.destroyable.size,
            tracked: this.tracked.size,
        };
    }
}

export class GpuResources {
    readonly deviceScope = new GpuResourceScope();
    readonly surfaceScope = new GpuResourceScope();
    readonly frameScope = new GpuResourceScope();

    destroyAll(): void {
        this.frameScope.destroyAll();
        this.surfaceScope.destroyAll();
        this.deviceScope.destroyAll();
    }
}
