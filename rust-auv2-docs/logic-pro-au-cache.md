# Logic Pro AU Plugin Cache: Channel Configuration Staleness

## Problem

After updating an AU plugin's channel configuration (e.g., adding mono support), Logic Pro continues to use stale cached data and does not show the plugin on mono tracks. This happens even when:

- `auval -v aufx <subtype> <manufacturer>` passes all tests including mono render
- Apple's `AudioComponent` C API (`kAudioUnitProperty_SupportedNumChannels`) correctly reports `[1,1] [1,2] [2,2]`
- The system-level `AudioComponentCache.plist` has been deleted

## Root Cause

Logic Pro maintains its own AU validation cache inside `~/Library/Preferences/com.apple.logic10.plist`. Each AU is stored under a key formatted as `aufx-<subtype>-<manufacturer>` (e.g., `aufx-CSed-Nfld`). The value contains a `ChannelConfigurations` array. If this entry was written when the plugin only supported stereo, it reads:

```
"aufx-CSed-Nfld" => {
    "ChannelConfigurations" => [
        0 => [0 => 2, 1 => 2]
    ]
}
```

Logic Pro uses this cached value to filter which plugins appear on a given track type. A mono track requires `[1,1]` or `[1,2]` in the cached configurations. Since the stale entry only has `[2,2]`, Logic hides the plugin from mono tracks.

Restarting Logic Pro, killing `AudioComponentRegistrar`, or deleting the system `AudioComponentCache.plist` does NOT fix this, because Logic's own plist is a separate cache.

## Solution

Delete the stale entry from Logic Pro's preferences:

```bash
defaults delete com.apple.logic10 "aufx-CSed-Nfld"
```

Then restart Logic Pro. On launch, Logic will re-scan the AU and write a fresh entry with the correct channel configurations.

## Generalized Form

```bash
defaults delete com.apple.logic10 "<type>-<subtype>-<manufacturer>"
```

Where `<type>` is `aufx` (effect), `aumu` (instrument), `aumf` (music effect), etc.

## Full Cache Invalidation Procedure

When updating an AU plugin's capabilities (channel configs, parameter list, etc.), run all of these before restarting Logic:

```bash
# 1. Delete Logic's per-plugin cache entry
defaults delete com.apple.logic10 "aufx-CSed-Nfld"

# 2. Delete system AudioComponent cache
rm -f ~/Library/Preferences/com.apple.audio.AudioComponentCache.plist

# 3. Delete system AU cache directory
rm -rf ~/Library/Caches/AudioUnitCache/

# 4. Kill the AudioComponentRegistrar daemon
killall -9 AudioComponentRegistrar 2>/dev/null
```

## Diagnostic Procedure

If a plugin does not appear on a track with expected channel configuration:

1. Verify the AU binary reports correct channel support:
```bash
auval -v aufx <subtype> <manufacturer> 2>&1 | grep "Channel Capabilities"
```

2. If auval shows correct capabilities, check Logic's cached value:
```bash
plutil -p ~/Library/Preferences/com.apple.logic10.plist | grep -A 15 "aufx-<subtype>-<manufacturer>"
```

3. If the cached `ChannelConfigurations` is stale, delete the entry as described above.

4. For deeper verification, compile and run a program that queries `kAudioUnitProperty_SupportedNumChannels` via the AudioToolbox C API. This calls the same code path Logic Pro uses internally. If this reports correct configurations but Logic's plist does not match, the plist is the problem.

## JUCE-Specific Notes

When using JUCE's `BusesProperties` to declare channel support:

- The default bus layout declared in the `AudioProcessor` constructor determines the AU's "initial" channel configuration. Setting the default to mono (`AudioChannelSet::mono()`) ensures the AU wrapper reports mono as a supported initial state.
- `isBusesLayoutSupported()` must return `true` for all desired input/output combinations. The AU wrapper calls this to build the `SupportedNumChannels` property.
- Using `JucePlugin_PreferredChannelConfigurations` is not recommended for this purpose. It interacts poorly with JUCE's AU wrapper and can produce incorrect channel capability reports (observed: `[1,2] [2,0]` instead of `[1,1] [1,2] [2,2]`).
