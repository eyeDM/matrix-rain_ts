export type ResourceName = string;

export type BufferResourceDesc = {
    readonly kind: 'buffer';
    readonly desc: GPUBufferDescriptor;
};

export type TextureResourceDesc = {
    readonly kind: 'texture';
    readonly desc: GPUTextureDescriptor;
};

export type SamplerResourceDesc = {
    readonly kind: 'sampler';
    readonly desc: GPUSamplerDescriptor;
};

export type ResourceDescriptor =
    | BufferResourceDesc
    | TextureResourceDesc
    | SamplerResourceDesc;

/**
 * Declarative registry of GPU resource descriptors.
 *
 * Responsibilities:
 * - Stores resource descriptors by name
 * - Enforces uniqueness and deterministic order
 * - Provides an immutable snapshot after freeze()
 *
 * Non-responsibilities:
 * - Does NOT create GPU resources
 * - Does NOT destroy GPU resources
 * - Does NOT depend on GPUDevice
 */
export class ResourceRegistry {
    private readonly resources = new Map<ResourceName, ResourceDescriptor>();
    private frozen = false;

    // --- Internal guards ---

    private assertMutable(): void {
        if (this.frozen) {
            throw new Error('ResourceRegistry is frozen and cannot be modified');
        }
    }

    private assertUnique(name: ResourceName): void {
        if (this.resources.has(name)) {
            throw new Error(`Resource '${name}' is already declared`);
        }
    }

    private assertExists(name: ResourceName): void {
        if (!this.resources.has(name)) {
            throw new Error(`Resource '${name}' is not declared`);
        }
    }

    // --- Adders ---

    addBuffer(name: ResourceName, desc: GPUBufferDescriptor): void {
        this.assertMutable();
        this.assertUnique(name);

        this.resources.set(name, {
            kind: 'buffer',
            desc: Object.freeze({ ...desc }),
        });
    }

    addTexture(name: ResourceName, desc: GPUTextureDescriptor): void {
        this.assertMutable();
        this.assertUnique(name);

        this.resources.set(name, {
            kind: 'texture',
            desc: Object.freeze({ ...desc }),
        });
    }

    addSampler(name: ResourceName, desc: GPUSamplerDescriptor): void {
        this.assertMutable();
        this.assertUnique(name);

        this.resources.set(name, {
            kind: 'sampler',
            desc: Object.freeze({ ...desc }),
        });
    }

    // --- Getters ---

    get(name: ResourceName): ResourceDescriptor {
        this.assertExists(name);
        return this.resources.get(name)!;
    }

    has(name: ResourceName): boolean {
        return this.resources.has(name);
    }

    /**
     * Returns all declared resources in deterministic (insertion) order.
     */
    entries(): Iterable<readonly [ResourceName, ResourceDescriptor]> {
        return this.resources.entries();
    }

    // --- Freeze control ---

    freeze(): void {
        this.frozen = true;
    }

    isFrozen(): boolean {
        return this.frozen;
    }
}
