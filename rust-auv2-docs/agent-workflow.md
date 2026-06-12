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
│   ├── PluginEditor.cpp             relay setup + resource provider (~100 lines)
│   └── ui/public/
│       └── index.html               ALL-IN-ONE: HTML + CSS + JS fully inlined (~570 lines)
├── CMakeLists.txt                   Corrosion + JUCE, macOS AU-only
└── build.py                         build/install/clear/validate CLI tool
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

Two things are required for the plugin to appear on mono tracks in Logic Pro:

1. The `BusesProperties` constructor default must be mono, not stereo. If the default is stereo, the AU wrapper may not report mono as a valid initial configuration, and Logic Pro will hide the plugin from mono tracks.

```cpp
CloudSeedAudioProcessor::CloudSeedAudioProcessor()
    : AudioProcessor (BusesProperties()
                        .withInput  ("Input",  juce::AudioChannelSet::mono(), true)
                        .withOutput ("Output", juce::AudioChannelSet::mono(), true)),
```

2. `isBusesLayoutSupported` must accept mono configurations:

```cpp
bool isBusesLayoutSupported(const BusesLayout& layouts) const
{
    auto outSet = layouts.getMainOutputChannelSet();
    auto inSet = layouts.getMainInputChannelSet();
    if (inSet == juce::AudioChannelSet::mono() && outSet == juce::AudioChannelSet::mono())
        return true;
    if (inSet == juce::AudioChannelSet::mono() && outSet == juce::AudioChannelSet::stereo())
        return true;
    if (inSet == juce::AudioChannelSet::stereo() && outSet == juce::AudioChannelSet::stereo())
        return true;
    return false;
}
```

Do NOT use `JucePlugin_PreferredChannelConfigurations` for this. It interacts badly with the AU wrapper and produces incorrect channel capability reports (observed: `[1,2] [2,0]` instead of the correct `[1,1] [1,2] [2,2]`).

processBlock handles mono input by duplicating the single channel pointer for both L and R to the Rust stereo processor. For mono output, it processes in stereo internally and writes only the left channel back.

---

## Web UI

### JUCE 8 WebView Parameter Protocol

JUCE 8 provides a JavaScript library that exposes:
- `getSliderState(name)` -> `SliderState` object with `.getNormalisedValue()`, `.setNormalisedValue()`, `.sliderDragStarted()`, `.sliderDragEnded()`, `.addListener(fn)`
- `getToggleState(name)` -> `ToggleState` object with `.getValue()`, `.setValue()`, `.addListener(fn)`

The name string must match the relay name declared in C++ (e.g., `"late_line_decay"`).

In production, this library must be inlined into `index.html` as plain ES5-compatible JavaScript (function/prototype style, not ES6 class/import). See pitfall #6.

### UI Implementation

All JS and CSS are inlined into a single `index.html`. The JUCE frontend library is reimplemented inline using function constructors and prototype methods (not ES6 classes) to avoid module loading issues.

All 45 parameters rendered as either SVG arc knobs (continuous) or CSS toggle switches (boolean). Knob interaction: vertical mouse drag with shift-for-fine-control. Double-click resets to default.

Parameter value display uses the same scaling formulas as the Rust `scale_param` function to show physical units (Hz, ms, dB, %).

### Layout for 40+ Parameters

Use a sectioned grid layout. Sections are grouped by DSP signal path, not alphabetically. The main area uses `display: grid` with `grid-template-columns: 1fr 1fr 1fr` and `grid-template-rows: auto auto`. The largest section (Late Reverb, 12 params) spans 2 columns via `grid-column: span 2`. A bottom bar holds utility params (seeds) in a horizontal flex row.

Use `auto` for grid row heights, not `1fr`. Fixed `1fr` rows cause overflow when sections have different numbers of parameters. Let the content determine each row's height.

Do not set `overflow: hidden` on section panels. If content exceeds the panel due to knob sizes or spacing, it will be silently clipped with no visible error.

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

Since all JS/CSS is inlined into `index.html`, only one file needs to be embedded:

