TOP rule: You are Not allowed to enter plan mode unless explicitly specified by user. Even if user explicitly specify that they want you to enter prime mode, you must double check If user really means it, otherwise, you are strictly not allowed to enter plan mode.

Also you are not allowed to let subagent write code for you. This 100% causes code conflict.

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

You can split `mod`s in Rust code if you think you need to.

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
│       ├── index.html
│       ├── css/style.css
│       └── js/                      index.js, knob.js, format.js, juce/...
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

### UI Implementation

JS/CSS are split into separate files (`index.html` / `style.css` / `index.js` / `knob.js` / `format.js` etc.), loaded via ES6 module `import`. macOS WKWebView fully supports ES6 modules (see pitfall #6).

Parameters are rendered as SVG arc knobs (continuous) or CSS toggle switches (boolean). Interaction: vertical drag to adjust, Shift for fine control, scroll wheel for micro-adjust, double-click to reset.

Parameter value display uses the same scaling formulas as the Rust side to show physical units (Hz, ms, dB, kHz, etc.).

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
    COMPANY_NAME "Da1sypetals"
    PLUGIN_MANUFACTURER_CODE Awin
    PLUGIN_CODE CSed
    FORMATS ${PLUGIN_FORMATS}
    AU_MAIN_TYPE kAudioUnitType_Effect
    ...
)
```

All plugins in this repo use `COMPANY_NAME "Da1sypetals"`. Logic Pro groups plugins by this field in the Audio Units menu. If different plugins use different COMPANY_NAME values, they appear under different submenus. Changing COMPANY_NAME requires rebuilding and reinstalling **all** plugins, then clearing AU caches and restarting Logic.

### Binary Data for Web Resources

JUCE embeds web resources into C++ byte arrays via `juce_add_binary_data`. JS/CSS are split into separate files; shared visualization components are referenced from a repo-level shared directory:

```cmake
juce_add_binary_data(DeBess_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/css/style.css
        Source/ui/public/js/index.js
        Source/ui/public/js/knob.js
        Source/ui/public/js/format.js
        ../../shared/ui/viz/spectrum.js
        ../../shared/ui/viz/timeline.js
        ../../shared/ui/viz/meter.js
        Source/ui/public/js/juce/index.js
        Source/ui/public/js/juce/check_native_interop.js
)
```

BinaryData symbols are derived from the filename only, ignoring the path (see Pitfall #15). Two files with the same name in different directories (e.g., two `index.js`) are mangled as `index_js` and `index_js2`; the resource provider must explicitly map URL paths to the correct symbols.

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

You MUST not build with bare `cmake` commands, You MUST use `build.py` because this is the **only** entrypoint for building a plugin.

---

## Validation

`auval -v aufx CSed Awin` passes all tests:
- Render tests at multiple sample rates (11025, 22050, 44100, 48000, 96000, 192000 Hz)
- Slicing render test
- Connection semantics
- Parameter setting (AudioUnitSetParameter and AudioUnitScheduleParameter)
- Ramped parameter scheduling
- MIDI
- Channel configurations: determined by plugin functionality. E.g., a mono effect supports [1,1]; a stereo reverb supports [1,2] [2,2]; a pure analyzer may only need [2,2]. Declare in `isBusesLayoutSupported` and verify with `auval` that the reported configs match expectations

---

## Pitfalls Encountered

### 1. Corrosion crate name with hyphens

Problem: Cargo.toml name `cloudseed-ffi` causes Rust to output `libcloudseed_ffi.a` (underscores), but Corrosion passes `-lcloudseed-ffi` (hyphens) to the linker. Linker error: `ld: library 'cloudseed-ffi' not found`.

Solution: Use underscores in the crate name: `name = "cloudseed_ffi"`.

### 2. Logic Pro not showing plugin on mono tracks

Problem: `isBusesLayoutSupported` only accepted stereo-stereo, so Logic Pro hid the plugin from mono channel strips.

Solution: If the plugin should support stereo input, accept mono-mono and mono-stereo layouts in `isBusesLayoutSupported`. Handle mono input in processBlock by passing the same channel pointer for both L and R.

### 3. Logic Pro AU cache (multiple layers)

Problem: After changing an AU plugin's capabilities (channel configs, parameter list), Logic Pro does not see the changes. The plugin may be invisible on mono tracks even though `auval` confirms mono support.

Root cause: There are THREE separate AU caches, all of which can hold stale data:

1. **System AudioComponentRegistrar daemon** — in-memory cache of registered AU components.
2. **System AudioComponentCache plist** — `~/Library/Preferences/com.apple.audio.AudioComponentCache.plist`. Stores channel configurations, bus counts, etc.
3. **Logic Pro's own per-plugin cache** — stored inside `~/Library/Preferences/com.apple.logic10.plist` under keys like `"aufx-CSed-Awin"`. Contains its own copy of `ChannelConfigurations`.

Deleting only the system caches (items 1 and 2) does NOT fix the problem if Logic's own plist (item 3) still has stale data. Logic reads its own plist first.

Solution — clear all three:
```bash
killall -9 AudioComponentRegistrar
rm -f ~/Library/Preferences/com.apple.audio.AudioComponentCache.plist
rm -rf ~/Library/Caches/AudioUnitCache/
defaults delete com.apple.logic10 "aufx-CSed-Awin"
```
Then restart Logic Pro. It will re-scan the AU and write fresh entries.

Generalized form for the Logic plist key: `"<type>-<subtype>-<manufacturer>"`, e.g. `"aufx-CSed-Awin"`.

Diagnostic: if `auval` and the AudioComponent C API both report correct channel configs but Logic still hides the plugin, run:
```bash
plutil -p ~/Library/Preferences/com.apple.logic10.plist | grep -A 15 "aufx-CSed-Awin"
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

