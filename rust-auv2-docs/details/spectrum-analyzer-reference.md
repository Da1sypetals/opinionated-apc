# Spectrum Analyzer Implementation Reference

This document collects technical requirements and best practices for building a real-time audio spectrum analyzer inside a DAW plugin, synthesized from multiple authoritative sources. It is structured as a checklist of decisions and implementation details, with source links.

---

## 1. FFT Configuration

### FFT Size

Larger FFT = better frequency resolution in low frequencies, slower update rate. Smaller FFT = faster response, worse low-frequency detail.

- 1024: Low resolution. Fast update. Acceptable for simple visualizations.
- 2048: Medium. Common starting point.
- 4096: High. Good balance for music analysis. Used by FabFilter Pro-Q "High" setting.
- 8192: Maximum. Best low-frequency detail. Used by Pro-Q "Maximum" setting. Slower update.

FabFilter Pro-Q exposes this as a user setting (Low/Medium/High/Maximum = 1024/2048/4096/8192).
Voxengo SPAN allows block sizes from 1024 up to 65536.

Sources:
- https://www.fabfilter.com/help/pro-q/using/analyzer
- https://forum.juce.com/t/a-guideline-on-better-spectrum-analyzers/47445

### Hop Size (Overlap)

Controls how often an FFT is computed. Smaller hop = more frequent updates = smoother display but higher CPU.

- hop = fft_size: No overlap. Cheapest. Display updates slowly.
- hop = fft_size / 2: 50% overlap. Standard for visualization.
- hop = fft_size / 4: 75% overlap. Smoother display. Used by many commercial analyzers.
- hop = fft_size / 8 or higher: Very smooth. CPU intensive.

Voxengo SPAN allows overlap up to 93.8%. Higher overlap compensates for the temporal smearing caused by large FFT sizes.

The JUCE community consensus: for visualization (not processing), you do not need to care about overlap-add reconstruction. Just take the latest fft_size samples from the ring buffer whenever you want to compute a new frame.

Sources:
- https://forum.juce.com/t/when-visualising-frequencies-does-it-matter-if-some-audio-is-missed-in-the-fft/61765
- https://gearspace.com/board/mastering-forum/798068-your-voxengo-span-settings.html

### Window Function