```cmake
juce_add_binary_data(CloudSeed_WebUI
    SOURCES
        Source/ui/public/index.html
)
```

JUCE embeds this file into C++ source as a byte array (`BinaryData::index_html` / `BinaryData::index_htmlSize`). The resource provider in PluginEditor.cpp maps the root URL to this single resource.

If you must embed multiple files (not recommended for production): when multiple files have the same name in different directories (e.g., two `index.js`), JUCE mangles the BinaryData symbol for the second one as `index_js2`.

---

## Build Commands

A `build.py` script wraps all build operations:

```bash
python3 plugins/CloudSeed/build.py build          # Build AU + Standalone
python3 plugins/CloudSeed/build.py build --au-only # Build AU only
python3 plugins/CloudSeed/build.py install         # Install AU to ~/Library/Audio/Plug-Ins/Components/
python3 plugins/CloudSeed/build.py clear           # Clear all AU caches (system + Logic Pro)
python3 plugins/CloudSeed/build.py validate        # Run auval
python3 plugins/CloudSeed/build.py all             # build --au-only -> install -> clear -> validate
```

Equivalent manual commands:

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64
cmake --build build --target CloudSeed_AU --config Release -j$(sysctl -n hw.ncpu)
cp -R build/plugins/CloudSeed/CloudSeed_artefacts/Release/AU/CloudSeed.component ~/Library/Audio/Plug-Ins/Components/
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

### 3. Logic Pro AU cache (multiple layers)

Problem: After changing an AU plugin's capabilities (channel configs, parameter list), Logic Pro does not see the changes. The plugin may be invisible on mono tracks even though `auval` confirms mono support.

Root cause: There are THREE separate AU caches, all of which can hold stale data:

1. **System AudioComponentRegistrar daemon** — in-memory cache of registered AU components.
2. **System AudioComponentCache plist** — `~/Library/Preferences/com.apple.audio.AudioComponentCache.plist`. Stores channel configurations, bus counts, etc.
3. **Logic Pro's own per-plugin cache** — stored inside `~/Library/Preferences/com.apple.logic10.plist` under keys like `"aufx-CSed-Nfld"`. Contains its own copy of `ChannelConfigurations`.

Deleting only the system caches (items 1 and 2) does NOT fix the problem if Logic's own plist (item 3) still has stale data. Logic reads its own plist first.

Solution — clear all three:
```bash
killall -9 AudioComponentRegistrar
rm -f ~/Library/Preferences/com.apple.audio.AudioComponentCache.plist
rm -rf ~/Library/Caches/AudioUnitCache/
defaults delete com.apple.logic10 "aufx-CSed-Nfld"
```
Then restart Logic Pro. It will re-scan the AU and write fresh entries.

Generalized form for the Logic plist key: `"<type>-<subtype>-<manufacturer>"`, e.g. `"aufx-CSed-Nfld"`.

Diagnostic: if `auval` and the AudioComponent C API both report correct channel configs but Logic still hides the plugin, run:
```bash
plutil -p ~/Library/Preferences/com.apple.logic10.plist | grep -A 15 "aufx-CSed-Nfld"
```
If the cached `ChannelConfigurations` array is wrong, delete the key.

See `rust-auv2-docs/logic-pro-au-cache.md` for the full writeup.

### 4. JUCE WebView member destruction order

Problem: If WebBrowserComponent is destroyed before parameter attachments, or relays are destroyed before the WebView, the DAW crashes on plugin unload.

Solution: Declare members in this exact order in the Editor header:
1. Relays (destroyed last in reverse declaration order)
2. WebBrowserComponent (destroyed middle)
3. Attachments (destroyed first)

### 5. BinaryData name mangling for same-named files

Problem: Two files named `index.js` in different directories (`js/index.js` and `js/juce/index.js`) get mangled by JUCE's BinaryData generator. The second one becomes `index_js2` / `index_js2Size`.

Solution: In the resource provider, map URL paths explicitly to the correct BinaryData symbols. Better solution: inline everything into `index.html` so only one file is embedded. This eliminates the mangling issue entirely.

### 6. ES6 modules: platform-dependent behavior

