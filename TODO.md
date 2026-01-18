# TODO

## [WGSL] Улучшить PRNG для симуляции (compute.wgsl)

Заменить или модифицировать текущий Linear Congruential Generator (LCG) в `compute.wgsl` на более качественный PRNG (например, Xorshift или Tausworthe) для лучшего визуального распределения случайности.

## При выборе символов использовать bias по алфавиту

Одни символы выпадают чаще других.

Варианты bias:
* Частотный
* Энергетический (выбор глифа зависит от энергии столбца)
* Позиционный (разные символы для головы, середины, хвоста)
* Временной (задаётся "средой")

## Depth Illusion (Pseudo-3D Without 3D)

Simulate depth using scale, speed, blur, and brightness.

## Color Evolution & Chromatic Variation

Move beyond flat green without losing Matrix identity.

## Scalability & Stress Optimization

### Objective
Guarantee performance at extreme resolutions.

### Tasks
- Adaptive trail length by FPS
- Dynamic workgroup sizing
- Optional half-resolution simulation

### Metrics
- GPU timestamp queries
- Frame budget enforcement

### Verification
- Stable 60 FPS at 4K
- No CPU spikes
