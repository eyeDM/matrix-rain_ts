# TODO

## Цветовые пространства

- Часть значений - HDR, часть - LDR.
- Где-то - rgba16float, где-то - bgra8unorm-srgb, без обоснований и проверки доступности.
- Что там с RGB <-> sRGB?

---

## SimulationParams

Вынести константы, определяющие ColumnState, в uniform buffer.
Сделать их изменяемыми через UI.

---

## HistoryPass

`decay` фиксированный, при разной частоте кадров след меняется?

Можно сделать зависимость от `frame.dt`.

---

## Продвинутый Blur

### Downsample → Blur → Upsample

Сделать bloom-буфер в более низком разрешении:

```
draw bright target (full res)
↓
downsample x2 или x4
↓
blur H/V
↓
upsample + combine
```

Эффект:
* визуально намного более крупные ореолы
* появляется мягкий «glow cloud»
* дешевле, чем огромный kernel
Это стандартный приём в real-time рендеринге.

### Разный размер ореола (bloom) для разных столбцов

#### Multi-Scale Bloom

Разбить bloom на несколько слоёв:

```
bright →
   downsample x2 → blur small
   downsample x4 → blur medium
   downsample x8 → blur large
→ combine weighted
```

А вес слоя выбирать от столбца:
```
let wSmall = saturate(1.0 - sizeFactor);
let wLarge = saturate(sizeFactor);
```
Плюсы:
* самый красивый и стабильный результат
* даёт глубину и параллакс

Минусы:
* сложнее render graph

#### Уровень Blur определяется состояние столбца

`радиус = f(length, speed, energy)`

Например:
```
radius = 0.5
       + 0.02 * length
       + 0.03 * speed
       + 0.01 * energy
```

Это даёт:
* длинные хвосты → широкий glow
* быстрые столбцы → более «смазанный» свет
* энергичные → яркий и толстый ореол

---

## При выборе символов использовать bias по алфавиту

Одни символы выпадают чаще других.

Варианты bias:
* Частотный
* Энергетический (выбор глифа зависит от энергии столбца)
* Позиционный (разные символы для головы, середины, хвоста)
* Временной (задаётся "средой")

---

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
