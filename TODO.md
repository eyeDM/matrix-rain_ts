## 1. [CODE] Завершить интеграцию Render Graph (main.ts, renderer.ts)

* Задача: Использовать созданный `RenderGraph` (`createRenderGraph`) в `main.ts` для управления выполнением `compute` и `draw` фаз.

* Детали: Вместо прямого вызова `rendererRef.compute.encode` и `rendererRef.draw.encode` в колбэке `startRenderLoop`, добавить эти объекты как `RenderPass` в граф и вызывать `renderGraph.execute(...)`. Это обеспечит масштабируемую архитектуру для пост-процессинга.

## 2. [WGSL] Добавить Fragment Shader для отрисовки символов (draw-symbols.wgsl)

* Задача: Создать и интегрировать функцию `@fragment fn fs_main` в `draw-symbols.wgsl` для сэмплирования атласа, применения яркости (`v_brightness`) и вывода финального цвета. **(Критично для работы)**

## 3. [TS] Устранить повторное отслеживание ресурсов в `renderer.ts`

* Задача: Удалить избыточные вызовы `resourceManager.track(...)` в конце функции `createRenderer`.

* Детали: `ResourceManager.create*` методы уже отслеживают ресурсы. Проверить и оставить только отслеживание тех ресурсов, которые были созданы без использования `ResourceManager` (если такие есть, или если `resourceManager` был `undefined`).

## 4. [WGSL] Улучшить PRNG для симуляции (gpu-update.wgsl)

* Задача: Заменить или модифицировать текущий Linear Congruential Generator (LCG) в `gpu-update.wgsl` на более качественный PRNG (например, Xorshift или Tausworthe) для лучшего визуального распределения случайности символов и длин.

## 5. [TS] Уточнить управление `GPUCanvasContext` в `webgpu-init.ts`

* Задача: Убедиться, что вызов `context!.configure` в `configureCanvas` в `webgpu-init.ts` происходит только при реальном изменении размеров. (Хотя WebGPU рекомендует вызывать `configure` на resize, код уже это делает, но стоит добавить комментарий).

## 6. [DOC] Проверить документацию WGSL по выравниванию (`draw-symbols.wgsl`)

* Задача: Обновить комментарий к структуре `InstanceData` в `draw-symbols.wgsl`, чтобы явно указать, что `_pad: vec3<f32>` используется для достижения 16-байтного выравнивания массива (stride 48 байт), что является обязательным требованием для Storage Buffer.
