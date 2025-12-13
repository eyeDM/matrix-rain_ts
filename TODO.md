## [WGSL] Улучшить PRNG для симуляции (gpu-update.wgsl)

* Задача: Заменить или модифицировать текущий Linear Congruential Generator (LCG) в `gpu-update.wgsl` на более качественный PRNG (например, Xorshift или Tausworthe) для лучшего визуального распределения случайности символов и длин.

## [TS] Уточнить управление `GPUCanvasContext` в `webgpu-init.ts`

* Задача: Убедиться, что вызов `context!.configure` в `configureCanvas` в `webgpu-init.ts` происходит только при реальном изменении размеров. (Хотя WebGPU рекомендует вызывать `configure` на resize, код уже это делает, но стоит добавить комментарий).
