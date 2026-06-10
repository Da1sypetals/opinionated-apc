# Rust DSP + WebView UI + JUCE AUv2 Plugin Architecture

This document records the full architecture, implementation, build system, validation, and pitfalls encountered when building an AudioUnit v2 plugin with:
- Rust for all DSP logic
- Web technologies (HTML/JS/CSS) for all UI
- C++ as the thinnest possible bridge (JUCE framework glue only)

Target: macOS AudioUnit v2 for Logic Pro. No VST3, no CLAP.

---

## Architecture Overview

Three layers, strictly separated:

1. **Rust layer** (static library, `extern "C"` FFI): All audio processing, state serialization, parameter scaling.
2. **Web layer** (HTML/JS/CSS served via JUCE WebView): All visual UI, knob/toggle interactions, parameter display.
3. **C++ layer** (JUCE AudioProcessor + AudioProcessorEditor): Declares parameters (APVTS), forwards processBlock to Rust, hosts WebView container.

The C++ layer contains zero DSP logic and zero UI rendering logic. It is purely declarative glue code required by JUCE's plugin format wrapping.

---

## Directory Structure

```
plugins/CloudSeed/
├── dsp/                          <- Rust FFI crate (staticlib)
│   ├── Cargo.toml                   depends on cloudseed-rs via relative path
│   └── src/lib.rs                   extern "C" functions (~120 lines)
├── Source/
│   ├── ffi.h                        C declarations for Rust FFI (14 lines)
│   ├── PluginProcessor.h            juce::AudioProcessor subclass
│   ├── PluginProcessor.cpp          parameter loop + FFI forwarding (~160 lines)
│   ├── PluginEditor.h               WebView container
│   ├── PluginEditor.cpp             relay setup + resource provider (~130 lines)
│   └── ui/public/
│       ├── index.html               full UI layout for 45 parameters
│       └── js/
│           ├── index.js             knob rendering, toggle logic, JUCE binding
│           └── juce/
│               ├── index.js         JUCE 8 WebView frontend library (SliderState, ToggleState, etc.)
│               └── check_native_interop.js
└── CMakeLists.txt                   Corrosion + JUCE, macOS AU-only
```

---

## Rust FFI Crate

### Cargo.toml

```toml
[package]
name = "cloudseed_ffi"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["staticlib"]

[dependencies]
cloudseed-rs = { path = "../../../rust-dsp-crates/cloudseed/cloudseed-rs" }
```

Key points:
- Crate type must be `staticlib` to produce a `.a` file for C++ linking.
- Crate name must use underscores, not hyphens. Reason: Rust outputs `lib<crate_name>.a` with underscores regardless of Cargo.toml name, but Corrosion passes the crate name to the linker as `-l<name>`. If name has hyphens, the linker looks for `libcloudseed-ffi.a` which does not exist (actual file is `libcloudseed_ffi.a`). Using underscores in the name avoids this mismatch.

### FFI Interface

```rust
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_create(sample_rate: i32) -> *mut CloudSeedEngine;
pub extern "C" fn cloudseed_destroy(engine: *mut CloudSeedEngine);
pub extern "C" fn cloudseed_set_sample_rate(engine: *mut CloudSeedEngine, sample_rate: i32);
pub extern "C" fn cloudseed_set_parameter(engine: *mut CloudSeedEngine, param_index: u32, value: f32);
pub extern "C" fn cloudseed_process(engine: *mut CloudSeedEngine, in_l: *const f32, in_r: *const f32, out_l: *mut f32, out_r: *mut f32, num_samples: u32);
pub extern "C" fn cloudseed_get_parameter_count() -> u32;
pub extern "C" fn cloudseed_get_parameter(engine: *mut CloudSeedEngine, param_index: u32) -> f32;
pub extern "C" fn cloudseed_get_state(engine: *mut CloudSeedEngine, buffer: *mut u8, buffer_size: u32) -> u32;
pub extern "C" fn cloudseed_set_state(engine: *mut CloudSeedEngine, buffer: *const u8, size: u32);
pub extern "C" fn cloudseed_clear_buffers(engine: *mut CloudSeedEngine);
```

The engine struct holds a `ReverbController` and a `[f64; 45]` parameter cache for serialization.

---

## C++ Bridge

