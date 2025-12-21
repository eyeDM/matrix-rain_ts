## [WGSL] Улучшить PRNG для симуляции (gpu-update.wgsl)

* Задача: Заменить или модифицировать текущий Linear Congruential Generator (LCG) в `gpu-update.wgsl` на более качественный PRNG (например, Xorshift или Tausworthe) для лучшего визуального распределения случайности символов и длин.

## Избавиться от `MAX_TRAIL` в `src/main.ts`
