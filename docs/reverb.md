## 架构设计

### 目录结构

```
shared/
└── dragonfly-freeverb/
    ├── freeverb/                ← 从 dragonfly-reverb/common/freeverb/ 复制
    ├── kiss_fft/               ← 从 dragonfly-reverb/common/kiss_fft/ 复制
    ├── AbstractDSP.hpp
    └── Param.hpp

plugins/
├── DragonflyPlate/
│   ├── dsp/
│   │   ├── Cargo.toml          ← staticlib, 依赖 cc crate
│   │   ├── build.rs            ← cc crate 编译 C++ DSP
│   │   ├── src/lib.rs          ← Rust FFI 入口
│   │   └── cpp/
│   │       ├── DSP.hpp
│   │       ├── DSP.cpp
│   │       ├── params.h        ← 参数定义（从 DistrhoPluginInfo.h 提取）
│   │       └── dsp_wrapper.cpp ← extern "C" 包装
│   ├── Source/
│   │   ├── ffi.h
│   │   ├── PluginProcessor.h/.cpp
│   │   ├── PluginEditor.h/.cpp
│   │   └── ui/public/
│   │       ├── index.html
│   │       ├── css/style.css
│   │       └── js/
│   ├── CMakeLists.txt
│   └── build.py
│
└── DragonflyHall/
    └── （同样结构）
```

### 数据流

```
JUCE PluginProcessor.processBlock()
  → dfplate_set_parameter() × 9   [每 block 推送参数]
  → dfplate_process()              [处理音频]

Rust lib.rs
  → 调 extern "C" dragonfly_plate_set_parameter()
  → 调 extern "C" dragonfly_plate_process()

dsp_wrapper.cpp
  → DragonflyReverbDSP::setParameterValue()
  → DragonflyReverbDSP::run()
```

### Rust FFI 接口

```
dfplate_create(sample_rate: i32) -> *mut Engine
dfplate_destroy(engine: *mut Engine)
dfplate_set_sample_rate(engine: *mut Engine, sr: i32, max_block: i32)
dfplate_set_parameter(engine: *mut Engine, idx: u32, value: f32)
dfplate_process(engine: *mut Engine, in_l/in_r/out_l/out_r, n: u32)
dfplate_clear_buffers(engine: *mut Engine)
dfplate_get_state / dfplate_set_state
dfplate_get_viz_json(engine: *mut Engine, buf: *mut u8, size: u32) -> u32
```

Hall 接口同理，前缀换成 `dfhall_`。

### 参数

参数直接使用实际物理值（不是 0-1 归一化）。JUCE 侧用 `NormalisableRange(min, max)` 声明。

**Plate (9 params):**

| idx | id | name | min | max | unit |
|---|---|---|---|---|---|
| 0 | dry_level | Dry Level | 0 | 100 | % |
| 1 | wet_level | Wet Level | 0 | 100 | % |
| 2 | algorithm | Algorithm | 0 | 2 | — |
| 3 | width | Width | 50 | 150 | % |
| 4 | predelay | Predelay | 0 | 100 | ms |
| 5 | decay | Decay | 0.1 | 10 | s |
| 6 | low_cut | Low Cut | 0 | 200 | Hz |
| 7 | high_cut | High Cut | 1000 | 16000 | Hz |
| 8 | damp | Dampen | 1000 | 16000 | Hz |

**Hall (18 params):**

| idx | id | name | min | max | unit |
|---|---|---|---|---|---|
| 0 | dry_level | Dry Level | 0 | 100 | % |
| 1 | early_level | Early Level | 0 | 100 | % |
| 2 | late_level | Late Level | 0 | 100 | % |
| 3 | size | Size | 10 | 60 | m |
| 4 | width | Width | 50 | 150 | % |
| 5 | predelay | Predelay | 0 | 100 | ms |
| 6 | diffuse | Diffuse | 0 | 100 | % |
| 7 | low_cut | Low Cut | 0 | 200 | Hz |
| 8 | low_xo | Low Cross | 200 | 1200 | Hz |
| 9 | low_mult | Low Mult | 0.5 | 2.5 | X |
| 10 | high_cut | High Cut | 1000 | 16000 | Hz |
| 11 | high_xo | High Cross | 1000 | 16000 | Hz |
| 12 | high_mult | High Mult | 0.2 | 1.2 | X |
| 13 | spin | Spin | 0 | 10 | Hz |
| 14 | wander | Wander | 0 | 40 | ms |
| 15 | decay | Decay | 0.1 | 10 | s |
| 16 | early_send | Early Send | 0 | 100 | % |
| 17 | modulation | Modulation | 0 | 100 | % |

### 参数精度与 Scale

原始 DPF 框架下所有参数都是线性映射（`Param.hpp` 只有 `range_min`/`range_max`，无 skew）。JUCE 侧移植时沿用线性 `NormalisableRange(min, max)`。JS 侧归一化值转物理值：`physical = min + norm * (max - min)`。

原始 UI 代码（`UI.cpp`）里每个旋钮的 `numberFormat` 定义了显示精度，移植时 JS 侧必须对齐：

**Plate:**

| 参数 | format | 示例 |
|------|--------|------|
| Width | `%3.0f%%` | `100%` |
| Predelay | `%2.0f ms` | `20 ms` |
| Decay | `%2.1f s` | `0.4 s` |
| Low Cut | `%4.0f Hz` | `200 Hz` |
| High Cut | `%5.0f Hz` | `16000 Hz` |
| Dampen | `%5.0f Hz` | `13000 Hz` |

**Hall:**

| 参数 | format | 示例 |
|------|--------|------|
| Size | `%3.0f m` | `40 m` |
| Width | `%3.0f%%` | `100%` |
| Predelay \| `%2.0f ms` | `12 ms` |
| Decay | `%2.1f s` | `2.4 s` |
| Diffuse | `%2.0f%%` | `90%` |
| Modulation | `%2.0f%%` | `10%` |
| Spin | `%2.2f Hz` | `2.10 Hz` |
| Wander | `%2.1f ms` | `25.0 ms` |
| High Cut / High Cross | `%5.0f Hz` | `6250 Hz` |
| High Mult | `%2.1f X` | `0.3 X` |
| Low Cut / Low Cross | `%4.0f Hz` | `4 Hz` |
| Low Mult | `%2.1f X` | `2.2 X` |

### Spectrogram 实现

Rust 侧维护第二个 `DragonflyReverbDSP` 实例（sample_rate=40960）。参数变化时重新运行：白噪声 8192 samples → 静音直到 8s。收集输出后用 kiss_fft（编译进 staticlib）逐列做 FFT。结果通过 `dfplate_get_viz_json` 以压缩格式（每列一个 base64 编码的亮度数组）传给 WebView。JS canvas 绘制。

## UI
UI位于design-gallery/reverb。
在实现的时候，必须把所有里面的mock的数据都换成真实的数据，每一个数据都必须是真实的！必须是真实的！必须是真实的！必须是真实的！必须是真实的！必须是真实的！必须是真实的！必须是真实的！
UI已经设计好了，直接照搬就好，不要再发挥你的想象力了，直接照搬就好。
UI界面的所有数据都在实现插件的时候必须换成真实的数据，任何一个填数据的槽都不允许使用mock数据。
实现插件的所有功能。