### PluginProcessor.cpp

Core processBlock implementation:

```cpp
void CloudSeedAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    // Push all APVTS parameters to Rust
    for (int i = 0; i < NUM_PARAMS; ++i)
    {
        float value;
        if (paramIsBool[i])
            value = dynamic_cast<juce::AudioParameterBool*>(apvts.getParameter(paramIds[i]))->get() ? 1.0f : 0.0f;
        else
            value = apvts.getRawParameterValue(paramIds[i])->load();
        cloudseed_set_parameter(dspEngine, i, value);
    }

    // Forward audio buffers to Rust
    cloudseed_process(dspEngine, inL, inR, outL, outR, numSamples);
}
```

Parameter layout is created in a loop from static arrays (paramIds, paramNames, paramIsBool, paramDefaults). Boolean params use AudioParameterBool, continuous params use AudioParameterFloat with 0-1 range.

### PluginEditor.cpp

Uses JUCE 8's WebView parameter binding system:
- `WebSliderRelay` for 35 continuous parameters
- `WebToggleButtonRelay` for 10 boolean parameters
- `WebSliderParameterAttachment` / `WebToggleButtonParameterAttachment` for bidirectional binding
- `WebBrowserComponent` with `.withNativeIntegrationEnabled()` and `.withResourceProvider()`
- Resources served from BinaryData (embedded at compile time)

Member declaration order is critical (prevents DAW crash on unload):
1. Relays (destroyed last)
2. WebBrowserComponent (destroyed middle)
3. Attachments (destroyed first)

### Channel Layout Support

`isBusesLayoutSupported` must accept mono configurations for the plugin to appear on mono tracks in Logic Pro:

```cpp
bool isBusesLayoutSupported(const BusesLayout& layouts) const
{
    auto outSet = layouts.getMainOutputChannelSet();
    auto inSet = layouts.getMainInputChannelSet();
    if (outSet == juce::AudioChannelSet::stereo())
        return inSet == juce::AudioChannelSet::stereo() || inSet == juce::AudioChannelSet::mono();
    if (outSet == juce::AudioChannelSet::mono())
        return inSet == juce::AudioChannelSet::mono();
    return false;
}
```

processBlock handles mono input by passing the same pointer for both L and R to the Rust stereo processor.

---

## Web UI

### JUCE 8 WebView Parameter Protocol

JUCE 8 provides a JavaScript library (js/juce/index.js) that exposes:
- `getSliderState(name)` -> `SliderState` object with `.getNormalisedValue()`, `.setNormalisedValue()`, `.sliderDragStarted()`, `.sliderDragEnded()`, `.valueChangedEvent`
- `getToggleState(name)` -> `ToggleState` object with `.getValue()`, `.setValue()`, `.valueChangedEvent`

The name string must match the relay name declared in C++ (e.g., `"late_line_decay"`).

### UI Implementation

All 45 parameters rendered as either SVG arc knobs (continuous) or CSS toggle switches (boolean). Knob interaction: vertical mouse drag with shift-for-fine-control. Double-click resets to default.

Parameter value display uses the same scaling formulas as the Rust `scale_param` function to show physical units (Hz, ms, dB, %).

---

## CMake Build System

### Corrosion Integration

```cmake
include(FetchContent)
FetchContent_Declare(Corrosion GIT_REPOSITORY https://github.com/corrosion-rs/corrosion.git GIT_TAG v0.5.1)
FetchContent_MakeAvailable(Corrosion)
corrosion_import_crate(MANIFEST_PATH dsp/Cargo.toml)
target_link_libraries(CloudSeed PRIVATE cloudseed_ffi ...)
```

Corrosion handles:
- Detecting the Rust toolchain
- Running cargo build with the correct target
- Copying the output .a file to the CMake build directory
- Creating a CMake imported target that other targets can link against

### AU-Only Build

```cmake
set(PLUGIN_FORMATS AU Standalone)
juce_add_plugin(CloudSeed
    FORMATS ${PLUGIN_FORMATS}
    AU_MAIN_TYPE kAudioUnitType_Effect
    ...
)
```

### Binary Data for Web Resources

```cmake
juce_add_binary_data(CloudSeed_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/js/index.js
        Source/ui/public/js/juce/index.js
        Source/ui/public/js/juce/check_native_interop.js
)
```

