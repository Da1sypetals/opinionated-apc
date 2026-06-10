# C++ → Rust 1:1 Port 经验总结

## 1. C++ 浮点类型提升规则必须逐表达式还原

C++ 规则：无 `f` 后缀的字面量是 `double`；`float` 与 `double` 参与同一运算时 `float` 提升为 `double`。

关键示例：

| C++ 代码 | 类型推导 | Rust 正确翻译 |
|----------|---------|--------------|
| `f * band + 1e-25` | `float*float=float` → `float↑double + double = double` → `static_cast<float>` | `((f * band) as f64 + 1e-25) as f32` |
| `0.7995f * Decay + 0.005` | `float*float=float` → `float↑double + double = double` | `(0.7995f32 * decay) as f64 + 0.005` |
| `3.141592654 * freq / sr` | `double*float↑double/double↑double = double` | `3.141592654f64 * freq as f64 / sr as f64` |
| `2. * sinf(arg)` | `sinf` 返回 `float` → `double*float↑double = double` | `2.0f64 * arg.sin() as f64` |
| `BandwidthFreq * 18400.` | `float*double → double` | `bw_freq as f64 * 18400.0` |
| `BandwidthFreq * 100.f` | `float*float → float` | `bw_freq * 100.0f32` |
| `2 - 2 * resonance` | `int*float=float` → `int-float=float` | `2.0f32 - 2.0f32 * resonance` |

**易错点**：`f * band + 1e-25` 中，乘法必须先在 `f32` 精度下完成，再提升为 `f64` 做加法。写成 `f as f64 * band as f64 + 1e-25` 会导致乘法在 `f64` 精度下完成，产生 1 ULP 级别差异。
