# Visualization Component Architecture

This document describes the shared visualization architecture for plugins built with the Rust DSP + WebView UI + JUCE AUv2 stack. It covers the Rust-side spectrum/metering engine, the JS-side rendering components, the per-plugin glue layers, and the data flow between them.

The goal: a new plugin reuses the generic FFT engine and JS renderers without modification. The plugin author writes only a thin glue layer (Rust controller + JS index.js) to define what signals to analyze, what data to send, and what visual style to use.

---

## Layer Diagram

```mermaid
graph TD
    A["Plugin Rust DSP (audio thread)"] --> B["viz-core crate (generic)"]
    B --> C["Plugin controller (plugin-specific)"]
    C --> D["SeqLock&lt;PluginVizFrame&gt;"]
    D --> E["Plugin FFI: frame → JSON (plugin-specific)"]
    E --> F["C++ Editor timerCallback (generic pattern)"]
    F -->|"active"| G["evaluateJavascript(json)"]
    F -->|"inactive (watchdog)"| H["vizDecay() → Rust decay"]
    H --> D
    G --> I["Plugin index.js: JSON → components (plugin-specific)"]
    I --> J["SpectrumAnalyzer / GrTimeline / Meter (generic, passive)"]
```

There are five layers. Three are generic shared code (viz-core crate, SeqLock, JS renderers). Two are per-plugin glue (controller, JS index.js). The C++ timer is a generic pattern but lives in each plugin's PluginEditor.cpp (identical code across plugins).

---

## Temporal Smoothing Architecture

All temporal smoothing happens in the Rust layer (viz-core `SpectrumEngine`). JS is a stateless passive renderer.

```mermaid
graph LR
    A["FFT → |X[k]|²"] --> B["Per-band mean power aggregation"]
    B --> C["Per-bin EMA in linear power domain"]
    C --> D["Power → dB + tilt compensation"]
    D --> E["Write to VizFrame via SeqLock"]
    E --> F["JS renders data as-is, no ballistics"]
```

### Smoothing Details

- **Domain**: Linear power (not dB). Smoothing in dB biases toward peaks.
- **Formula**: `smoothed[n] = alpha * smoothed[n-1] + (1 - alpha) * raw_power[n]`
- **Attack**: Instant (alpha = 0). New peaks appear immediately.
- **Release**: Configurable via `release_ms` (default 300ms). `alpha = exp(-1 / (tau * frame_rate))`.
- **Frame rate**: Determined by `sample_rate / hop` (e.g. 48000/512 ≈ 94 Hz), higher than display rate (30 Hz).

### DAW Transport Stop (Watchdog)

Logic Pro stops calling `processBlock` when playback pauses. The plugin detects this via a C++ watchdog:

1. `processBlock` updates an `atomic<double> lastProcessBlockTime` every call.
2. `timerCallback` (30 Hz) checks `elapsed = now - lastProcessBlockTime`.
3. If `elapsed > 200ms`, calls `vizDecay()` which drives `SpectrumEngine::decay_to_silence()`.
4. `decay_to_silence` applies one frame of release-rate decay to `smooth_power`, then recalculates dB.
5. The resulting VizFrame has `active = false`, telling JS the display is in decay mode.
6. After enough decay frames, all bins reach `db_floor` and the display is silent.

---

## Layer 1: viz-core Rust Crate (Generic)

