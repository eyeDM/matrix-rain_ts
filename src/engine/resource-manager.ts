/**
 * Type-safe GPU resource ownership manager.
 * Separates ownership tracking from explicit GPU destruction.
 */

export type DestroyableResource = {
    destroy(): void;
};

export class ResourceManager {
    private readonly destroyables: DestroyableResource[] = [];
    private readonly tracked: unknown[] = [];
    private destroyed = false;

    constructor(private readonly device: GPUDevice) {}

    /** Internal invariants */
    private assertAlive(): void {
        if (this.destroyed) {
            throw new Error('ResourceManager: cannot track resources after destroyAll()');
        }
    }

    /**
     * Track a GPU resource that requires explicit .destroy().
     * Typical examples: GPUBuffer, GPUTexture, GPUSampler.
     */
    trackDestroyable<T extends DestroyableResource>(resource: T): T {
        this.assertAlive();
        this.destroyables.push(resource);
        this.tracked.push(resource);
        return resource;
    }

    /**
     * Track an owned GPU object that does NOT require explicit destruction.
     * Typical examples: pipelines, bind groups, shader modules.
     */
    track<T>(resource: T): T {
        this.assertAlive();
        this.tracked.push(resource);
        return resource;
    }

    // ─────────────────────────────────────────────────────────────
    // Convenience factory helpers
    // ─────────────────────────────────────────────────────────────

    createBuffer(desc: GPUBufferDescriptor): GPUBuffer {
        return this.trackDestroyable(
            this.device.createBuffer(desc)
        );
    }

    createTexture(desc: GPUTextureDescriptor): GPUTexture {
        return this.trackDestroyable(
            this.device.createTexture(desc)
        );
    }

    createSampler(desc: GPUSamplerDescriptor): GPUSampler {
        return this.track(
            this.device.createSampler(desc)
        );
    }

    createShaderModule(desc: GPUShaderModuleDescriptor): GPUShaderModule {
        return this.track(
            this.device.createShaderModule(desc)
        );
    }

    createBindGroup(desc: GPUBindGroupDescriptor): GPUBindGroup {
        return this.track(
            this.device.createBindGroup(desc)
        );
    }

    createComputePipeline(desc: GPUComputePipelineDescriptor): GPUComputePipeline {
        return this.track(
            this.device.createComputePipeline(desc)
        );
    }

    createRenderPipeline(desc: GPURenderPipelineDescriptor): GPURenderPipeline {
        return this.track(
            this.device.createRenderPipeline(desc)
        );
    }

    /**
     * End of ownership scope.
     * Explicitly destroys all destroyable resources and
     * releases all ownership tracking.
     */
    destroyAll(): void {
        if (this.destroyed) return;

        for (const r of this.destroyables) {
            r.destroy();
        }

        this.destroyables.length = 0;
        this.tracked.length = 0;
        this.destroyed = true;
    }
}

export function createResourceManager(device: GPUDevice): ResourceManager {
    return new ResourceManager(device);
}
