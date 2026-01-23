# Matrix Phosphor Plan — Detailed Instructions for an LLM Agent

Objective
- Implement an authentic monochrome phosphorescent "green-screen" visual style for the Matrix Rain app, using strictly GPU-side techniques (compute + fragment passes). Keep changes incremental and verifiable.

Rationale
- The visual character relies on persistence (phosphor decay), soft haloing (bloom), scanline/CRT artifacts, subtle curvature, monochrome color mapping, and film grain. All of these are inexpensive and robust when implemented on-GPU using a combination of a history buffer, separable blur passes, and a final fullscreen present shader.

High-level approach
1. Render glyphs into a scene texture every frame (existing draw pass). Do not modify per-glyph CPU logic.
2. Maintain a ping-pong history texture (full-resolution) that decays each frame and accumulates the current scene. This produces long trails and phosphor-like persistence without CPU readbacks.
3. Run an optional bright-pass + separable blur at half/quarter resolution to produce bloom; composite additively into the present stage.
4. Implement all screen-space artifacts (monochrome mapping, vignette, scanlines, curvature, temporal noise) in the present WGSL shader, exposing parameters as uniforms.

Implementation steps (small commits)
- Step A — History / Decay (priority)
  - Files to edit: src/gpu/render-graph.ts, src/gpu/present-pass.ts, src/gpu/screen-uniform-buffer.ts, src/assets/shaders/present.wgsl
  - Goal: allocate two full-size RGBA8Unorm textures (historyA/historyB), ping-pong each frame; implement shader logic: history = history * decay + scene; expose `decay` uniform (float).
  - Verification: with decay=0.9, glyph trails persist for several frames; toggling `decay=1.0` yields full persistence.

- Step B — Present-pass effects (monochrome + CRT artifacts)
  - Files to edit: src/assets/shaders/present.wgsl, src/gpu/present-pass.ts, src/gpu/screen-uniform-buffer.ts
  - Goal: in the final composite shader apply:
    - Convert color to intensity (luminance), map through a green phosphor ramp: color = vec3(intensity * tintR, intensity * tintG, intensity * tintB).
    - Vignette: radial falloff based on normalized coords, uniform `vignetteStrength`.
    - Scanlines: multiply by (1.0 - scanlineStrength * sin(uv.y * freq + time*speed)).
    - Film grain / noise: small hashed noise added to intensity; uniform `noiseAmplitude`.
    - Curvature: remap UV using small radial distortion function; uniform `curvature`.
  - Verification: toggling each uniform should show immediate result.

- Step C — Bloom (bright-pass + separable blur)
  - Files to add/edit: src/assets/shaders/blur.wgsl (new), src/gpu/render-graph.ts, src/gpu/present-pass.ts
  - Goal: extract bright regions (threshold), blur horizontally then vertically at half-resolution, composite with `bloomIntensity` in present shader.
  - Performance: use separable kernel and half-res targets; default `bloomIntensity=0.35`, `bloomThreshold=0.7`.
  - Verification: strong glyph heads produce soft halos.

- Step D — Polish: temporal flicker & per-column noise
  - Files to edit: src/assets/shaders/present.wgsl, src/gpu/simulation-pass.ts (optional), src/gpu/simulation-uniform-writer.ts
  - Goal: modulate decay and per-column brightness slightly with time-varying noise / small PRNG seeded per-column for authenticity.
  - Verification: subtle, non-distracting jitter and flicker.

WGSL / Layout notes (principles)
- Keep uniform buffers tightly packed and 16-byte aligned. Use a small `PresentUniforms` struct for screen params: `resolution(vec2)`, `time(f32)`, `decay(f32)`, `vignetteStrength(f32)`, `scanlineStrength(f32)`, `noiseAmplitude(f32)`, `curvature(f32)`, `bloomIntensity(f32)`, `bloomThreshold(f32)`.
- Use `rgba8unorm` textures for history and blur targets; sample with linear filtering and clamp-to-edge.
- Perform blur at half (or quarter) resolution to reduce sample cost. Use a 1D Gaussian kernel separable into horizontal and vertical passes.

Performance & safe defaults
- Full-size history texture: 1 × RGBA8Unorm (~4 bytes/pixel). For 1920×1080 ≈ 8.3 MB.
- Blur: two half-res targets: each ~2.1 MB (1920/2 × 1080/2 × 4).
- Use separable blur, 9 taps per pass (cheap at half-res). Keep blur radius small; default radius ≈ 6 (9 taps) at half-res.
- Default uniforms:
  - decay = 0.85
  - bloomThreshold = 0.7
  - bloomIntensity = 0.35
  - scanlineStrength = 0.06
  - vignetteStrength = 0.15
  - noiseAmplitude = 0.02
  - curvature = 0.03

Verification checklist (per commit)
- After Step A: trails persist and are tunable via `decay`.
- After Step B: color mapping to green, vignette, scanlines, and noise are visible when toggled.
- After Step C: bloom halos appear around bright glyphs when `bloomIntensity` > 0.
- After Step D: subtle flicker and curvature are applied without major FPS drop.

Developer tips
- Keep all new resources created only on resize to avoid per-frame allocations.
- Preserve existing bind group indices where possible; add new bind groups for present-stage resources (history, blur targets).
- Add feature toggles (uniform booleans or intensity=0) so each effect can be enabled/disabled for quick testing.
- Use linear filtering and clamp-to-edge on history/blur textures.

Commit granularity
- Make each Step (A–D) a single commit; within each commit change no more than 3–5 files.
- Include a short README note describing uniforms added and how to toggle/adjust them.

Appendix: quick commands (dev)
```bash
npx tsc --noEmit
npm run dev
# open the site printed by Vite, change uniforms in code or add a small debug UI
```

If you confirm, I will start Step A (history + decay) and produce a focused patch that creates the ping-pong textures, wires the present-pass to read/write them, and adds the `decay` uniform and its writer.
