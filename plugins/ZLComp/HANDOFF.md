# ZLComp Rust DSP Rewrite: Handoff Document

## Problem Statement

The current Rust implementation in `rust-dsp-crates/compressor/zlcompressor-rs/src/controller.rs` does NOT faithfully replicate the C++ `CompressController` logic from `ZLCompressor/source/zlp/compress_controller.hpp` and `compress_controller.cpp`. The result is audible distortion ("explosion") when running in a real DAW, despite offline tests passing.

## Root Cause

The C++ CompressController uses an **atomic parameter store + exchange-based update flag** pattern. Parameters are set via atomic stores on the GUI/host thread. The audio thread checks `to_update_.exchange(false)` once per `process()` call. If true, it runs `prepareBuffer()` which reads all atomics and updates cached values.

The Rust implementation incorrectly calls `set_param()` with actual denormalized values directly modifying internal state every single processBlock (20 times per block). This causes:

1. `to_update_style` being set every frame (even when style hasn't changed), which resets follower state to 0 every block, creating gain discontinuities.
2. `to_update_rms` being set every frame (even when RMS ON hasn't changed), which resets rms_follower every block.
3. Every `to_update_*` flag being set every frame because `set_param` unconditionally sets them, unlike C++ where the JUCE attachment only calls the setter when the value actually changes.

A partial fix was applied (checking `!=` before setting style/rms_on flags), but this is a band-aid. The correct fix is to rewrite controller.rs to match the C++ architecture exactly.

## Required Work

Delete the entire `rust-dsp-crates/compressor/zlcompressor-rs/src/` directory (except `lib.rs` which just re-exports modules) and rewrite ALL Rust DSP code by 1:1 translating the C++ source. No file is exempt. Every `.rs` file must be a faithful translation of the corresponding C++ `.hpp`.

### Source files to translate

| C++ file | Rust target |
|----------|-------------|
| `ZLCompressor/source/zlp/compress_controller.hpp` + `.cpp` | `controller.rs` |
| `ZLCompressor/source/dsp/compressor/follower/ps_follower.hpp` | `compressor/ps_follower.rs` |
| `ZLCompressor/source/dsp/compressor/styles/clean.hpp` | `compressor/styles.rs` (CleanCompressor) |
| `ZLCompressor/source/dsp/compressor/styles/classic.hpp` | `compressor/styles.rs` (ClassicCompressor) |
| `ZLCompressor/source/dsp/compressor/styles/optical.hpp` | `compressor/styles.rs` (OpticalCompressor) |
| `ZLCompressor/source/dsp/compressor/styles/vocal.hpp` | `compressor/styles.rs` (VocalCompressor) |
| `ZLCompressor/source/dsp/compressor/computer/compression_computer.hpp` | `compressor/compression_computer.rs` |
| `ZLCompressor/source/dsp/compressor/tracker/rms_tracker.hpp` | `compressor/rms_tracker.rs` |
| `ZLCompressor/source/dsp/container/circular_minmax_buffer.hpp` | `container/circular_minmax_buffer.rs` |
| `ZLCompressor/source/dsp/delay/integer_delay.hpp` | `delay/integer_delay.rs` |
| `ZLCompressor/source/dsp/gain/gain.hpp` | `gain/gain.rs` |
| `ZLCompressor/source/dsp/chore/decibels.hpp` | `chore/decibels.rs` |

Every single file must be rewritten. Do NOT assume any existing Rust file is correct. The previous implementation has bugs that caused audible distortion.

### Key architectural pattern to replicate

```
// C++ pattern (MUST be replicated in Rust):
void setAttack(float v) {
    attack_.store(v);            // atomic store
    follower_[0].setAttack(v);   // which internally sets atomic + to_update flag
}

void process(...) {
    if (to_update_.exchange(false)) {  // only enters once when something changed
        prepareBuffer();
    }
    // ... audio processing
}

// Inside PSFollower:
bool prepareBuffer() {
    if (to_update_.exchange(false)) {  // only recalculates when set_* was called
        update();  // recompute attack/release coefficients
        return true;
    }
    return false;
}
```

In Rust, since there is no multi-threading concern (single-threaded plugin), the atomic pattern can be simplified to plain bool flags, BUT the key invariant must be preserved: **`to_update_style` must only be set when style ACTUALLY CHANGES, not every time set_param is called with the same value.**

### Simplifications allowed (features removed from C++)

- No oversample (remove all over_sampler code)
- No clipper (remove TanhClipper)
- No delta monitoring
- No expand/inflate/shape directions (only Compress)
- No LUFS matcher
- No mag analyzer
- No stereo link/swap/max modes (only simple M/S and L/R)
- wet1/wet2 hardcoded to 1.0

### Files that are correct and should NOT be changed

- `plugins/ZLComp/dsp/src/lib.rs` - FFI layer (correct, just calls into controller)
- `plugins/ZLComp/Source/` - All C++ JUCE code (correct, passes auval)
- `plugins/ZLComp/CMakeLists.txt` - Build config (correct)
- `rust-dsp-crates/compressor/zlcompressor-rs/src/params.rs` - Parameter scaling (verified correct by unit tests, matches C++ exactly)

### The C++ processBlock call pattern

The JUCE PluginProcessor calls `set_parameter` for ALL 20 params every single processBlock. This means:
- Setters MUST be idempotent (no side effects if value didn't change)
- Flags like `to_update_style` must only be set on actual change
- The `to_update` global flag CAN be set every frame (it just triggers prepareBuffer which is cheap if sub-flags are all false)

### Validation

After rewrite, run:
```bash
cd rust-dsp-crates/compressor/zlcompressor-rs
cargo test
```

All tests must pass. If any test fails because it depends on the old API, update the test to match the new API. The tests themselves may also have bugs from the previous implementation.

Then rebuild the plugin:
```bash
cd plugins/ZLComp
python3 build.py all
```

Must pass auval with zero panics. Then open the Standalone or load the AU in Logic Pro and verify no audible distortion with default parameters.

### Additional context

- The `appleSideBuffer` function in C++ uses `exp(side * wet * ln10)` NOT `pow(10, side * wet)`. The Rust code uses `10.0f32.powf(side * wet)` which is mathematically equivalent but the C++ uses `wet * kLn10` multiplied into the exponent for performance. Both produce the same result.
- The C++ `c_wet1_` = `wet1 * wet * 0.05` where 0.05 = 1/20 accounts for the fact that side buffer values are in dB (20*log10), so `exp(dB * 0.05 * ln10)` = `10^(dB/20)` = gain. The Rust code does `10.0f32.powf(side * c_wet)` where `c_wet = wet * 0.05`. This is correct.

## Plugin Structure (already built, working minus the audio bug)

```
plugins/ZLComp/
  dsp/Cargo.toml          - FFI crate depending on zlcompressor-rs
  dsp/src/lib.rs           - extern "C" functions (create/destroy/process/set_parameter/get_viz_json)
  Source/ffi.h             - C declarations
  Source/PluginProcessor.h/.cpp - JUCE AudioProcessor, pushes all 20 params per block
  Source/PluginEditor.h/.cpp    - WebView UI with relay bindings
  Source/ui/public/          - HTML/CSS/JS WebView UI
  CMakeLists.txt           - Corrosion + JUCE, AU target
  build.py                 - build/install/clear/validate CLI
```

The plugin builds and passes auval. The only issue is audio quality due to the controller.rs bug described above.