Location: `rust-dsp-crates/viz-core/` (shared crate, depended on by each plugin's DSP crate via path dependency).

### Responsibility

Accepts raw PCM samples for a single signal, performs FFT, maps FFT bins to logarithmic frequency bands, applies tilt compensation, performs per-bin temporal smoothing in linear power domain, and outputs an array of smoothed dB values. Does not know about "input", "output", "sidechain", or any plugin concept.

### Exposed Configuration

All set at construction time:

| Parameter | Type | Purpose |
|-----------|------|---------|
| `sample_rate` | `i32` | Current DAW sample rate |
| `fft_size` | `usize` | FFT window size (1024 / 2048 / 4096 / 8192) |
| `hop` | `usize` | Samples between FFT computations |
| `bin_count` | `usize` | Number of output log-frequency display bands |
| `f_min` / `f_max` | `f64` | Frequency range of output bands (typically 20..20000 Hz) |
| `tilt_db_per_oct` | `f32` | Spectral tilt compensation slope (e.g. 4.5 dB/oct) |
| `tilt_pivot_hz` | `f64` | Tilt pivot frequency (e.g. 1000 Hz) |
| `db_floor` | `f32` | Minimum dB value (e.g. -96) |
| `attack_ms` | `f32` | EMA attack time constant (0 = instant) |
| `release_ms` | `f32` | EMA release time constant (e.g. 300ms) |

### Interface

```rust
pub struct SpectrumEngine { ... }

impl SpectrumEngine {
    pub fn new(sample_rate: i32, config: SpectrumConfig) -> Self;
    pub fn set_sample_rate(&mut self, sample_rate: i32);
    pub fn reset(&mut self);

    // Call from audio thread. Feeds samples into ring buffer,
    // triggers FFT + smoothing when hop is reached.
    pub fn feed(&mut self, samples: &[f32]);

    // Read current smoothed dB array (length = bin_count).
    pub fn smoothed_bins(&self) -> &[f32];

    // Drive one frame of release-rate decay (for DAW pause).
    pub fn decay_to_silence(&mut self);
}
```

### Additional Utilities in viz-core

**PeakMeter**: stateless per-block peak/RMS measurement.

```rust
pub struct PeakMeter;
impl PeakMeter {
    pub fn measure(samples: &[f32]) -> (f32 /* peak */, f32 /* rms */);
}
```

**SeqLock\<T\>**: generic single-writer single-reader lock-free snapshot, usable with any `Copy` type. The audio thread writes, the UI thread reads. No heap allocation, no mutex.

```rust
pub struct SeqLock<T: Copy> { ... }
impl<T: Copy> SeqLock<T> {
    pub fn new(initial: T) -> Self;
    pub fn write(&self, value: &T);  // audio thread only
    pub fn read(&self) -> T;         // UI thread only
}
```

---

## Layer 2: Plugin Controller (Plugin-Specific)

Location: each plugin's DSP crate (e.g. `rust-dsp-crates/debess/debess-rs/src/controller.rs`).

### Responsibility

Composes one or more `SpectrumEngine` instances from viz-core, defines the plugin's `VizFrame` struct (what data the UI needs), and publishes it via `SeqLock<VizFrame>`.

This is where plugin-specific visualization logic lives:
- How many spectrum engines to create (one for input? one for output? one for sidechain?)
- Whether to measure output directly or derive it from input + filter frequency response
- What scalar metrics to include (GR, levels, threshold, etc.)
- Plugin-specific `decay()` method for DAW pause behavior

### Example: DeBess

DeBess uses one `SpectrumEngine` for the input signal. The output spectrum is derived mathematically from the input spectrum and the de-esser's transfer function H(f), guaranteeing output <= input at every frequency.

```rust
pub struct VizFrame {
    pub input_db: [f32; 192],
    pub output_db: [f32; 192],
    pub gr_db: f32,
    pub input_level: f32,
    pub output_level: f32,
    pub active: bool,
}
```

The `active` field indicates whether `processBlock` is actively calling `feed()`. When `false`, the UI knows the data is in decay mode.

The controller exposes `viz_decay()` which calls `SpectrumEngine::decay_to_silence()` and also decays scalar metrics (GR, levels).

---

## Layer 3: FFI + JSON Serialization (Plugin-Specific)

Location: each plugin's FFI crate (e.g. `plugins/DeBess/dsp/src/lib.rs`).

### Responsibility

Reads the `SeqLock<VizFrame>` snapshot and serializes it to a JSON string. The JSON schema is entirely determined by the plugin's VizFrame struct. There is no cross-plugin JSON standard.

The function returns a `*const c_char` that remains valid until the next call (cached in the engine struct).

### DeBess JSON Example

```json
{"in":[-45.2,-42.1,...],"out":[-48.3,-45.0,...],"gr":3.21,"il":0.45,"ol":0.38,"a":1}
```

The `"a"` field (0 or 1) reflects `VizFrame::active`.

### FFI Functions

Each plugin exposes:
- `plugin_get_viz_json()` — read snapshot + serialize
- `plugin_viz_decay()` — drive one decay frame (called by C++ watchdog)

---

## Layer 4: C++ Timer Bridge with Watchdog (Generic Pattern)

Location: each plugin's `PluginEditor.cpp` and `PluginProcessor.cpp`. The code is nearly identical across plugins.

### Processor Side

```cpp
// PluginProcessor.h
std::atomic<double> lastProcessBlockTime { 0.0 };

// PluginProcessor.cpp
void processBlock(...) {
    lastProcessBlockTime.store(
        juce::Time::getMillisecondCounterHiRes(),
        std::memory_order_relaxed);
    // ... normal processing
}

void vizDecay() {
    plugin_viz_decay(dspEngine);
}
```

### Editor Side

```cpp
void timerCallback() {
    double now = juce::Time::getMillisecondCounterHiRes();
    double elapsed = now - audioProcessor.lastProcessBlockTime.load(
        std::memory_order_relaxed);
    if (elapsed > 200.0)
        audioProcessor.vizDecay();

    const char* json = audioProcessor.getVizJson();
    if (json) {
        juce::String js = "if(window.__pluginViz){window.__pluginViz('"
            + juce::String(json) + "');}";
        webView->evaluateJavascript(js);
    }
}
```

Timer runs at ~30 Hz. When `processBlock` has not been called for 200ms, the watchdog drives Rust-side decay, ensuring the spectrum smoothly fades to silence.

---

## Layer 5: JS Rendering Components (Generic, Passive)

Location: shared directory (`shared/ui/viz/`), referenced by each plugin's CMakeLists.txt for BinaryData embedding.

### SpectrumAnalyzer

A stateless passive renderer. Receives dB arrays via `setSeries()`, renders them directly on the next animation frame. No internal ballistics, no smoothing, no temporal state.

Constructor config (all optional with defaults):

| Parameter | Type | Purpose |
|-----------|------|---------|
| `fMin` / `fMax` | number | Frequency axis range (Hz). Must match Rust `f_min`/`f_max` |
| `dbMin` / `dbMax` | number | Vertical axis range (dB) |
| `binCount` | number | Expected input array length. Must match Rust `bin_count` |
| `series` | array | Curve definitions (see below) |
| `diffFill` | object | Difference fill between two series (e.g. reduction shading) |
| `gridColor` / `gridColorMajor` / `labelColor` / `font` | string | Grid visual style |
| `freqLines` / `freqLabels` / `dbStep` | array/object/number | Grid tick configuration |
| `padTop` / `padBottom` | number | Vertical padding fractions |

Each series entry:

```js
{ key: 'input', color: 'rgba(120,170,200,0.5)', lineWidth: 1.1,
  fill: true, fillTopColor: '...', fillBottomColor: '...' }
```

Runtime interface:

- `setSeries(key, Float32Array)` — feed data for one curve.
- `start()` / `stop()` — begin/end requestAnimationFrame render loop.

Rendering features:
- Quadratic Bezier midpoint interpolation (smooth curves)
- Per-series vertical gradient fill
- Difference fill between any two series
- Log-frequency grid with configurable tick marks and labels
- dB grid with configurable step size
- HiDPI aware (devicePixelRatio)

### GrTimeline

Scrolling horizontal timeline of a scalar value (typically gain reduction).

Config: `historyLen` (number of frames to retain), `grMaxDb` (vertical scale), colors.

Runtime: `push(gr, level)` — append one frame. `start()` / `stop()`.

### Meter

Vertical bar meter with smoothing and decay.

Config: `smooth` (attack coefficient), `decay` (fall rate per frame).

Runtime: `set(value)` — value in 0..1 range.

---

## Per-Plugin Glue: JS index.js (Plugin-Specific)

Location: each plugin's `Source/ui/public/js/index.js`.

This file is the only place that knows:
1. The JSON schema coming from Rust
2. Which generic components to instantiate and with what visual config
3. How to map JSON fields to component inputs

### DeBess Example (abridged)

```js
const spectrum = new SpectrumAnalyzer(canvas, {
    binCount: 192, fMin: 20, fMax: 20000, dbMin: -90, dbMax: 6,
    series: [
        { key: 'input', color: 'rgba(120,170,200,0.5)', lineWidth: 1.1 },
        { key: 'output', color: '#5ac8e0', lineWidth: 1.8,
          fill: true, fillTopColor: 'rgba(90,200,224,0.30)',
          fillBottomColor: 'rgba(90,200,224,0.02)' },
    ],
    diffFill: { from: 'input', to: 'output', color: 'rgba(232,68,90,0.16)' },
});

window.__debessViz = function(json) {
    let d = JSON.parse(json);
    spectrum.setSeries('input', d.in);
    spectrum.setSeries('output', d.out);
    timeline.push(d.gr, d.il);
    grMeter.set(d.gr / 24);
};
```

---

## Constant Alignment

Certain constants must match between Rust and JS. These are not synchronized automatically; the plugin author ensures they match when writing the glue layers.

| Constant | Rust location | JS location |
|----------|--------------|-------------|
| bin_count | viz-core `SpectrumConfig` | `index.js` constructor `binCount` |
| f_min / f_max | viz-core `SpectrumConfig` | `index.js` constructor `fMin` / `fMax` |
| db_floor | viz-core `SpectrumConfig` | `index.js` constructor `dbMin` |

---

## File Placement

```
rust-dsp-crates/
  viz-core/
    Cargo.toml
    src/
      lib.rs            # re-exports
      spectrum.rs       # SpectrumEngine (FFT + smoothing)
      seqlock.rs        # SeqLock<T>
      meter.rs          # PeakMeter

shared/
  ui/
    viz/
      spectrum.js       # SpectrumAnalyzer class (passive renderer)
      timeline.js       # GrTimeline class
      meter.js          # Meter class

plugins/DeBess/
  dsp/
    Cargo.toml          # depends on debess-rs + viz-core
    src/lib.rs          # FFI including debess_get_viz_json + debess_viz_decay
  Source/
    PluginProcessor.h   # lastProcessBlockTime atomic + vizDecay()
    PluginEditor.cpp    # timerCallback with watchdog
    ui/public/
      js/
        index.js        # plugin-specific glue (JSON→components, knob wiring)
        knob.js         # plugin-specific knob rendering
        format.js       # plugin-specific parameter formatting
      css/
        style.css       # plugin-specific theme
      index.html        # plugin-specific layout
  CMakeLists.txt        # references shared/ui/viz/*.js for BinaryData
```

---

## What Each Layer Does NOT Do

- **viz-core** does not manage multiple signals, does not define VizFrame structs, does not serialize JSON, does not know about plugin parameters. It does all temporal smoothing internally.
- **JS renderers** do not parse JSON, do not know parameter names, do not do any temporal smoothing or ballistics. They render data arrays as-is.
- **Plugin controller** does not do FFT math (delegates to viz-core), does not render anything.
- **Plugin index.js** does not do DSP or FFT, does not define rendering algorithms (delegates to generic components).
- **C++ timer** does not interpret the JSON content, just passes it through. It does detect DAW inactivity via watchdog and drives decay.
