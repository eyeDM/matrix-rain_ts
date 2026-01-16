import type {
    BufferResourceDesc,
    ResourceDescriptor,
    ResourceName,
    ResourceRegistry,
    SamplerResourceDesc,
    TextureResourceDesc,
} from '@platform/webgpu/resource-registry';

export class ResourceManager {
    readonly registry: Readonly<{
        has(name: ResourceName): boolean;
        get(name: ResourceName): ResourceDescriptor;
        entries(): Iterable<readonly [ResourceName, ResourceDescriptor]>;
    }>;

    private readonly buffers = new Map<ResourceName, GPUBuffer>();
    private readonly textures = new Map<ResourceName, GPUTexture>();
    private readonly samplers = new Map<ResourceName, GPUSampler>();

    private destroyed = false;

    constructor(
        private readonly device: GPUDevice,
        registry: ResourceRegistry
    ) {
        if (!registry.isFrozen()) {
            throw new Error('ResourceManager requires a frozen ResourceRegistry');
        }

        this.registry = registry;

        // Eager creation of all resources
        for (const [name, res] of registry.entries()) {
            switch (res.kind) {
                case 'buffer':
                    this.buffers.set(
                        name,
                        this.createBuffer(name, res)
                    );
                    break;

                case 'texture':
                    this.textures.set(
                        name,
                        this.createTexture(name, res)
                    );
                    break;

                case 'sampler':
                    this.samplers.set(
                        name,
                        this.createSampler(name, res)
                    );
                    break;

                default:
                    // Exhaustiveness guard
                    throw new Error(`Unknown resource kind: ${res}`);
            }
        }
    }

    // --- Internal guards ---

    private assertAlive(): void {
        if (this.destroyed) {
            throw new Error('ResourceManager has been destroyed');
        }
    }

    private assertKind(
        name: ResourceName,
        expected: ResourceDescriptor['kind']
    ): ResourceDescriptor {
        const desc = this.registry.get(name);
        if (desc.kind !== expected) {
            throw new Error(
                `Resource '${name}' is '${desc.kind}', expected '${expected}'`
            );
        }
        return desc;
    }

    // --- Getters ---

    getBuffer(name: ResourceName): GPUBuffer {
        this.assertAlive();
        this.assertKind(name, 'buffer');

        const buf = this.buffers.get(name);
        if (!buf) {
            throw new Error(`GPUBuffer '${name}' not found`);
        }
        return buf;
    }

    getTexture(name: ResourceName): GPUTexture {
        this.assertAlive();
        this.assertKind(name, 'texture');

        const tex = this.textures.get(name);
        if (!tex) {
            throw new Error(`GPUTexture '${name}' not found`);
        }
        return tex;
    }

    getSampler(name: ResourceName): GPUSampler {
        this.assertAlive();
        this.assertKind(name, 'sampler');

        const smp = this.samplers.get(name);
        if (!smp) {
            throw new Error(`GPUSampler '${name}' not found`);
        }
        return smp;
    }

    // --- Lifetime management ---

    destroyAll(): void {
        if (this.destroyed) return;

        for (const buf of this.buffers.values()) {
            buf.destroy();
        }

        for (const tex of this.textures.values()) {
            tex.destroy();
        }

        // Samplers do not require explicit destroy

        this.buffers.clear();
        this.textures.clear();
        this.samplers.clear();

        this.destroyed = true;
    }

    isDestroyed(): boolean {
        return this.destroyed;
    }

    // --- Private factories ---

    private createBuffer(
        name: ResourceName,
        res: BufferResourceDesc
    ): GPUBuffer {
        return this.device.createBuffer({
            ...res.desc,
            label: res.desc.label ?? name,
        });
    }

    private createTexture(
        name: ResourceName,
        res: TextureResourceDesc
    ): GPUTexture {
        return this.device.createTexture({
            ...res.desc,
            label: res.desc.label ?? name,
        });
    }

    private createSampler(
        name: ResourceName,
        res: SamplerResourceDesc
    ): GPUSampler {
        return this.device.createSampler({
            ...res.desc,
            label: res.desc.label ?? name,
        });
    }
}