Solution: In the resource provider, map URL paths explicitly to the correct BinaryData symbols.

### 6. ES6 modules in WKWebView

On macOS with WKWebView, ES6 `<script type="module">` and `import` statements work correctly. All plugins in this repo use separate JS/CSS files with ES6 modules.

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

### 10. WKWebView resource provider URL format

Problem: WKWebView sends resource requests as bare relative paths (`/css/style.css`, `/js/index.js`) instead of full custom-scheme URLs. The commonly used pattern `url.fromFirstOccurrenceOf(getResourceProviderRoot(), ...)` fails — it returns an empty string, causing all resource requests to fallback to `index.html`. The UI appears as unstyled plain text with no interactivity.

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

Note: ES6 module `import` URLs go through a different WKWebView code path that does include the full scheme prefix, so module loading is unaffected. But `<link rel="stylesheet">` and non-module `<script src>` use bare relative paths.

### 11. Logic Pro stops calling processBlock on pause

Problem: When Logic Pro pauses playback, it stops calling `processBlock` entirely — no silence blocks, no callbacks, nothing. If the plugin has visualization, the C++ timer keeps reading the last frozen `SeqLock` snapshot and pushing it to JS. The spectrum display freezes at its last value instead of decaying to silence.

This is well-documented behavior, not a bug: https://forum.juce.com/t/process-block-on-pause/55088

Solution: Implement the watchdog timer pattern documented in `rust-auv2-docs/viz-architecture.md` (Layer 4). `processBlock` updates an atomic timestamp; `timerCallback` detects staleness and drives Rust-side decay.

### 12. COMPANY_NAME determines Logic Pro plugin grouping

Problem: Logic Pro groups third-party AU plugins by the `COMPANY_NAME` field from CMakeLists.txt, shown under Audio Units → \<COMPANY_NAME\> → \<plugin\>. If two plugins in the same repo use different COMPANY_NAME values (e.g., one says "Airwindows", another says "Da1sypetals"), they appear under different submenus.

Solution: All plugins in this repo must use `COMPANY_NAME "Da1sypetals"`. When changing COMPANY_NAME, rebuild and reinstall **every** plugin, clear AU caches, and restart Logic.

### 13. auval passing does not guarantee Logic Pro will load the plugin

Problem: `auval -v aufx XXXX YYYY` passes all tests, system `AudioComponent` API reports the plugin as registered, but Logic Pro still shows "plugin unavailable" or hides it from the insert menu.

Root cause: Logic has its own per-plugin validation cache (pitfall #3) that is independent of `auval`. Logic may also refuse to load a plugin if it was previously marked as failed in a prior session, or if a project references a stale plugin instance.

Solution: Always run `build.py all` (which includes cache clearing). If Logic still refuses, check the Logic plist for stale entries and delete them. If Logic is stuck on a project that references an unavailable plugin, dismiss the error dialog — Logic will still open; then manually re-insert the plugin.

### 14. Canvas fill path breaks when moveTo is used mid-path

Problem: When drawing a filled area under a spectrum curve, calling `moveTo` inside the fill path (e.g., at the start of the curve trace) breaks the subpath. `closePath` then draws a diagonal line from the last point back to the `moveTo` point instead of following the bottom edge, producing a triangular gap in the fill.

Solution: Split curve tracing into two functions: `_curveThrough(ctx, arr, w, h)` (no `moveTo`, only `quadraticCurveTo` + `lineTo`, for use inside fill paths where the start position is already set) and `_tracePath(ctx, arr, w, h)` (includes `moveTo`, for stroke-only paths).

### 15. BinaryData symbols are path-independent — shared files work

Problem (non-obvious): When multiple plugins reference the same JS file from a shared directory (e.g., `../../shared/ui/viz/spectrum.js`), it's unclear whether the BinaryData symbol will change.

Fact: JUCE BinaryData symbols are derived from the **filename only**, ignoring the directory path. `../../shared/ui/viz/spectrum.js` produces `BinaryData::spectrum_js`, identical to what `Source/ui/public/js/viz/spectrum.js` would produce. The C++ resource provider does not need to change when files are moved to a shared directory.

This enables the pattern: put reusable JS components in `shared/ui/viz/`, reference them from each plugin's CMakeLists.txt, and the C++ code remains identical across plugins.

### 16. Width jitter in dynamic content containers

Problem: A container using `width: fit-content` or flex auto-sizing changes width when its content changes (e.g., switching between tabs/presets with different text lengths). This causes visible layout twitching.

Example: A bank/preset tab list where "Medium Halls" is 2px wider than "Rooms", causing the entire box to resize on every tab click.

Solution: Fix the width of the column that contains variable-length text. Use `width: <fixed>px; flex-shrink: 0` on the text column so it never resizes regardless of content. You must use a Playwright script to click through all states and assert the container width is constant:

```python
for tab in tabs:
    tab.click()
    widths.append(box.getBoundingClientRect().width)
assert len(set(widths)) == 1  # all widths identical
```

---

## Performance Characteristics

- Rust static library adds zero runtime overhead (direct function call, no IPC, no serialization)
- The 45-parameter loop in processBlock reads atomics and calls `cloudseed_set_parameter` per block (not per sample), negligible cost
- WebView UI runs in a separate process/thread on macOS (WKWebView), does not affect audio thread
- Timer callback at 30Hz for visualization updates. See `rust-auv2-docs/viz-architecture.md` for the full data flow.

---

## Visualization

For plugins with real-time visualization (spectrum, GR timeline, meters), see `rust-auv2-docs/viz-architecture.md` for the full architecture, code templates, and component API reference.

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