Applied to the time-domain samples before FFT to reduce spectral leakage (energy spreading from a signal's true frequency into neighboring bins).

- **Hann**: Standard choice for audio visualization. Good balance of frequency resolution vs leakage. -31.5 dB first sidelobe, 18 dB/oct rolloff. Max amplitude error ~1.5 dB.
- **Blackman-Harris (4-term)**: Better sidelobe suppression (-92 dB) at the cost of wider main lobe. Good for high dynamic range analysis.
- **Flat-top**: Best amplitude accuracy (<0.02 dB error) but worst frequency resolution. Used for calibration, not general visualization.
- **Kaiser (adjustable beta)**: Tunable tradeoff. beta=7.85 approximates Blackman-Harris.

For a general-purpose plugin spectrum analyzer, Hann is the standard choice. If high dynamic range matters (seeing weak signals near strong ones), use Blackman-Harris.

Sources:
- https://www.tek.com/en/blog/window-functions-spectrum-analyzers
- https://www.ap.com/news/fft-windows
- https://ai6g.org/books/dsp/Windowsforspectralanalysis.html

---

## 2. Frequency Axis and Bin Aggregation

### Logarithmic Frequency Scale

The frequency axis must be logarithmic, so each octave occupies equal screen space. This aligns with human pitch perception. A linear frequency axis is wrong for music applications.

Sources:
- https://www.robotplanet.dk/audio/audio_gui_design/
- https://docs.izotope.com/rx11/en/spectrogram-waveform-display.html

### Aggregating FFT Bins into Log-Frequency Display Bands

FFT produces linearly-spaced bins. To display on a log axis, aggregate multiple FFT bins into each display band. Two approaches:

**Energy sum (power sum)**: Sum |X[k]|^2 for all FFT bins k in the display band's frequency range. Convert the summed power to dB. This preserves total energy. Used when you want accurate power representation.

**Max**: Take the maximum |X[k]| among all FFT bins in the range. Preserves peaks, but overestimates broadband energy. SPAN uses max by default. StackExchange recommendation: "Don't take the average of the dB. Probably the maximum bin in the range is what you want."

**Mean power**: Sum |X[k]|^2 then divide by the number of bins. This is a power spectral density estimate. More consistent across different display band widths.

Critical rule: **Never average or sum values already in dB**. Always work in linear power domain first, then convert to dB at the end.

Sources:
- https://dsp.stackexchange.com/questions/2121/i-need-advice-about-how-to-make-an-audio-frequency-analyzer
- https://www.crysound.com/blog/octave-band-analysis-guide-fft-binning-vs-filter-bank-method/
- https://www.kvraudio.com/forum/viewtopic.php?t=512258

### Spectral Tilt (Slope)

Tilts the displayed spectrum around a pivot frequency (typically 1 kHz) to compensate for the natural high-frequency rolloff of music. Without tilt, typical music shows a descending slope that makes the display hard to read.

- **4.5 dB/oct**: Default in both FabFilter Pro-Q and Voxengo SPAN. Makes typical music appear roughly flat.
- **3 dB/oct**: Makes pink noise appear flat. Some mastering engineers prefer this.
- **0 dB/oct**: No compensation. Makes white noise appear flat.

Implementation: for each display band with center frequency f, add `tilt_db_per_oct * log2(f / pivot_hz)` to its dB value.

Sources:
- https://www.fabfilter.com/help/pro-q/using/analyzer
- https://www.voxengo.com/files/userguides/VoxengoPrimaryUserGuide_en.pdf
- https://gearspace.com/board/mastering-forum/798068-your-voxengo-span-settings.html

---

## 3. Temporal Smoothing (Ballistics)

Raw FFT output fluctuates rapidly frame-to-frame, making the display jittery and hard to read. Temporal smoothing is applied per display band.

### Smoothing Domain

**Smooth in linear power domain, not dB domain.** Smoothing in dB biases toward peaks and does not correctly reduce the noise floor. Correct pipeline:

1. FFT -> complex magnitudes
2. Compute power (|X|^2) per bin
3. Aggregate into display bands (in power domain)
4. Apply exponential smoothing to the power values
5. Convert smoothed power to dB for display

Sources:
- https://github.com/bearinmindcat/Equalizer314/commit/6eafa7f
- https://dsp.stackexchange.com/questions/49887/correct-method-for-processing-fft-in-realtime

### Smoothing Formula

Single-pole IIR (exponential moving average):

```
smoothed[n] = alpha * smoothed[n-1] + (1 - alpha) * current[n]
```

where `alpha = exp(-1 / (tau * Fs_display))`, tau is the time constant in seconds, and Fs_display is the FFT frame rate (not the audio sample rate).

Equivalent form (saves one multiply):

```
smoothed[n] = current[n] + alpha * (smoothed[n-1] - current[n])
```

### Asymmetric Attack/Release

Use different alpha values for rising vs falling signals:

```
if current > smoothed:
    alpha = attack_alpha    (small alpha = fast attack)
else:
    alpha = release_alpha   (large alpha = slow release)
```

Common values:
- FLUX:: Analyzer: attack = 0 (instant), release = 300ms default.
- FabFilter Pro-Q "Speed" setting: selects the release speed. Attack is instant.
- Many commercial analyzers: attack is instant or very fast (0-10ms), release is user-adjustable.

For plugin visualization, instant attack + configurable release (100-500ms) is standard.

Sources:
- https://doc.flux.audio/analyzer/Spectrum_analyzer.html
- https://dsp.stackexchange.com/questions/97913/exponential-smoothing-time-constant-relation-to-level-of-sine-wave-different-a
- https://dsp.stackexchange.com/questions/35238/is-there-a-technical-term-for-this-simple-method-of-smoothing-out-a-signal

### Where to Apply Smoothing

There are two valid locations:

1. **In the audio/DSP thread (Rust side)**: Apply smoothing to each display band after FFT aggregation, before writing to the SeqLock snapshot. The snapshot always contains smoothed values. JS renders them directly without additional ballistics.

2. **In the UI/render thread (JS side)**: The snapshot contains raw FFT values. JS applies smoothing per frame using requestAnimationFrame timestamps for dt calculation.

Option 1 is preferred when the FFT rate is high enough (e.g., hop=512 at 48kHz = ~94 Hz update rate), because the smoothing happens at the FFT rate which is higher than the display rate (30-60Hz). The UI just displays whatever the snapshot says.

Option 2 is necessary when the data source updates irregularly or when the UI needs to add additional visual effects (peak hold, etc.).

---

## 4. DAW Transport Stop (processBlock Not Called)

### The Problem

Logic Pro (and GarageBand) stops calling processBlock when the transport is stopped. The plugin receives no audio data. The last VizFrame snapshot remains frozen in the SeqLock. The C++ timer in the Editor continues running and keeps pushing the same frozen data to JS.

This is a well-documented Logic limitation, not a bug:
- "Logic (& GarageBand) will not call your processBlock function if the transport is not playing."
- Some DAWs send one or more silence blocks before stopping; others just stop immediately.

### The Standard Solution: Watchdog Timer

The industry-standard approach (from multiple JUCE forum threads):

1. In the Processor, update an atomic timestamp every time processBlock is called:
```cpp
std::atomic<double> lastProcessBlockTime { 0 };

void processBlock(...) {
    lastProcessBlockTime.store(juce::Time::getMillisecondCounterHiRes());
    // ... normal processing
}
```

2. In the Editor timer callback, check if processBlock has been called recently:
```cpp
void timerCallback() {
    double now = juce::Time::getMillisecondCounterHiRes();
    double elapsed = now - audioProcessor.lastProcessBlockTime.load();
    bool isActive = elapsed < 500.0; // 500ms threshold

    if (isActive) {
        // push viz data to JS as normal
    } else {
        // push a "silence" or "inactive" signal to JS
        // JS side handles the decay animation
    }
}
```

3. When the Editor detects inactivity, it either:
   - Stops pushing data to JS, letting JS-side ballistics naturally decay to floor.
   - Pushes a special "inactive" message so JS can trigger a smooth fade-out.
   - Pushes floor-level data so the display smoothly drops.

### Alternative: getTailLengthSeconds

Override `getTailLengthSeconds()` to return a large value. This tells the host to keep calling processBlock after the transport stops (to play out reverb/delay tails). However:
- Not all hosts respect this.
- Logic respects it once playback has started, but not if playback was never started.
- This keeps processing running but wastes CPU when no processing is needed.

### What Commercial Plugins Do

- FabFilter Pro-Q: Spectrum naturally decays to zero when no audio is received. Provides a Freeze button to hold the current display.
- Voxengo SPAN: Same behavior. Spectrum decays according to the release time setting.
- FLUX:: Analyzer: Spectrum decays using the configured release time. Max curve can hold peaks for up to 50 seconds.
- Blue Cat FreqAnalyst: Freeze button stops analysis and display. Bypasses the plugin.

Sources:
- https://forum.juce.com/t/how-to-detect-daw-pause-playing-track-from-plugin/28610
- https://forum.juce.com/t/audioplayhead-currentpositioninfos-isplaying-only-runs-when-audio-is-playing/21942
- https://forum.juce.com/t/how-to-get-reapers-playback-status/56927
- https://forum.juce.com/t/process-block-on-pause/55088
- https://forum.juce.com/t/how-to-detect-if-plugin-is-active/56597

---

## 5. Rendering

### Curve Drawing

For a continuous spectrum curve (not bar graph), options:

- **Polyline (lineTo)**: Simplest. At high display-band count (192+), individual segments are invisible. Perfectly acceptable and most performant. SpectraView uses pure lineTo at 10,000+ points at 60fps.
- **Quadratic Bezier midpoint interpolation**: Smooth curve. Moderate cost. Good visual quality with fewer points.
- **Catmull-Rom / cubic Hermite spline**: Passes through all data points. Higher cost per segment. A JUCE forum user noted: "It might be easier to just p.lineTo and then Path::createPathWithRoundedCorners" rather than computing control points.
- **LTTB downsampling**: For very high point counts, downsample to ~2x screen width using Largest-Triangle-Three-Buckets before drawing. Preserves visual shape.

For 192 display bands on a ~600px-wide canvas, quadratic Bezier or plain lineTo both work well.

Sources:
- https://buttondown.com/latentchemistry/archive/spectraview-canvas-first-spectral-visualization/
- https://forum.juce.com/t/efficient-algorithm-for-cubic-interpolation/55662

### Fill

Area fill under the curve is standard in commercial analyzers. Implementation:

1. Begin path at (x=0, y=floor)
2. Line to (x=0, y=curve[0])
3. Trace the curve (lineTo or Bezier)
4. Line to (x=end, y=floor)
5. closePath -> fill

Important: do not use moveTo inside the fill path trace. moveTo breaks the current subpath, causing closePath to draw a diagonal instead of following the bottom edge. This produces a triangular gap in the fill.

For gradient fill, use a vertical linearGradient from top (higher opacity) to bottom (near transparent).

### HiDPI

Multiply canvas width/height by devicePixelRatio. Set canvas.style.width/height to CSS pixels. Apply ctx.setTransform(DPR, 0, 0, DPR, 0, 0) at the start of each frame.

### Grid

Standard grid lines for a music spectrum analyzer:

Frequency (vertical lines):
- Major: 100 Hz, 1 kHz, 10 kHz (with labels)
- Minor: 20, 30, 40, 50, 60, 80, 200, 300, 400, 500, 600, 800, 2k, 3k, 4k, 5k, 6k, 8k, 20k
- Some analyzers also show note/octave labels

dB (horizontal lines):
- 6 dB or 12 dB intervals are common
- 0 dB line should be visually distinct (brighter/thicker)

Sources:
- https://hydrogenaudio.org/index.php/topic,126403.0.html
- https://www.robotplanet.dk/audio/audio_gui_design/

### Performance in JUCE WebView

JUCE WebView on macOS uses WKWebView. Canvas 2D performance is good for 192-point polylines at 30-60fps. No special optimization needed.

For higher performance needs:
- OffscreenCanvas + Web Worker (not available in WKWebView as of 2024)
- WebGL (available in WKWebView, but complexity is rarely justified for a spectrum curve)
- Reduce redraw area (only redraw the spectrum canvas, not the entire UI)

Sources:
- https://cprimozic.net/blog/building-a-signal-analyzer-with-modern-web-tech/

---

## 6. Peak Hold

A secondary curve that tracks the maximum value reached at each display band, decaying slowly.

- FabFilter Pro-Q: Freeze button (hold maxima indefinitely until released).
- FLUX:: Analyzer: Configurable Max curve with release time up to 50 seconds. Default 50s.
- Voxengo SPAN: Secondary spectrum display options including real-time maximum and all-time maximum.

Implementation: maintain a separate array. Each frame: if new value > held value, update. Otherwise, apply decay (linear or exponential).

Sources:
- https://doc.flux.audio/analyzer/Spectrum_analyzer.html
- https://spectraplus.com/SC_help/peak_hold.htm

---

## 7. Smoothing Modes (Frequency Domain)

In addition to temporal smoothing, some analyzers offer fractional-octave spectral smoothing (e.g., 1/3, 1/6, 1/12 octave). This averages neighboring display bands in the frequency domain to produce a smoother curve shape.

Voxengo SPAN: "Smoothing modes use more complex approach." SPAN uses max over a range of spectral bins, not averaging. "Smoothing is really only a synonym for Kill the peaks." For preserving peaks while smoothing, there is no good linear solution.

This is an optional feature. Most simple spectrum displays do not implement it.

Sources:
- https://www.kvraudio.com/forum/viewtopic.php?t=512258

---

## 8. Alternative to FFT: IIR Filter Banks

Some analyzers use parallel bandpass IIR filters instead of FFT. This approach:

- Provides true constant-Q resolution (each band has bandwidth proportional to frequency)
- Has no ring buffer / spectral leakage issues
- Naturally decays when input stops (IIR filters ring down)
- Can be more efficient than FFT for small band counts
- Has latency proportional to frequency (low frequencies respond slower), which matches human perception

SIR Audio Tools SpectrumAnalyzer offers both FFT and analog-style (IIR bandpass) modes.
The cortix crate uses Gammatone filterbanks (IIR) for this purpose.

However, IIR filter banks also have transient responses when signal changes abruptly (filter ringing), which can cause visible artifacts similar to FFT spectral leakage, particularly in low-frequency bands which have long impulse responses.

Sources:
- https://www.kvraudio.com/forum/viewtopic.php?t=621518
- https://www.siraudiotools.com/Spectrum-Analyzer-Manual.php
