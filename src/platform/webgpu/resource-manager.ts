/**
 * Deterministic lifetime manager for explicit-destroy WebGPU resources.
 *
 * Responsibilities:
 * - Owns GPU resources that require manual `.destroy()` (e.g. GPUBuffer, GPUTexture)
 * - Provides a single, explicit teardown point via `destroyAll()`
 * - Enforces a clear ownership scope for GPU memory allocations
 *
 * Non-responsibilities:
 * - Does NOT manage logical lifetime or usage of resources
 * - Does NOT track non-destroyable GPU objects (pipelines, bind groups, shader modules)
 * - Does NOT guarantee cleanup on browser tab close (best-effort only)
 *
 * Intended usage:
 * - Scene-level or subsystem-level GPU memory ownership
 * - Explicit teardown during controlled application shutdown, hot-reload, or scene reset
 */

export type DestroyableResource = {
    destroy(): void;
};

export class ResourceManager {
    private readonly tracked: DestroyableResource[] = [];
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
    track<T extends DestroyableResource>(resource: T): T {
        this.assertAlive();
        this.tracked.push(resource);
        return resource;
    }

    // --- Convenience factory helpers ---

    createBuffer(desc: GPUBufferDescriptor): GPUBuffer {
        return this.track(
            this.device.createBuffer(desc)
        );
    }

    createTexture(desc: GPUTextureDescriptor): GPUTexture {
        return this.track(
            this.device.createTexture(desc)
        );
    }

    /**
     * End of ownership scope.
     * Explicitly destroys all destroyable resources and
     * releases all ownership tracking.
     */
    destroyAll(): void {
        if (this.destroyed) return;

        for (const r of this.tracked) {
            r.destroy();
        }

        this.tracked.length = 0;
        this.destroyed = true;
    }
}