JUCE embeds these files into C++ source as byte arrays. The resource provider in PluginEditor.cpp maps URL paths to BinaryData symbols. Note: when multiple files have the same name in different directories (e.g., two `index.js`), JUCE mangles the BinaryData symbol for the second one as `index_js2`.

---

## Build Commands

```bash
# Configure (first time or after CMakeLists changes)
cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64

# Build AU
cmake --build build --target CloudSeed_AU --config Release -j$(sysctl -n hw.ncpu)

# Install
cp -R build/plugins/CloudSeed/CloudSeed_artefacts/Release/AU/CloudSeed.component ~/Library/Audio/Plug-Ins/Components/

# Validate
auval -v aufx CSed Nfld
```

---

## Validation

`auval -v aufx CSed Nfld` passes all tests:
- Render tests at multiple sample rates (11025, 22050, 44100, 48000, 96000, 192000 Hz)
- Slicing render test
- Connection semantics
- Parameter setting (AudioUnitSetParameter and AudioUnitScheduleParameter)
- Ramped parameter scheduling
- MIDI
- Channel configurations: [1,1] [1,2] [2,2]

---

## Pitfalls Encountered

### 1. Corrosion crate name with hyphens

Problem: Cargo.toml name `cloudseed-ffi` causes Rust to output `libcloudseed_ffi.a` (underscores), but Corrosion passes `-lcloudseed-ffi` (hyphens) to the linker. Linker error: `ld: library 'cloudseed-ffi' not found`.

Solution: Use underscores in the crate name: `name = "cloudseed_ffi"`.

### 2. Logic Pro not showing plugin on mono tracks

Problem: `isBusesLayoutSupported` only accepted stereo-stereo, so Logic Pro hid the plugin from mono channel strips.

Solution: Accept mono-mono and mono-stereo layouts in `isBusesLayoutSupported`. Handle mono input in processBlock by passing the same channel pointer for both L and R.

### 3. Logic Pro AU cache

Problem: After installing a new/updated AU, Logic Pro may not show it because it caches plugin validation results aggressively.

Solution: Kill AudioComponentRegistrar, delete AU cache files, then restart Logic Pro:
```bash
killall -9 AudioComponentRegistrar
rm -rf ~/Library/Caches/AudioUnitCache/
rm -rf ~/Library/Caches/com.apple.logic10/
```
Logic Pro will re-validate all plugins on next launch.

### 4. JUCE WebView member destruction order

Problem: If WebBrowserComponent is destroyed before parameter attachments, or relays are destroyed before the WebView, the DAW crashes on plugin unload.

Solution: Declare members in this exact order in the Editor header:
1. Relays (destroyed last in reverse declaration order)
2. WebBrowserComponent (destroyed middle)
3. Attachments (destroyed first)

### 5. BinaryData name mangling for same-named files

Problem: Two files named `index.js` in different directories (`js/index.js` and `js/juce/index.js`) get mangled by JUCE's BinaryData generator. The second one becomes `index_js2` / `index_js2Size`.

Solution: In the resource provider, map URL paths explicitly to the correct BinaryData symbols.

---

## Performance Characteristics

- Rust static library adds zero runtime overhead (direct function call, no IPC, no serialization)
- The 45-parameter loop in processBlock reads atomics and calls `cloudseed_set_parameter` per block (not per sample), negligible cost
- WebView UI runs in a separate process/thread on macOS (WKWebView), does not affect audio thread
- Timer callback at 30Hz for potential visualization updates (currently unused since all parameter sync is handled by JUCE relays)

---

## What Cannot Be Moved Out of C++

These are the irreducible minimum required by JUCE's plugin format:
1. `juce::AudioProcessor` subclass declaration and virtual method overrides
2. `createPluginFilter()` factory function (AU entry point)
3. APVTS parameter layout creation (JUCE types required for AU host parameter enumeration)
4. `juce::AudioProcessorEditor` subclass (WebView host container)
5. WebSliderRelay / WebToggleButtonRelay declarations and attachment creation (JUCE C++ objects)
6. `getStateInformation` / `setStateInformation` (can delegate payload to Rust but the JUCE interface is C++)

Everything else is in Rust or JavaScript.