The WEBVIEW-PRODUCTION-GUIDE in this repo states "ES6 modules DO NOT WORK in WebView". This is a Windows-specific issue (WebView2 + custom URL scheme CORS). On macOS with WKWebView, ES6 `<script type="module">` and `import` statements work correctly. CloudWash ships with separate JS files using ES6 modules on macOS.

Conclusion: on macOS-only builds, splitting JS/CSS into separate files with ES6 modules is safe and works. Inlining is only required for cross-platform builds targeting Windows.

### 7. BusesProperties default determines AU channel visibility

Problem: Setting `BusesProperties` default to stereo in the AudioProcessor constructor causes the AU wrapper to report stereo as the only valid initial configuration. Even if `isBusesLayoutSupported` returns true for mono, Logic Pro may not show the plugin on mono tracks because it checks the initial/default configuration separately.

Solution: Set the default to mono:
```cpp
.withInput("Input", juce::AudioChannelSet::mono(), true)
.withOutput("Output", juce::AudioChannelSet::mono(), true)
```
The AU wrapper will then report mono as a valid initial state. `isBusesLayoutSupported` still handles the runtime negotiation for stereo.

### 8. JucePlugin_PreferredChannelConfigurations produces wrong AU reports

Problem: Using `JucePlugin_PreferredChannelConfigurations={1,1},{1,2},{2,2}` as a compile definition was expected to declare supported channel configs. Instead, the AU wrapper reported `[1,2] [2,0]` (where `[2,0]` is a wildcard meaning "2 in, any out"), losing the explicit `[1,1]` and `[2,2]` entries.

Solution: Do not use `JucePlugin_PreferredChannelConfigurations`. Use `BusesProperties` + `isBusesLayoutSupported` instead. This is the only reliable method for controlling AU channel configuration reporting.

### 9. CSS overflow: hidden silently clips plugin UI

Problem: Setting `overflow: hidden` on section panels causes knobs and toggles at the bottom of a panel to be invisible. Combined with fixed-height grid rows (`grid-template-rows: 1fr 1fr`), this makes it appear as if UI elements are missing, with no visible error.

Solution: Use `overflow: visible` on panels. Use `grid-template-rows: auto auto` instead of `1fr 1fr` so rows size to their content. Set `min-height` instead of `height` on the body and container so the page can grow if needed.

### 10. macOS WKWebView resource provider URL format

Problem: On macOS, WKWebView sends resource requests as bare relative paths (`/css/style.css`, `/js/index.js`) instead of full custom-scheme URLs (`juce://juce.backend/css/style.css`). The commonly used pattern `url.fromFirstOccurrenceOf(getResourceProviderRoot(), ...)` fails because the URL does not contain the root prefix. It returns an empty string, causing all resource requests to fallback to `index.html`. The result is that CSS and JS files are not loaded — the UI appears as unstyled plain text with no interactivity.

This is a macOS-specific issue. On Windows, WebView2 sends full URLs with the `https://juce.backend/` prefix.

Diagnosis: Add `fprintf(stderr, ...)` logging in the resource provider to print the raw URL and the result of `fromFirstOccurrenceOf`. In Release builds, JUCE's `DBG()` macro is stripped, so use `fprintf(stderr, ...)` for debugging.

Solution: Do not rely on `fromFirstOccurrenceOf`. Instead, check whether the URL starts with the root prefix and handle both cases:

```cpp
auto root = juce::WebBrowserComponent::getResourceProviderRoot();
juce::String path;
if (url.startsWith(root))
    path = url.substring(root.length());
else
    path = url;
if (path.startsWith("/"))
    path = path.substring(1);
if (path.isEmpty())
    path = "index.html";
```

This handles both macOS (bare `/css/style.css`) and Windows (`https://juce.backend/css/style.css`).

Note: CloudWash avoids this issue because its HTML loads JS via `<script type="module" src="js/index.js">`. WKWebView's ES6 module loader resolves import URLs through a different code path that does include the full scheme prefix. But `<link rel="stylesheet">` and non-module `<script src>` use bare relative paths on macOS.

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
