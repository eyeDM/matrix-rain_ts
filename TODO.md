## [WGSL] Улучшить PRNG для симуляции (gpu-update.wgsl)

* Задача: Заменить или модифицировать текущий Linear Congruential Generator (LCG) в `gpu-update.wgsl` на более качественный PRNG (например, Xorshift или Tausworthe) для лучшего визуального распределения случайности символов и длин.

## Merge `ParamsWriter` and `FrameUniforms`

### Single Simulation Uniform Block

Instead of:
```
@binding(0) FrameUniforms
@binding(1) ParamsUniforms
```

Move to:
```
@binding(0) SimulationUniforms
```

Which contains:
```
struct SimulationUniforms {
    dt: f32,

    rows: u32,
    cols: u32,
    glyphCount: u32,

    cellWidth: f32,
    cellHeight: f32,

    // padding to 16-byte alignment
};
```

**One buffer. One writer. One upload per frame.**
