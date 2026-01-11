import { RGTextureDescriptor } from '@engine/render/render-graph';

/**
 * Centralized registry and lifecycle manager for render-target textures.
 *
 * RenderTargetRegistry is the single source of truth for all GPU textures
 * produced and consumed by the RenderGraph during a frame. It owns:
 *  - creation and destruction of screen-sized textures
 *  - resize propagation (e.g. on canvas resize)
 *  - safe access to GPUTextureView by logical name
 *
 * Key design principles:
 *  - Render passes never create or describe textures themselves
 *  - Texture formats, usage flags and sizing rules are declared once
 *    in RenderGraphBuilder and remain immutable thereafter
 *  - Renderers and passes depend only on symbolic names, not descriptors
 *
 * This design:
 *  - prevents descriptor drift between passes
 *  - eliminates per-frame texture creation
 *  - simplifies resize handling
 *  - keeps render passes stateless and deterministic
 *
 * Currently, supports screen-sized textures only; fixed-size or transient
 * resources can be added later without changing pass interfaces.
 */

export class RenderTargetRegistry {
    private readonly textures = new Map<string, GPUTexture>();
    private readonly descriptors: Map<string, RGTextureDescriptor>;

    constructor(
        private readonly device: GPUDevice,
        descriptors: Map<string, RGTextureDescriptor>,
    ) {
        this.descriptors = descriptors;
    }

    resize(width: number, height: number): void {
        for (const [name, desc] of this.descriptors) {
            if (desc.size !== 'screen') continue;
            this.textures.get(name)?.destroy();
            this.textures.set(
                name,
                this.device.createTexture({
                    format: desc.format,
                    usage: desc.usage,
                    size: { width, height },
                }),
            );
        }
    }

    getTexture(name: string): GPUTextureView {
        const texture = this.textures.get(name);
        if (!texture) {
            throw new Error(`RTRegistry: texture '${name}' not found`);
        }
        return texture.createView();
    }
}
