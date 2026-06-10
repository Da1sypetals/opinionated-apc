#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

/**
 * CloudSeed Editor - WebView UI
 *
 * 成员声明顺序（防止 DAW 卸载崩溃）：
 * 1. Parameter relays（最后销毁）
 * 2. WebBrowserComponent（中间销毁）
 * 3. Parameter attachments（最先销毁）
 */
class CloudSeedAudioProcessorEditor : public juce::AudioProcessorEditor,
                                       public juce::Timer
{
public:
    CloudSeedAudioProcessorEditor (CloudSeedAudioProcessor&);
    ~CloudSeedAudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;
    void timerCallback() override;

private:
    // 1. RELAYS
    juce::WebSliderRelay sliderRelays[35] = {
        {"input_mix"}, {"low_cut"}, {"high_cut"},
        {"dry_out"}, {"early_out"}, {"late_out"},
        {"tap_count"}, {"tap_decay"}, {"tap_predelay"}, {"tap_length"},
        {"early_diffuse_count"}, {"early_diffuse_delay"},
        {"early_diffuse_mod_amount"}, {"early_diffuse_feedback"}, {"early_diffuse_mod_rate"},
        {"late_line_count"}, {"late_diffuse_count"},
        {"late_line_size"}, {"late_line_mod_amount"}, {"late_diffuse_delay"},
        {"late_diffuse_mod_amount"}, {"late_line_decay"}, {"late_line_mod_rate"},
        {"late_diffuse_feedback"}, {"late_diffuse_mod_rate"},
        {"eq_low_freq"}, {"eq_high_freq"}, {"eq_cutoff"},
        {"eq_low_gain"}, {"eq_high_gain"}, {"eq_cross_seed"},
        {"seed_tap"}, {"seed_diffusion"}, {"seed_delay"}, {"seed_post_diffusion"}
    };

    juce::WebToggleButtonRelay toggleRelays[10] = {
        {"interpolation"}, {"low_cut_enabled"}, {"high_cut_enabled"},
        {"tap_enabled"}, {"early_diffuse_enabled"},
        {"late_mode"}, {"late_diffuse_enabled"},
        {"eq_low_shelf_enabled"}, {"eq_high_shelf_enabled"}, {"eq_lowpass_enabled"}
    };

    // 2. WEBVIEW
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. ATTACHMENTS
    std::unique_ptr<juce::WebSliderParameterAttachment> sliderAttachments[35];
    std::unique_ptr<juce::WebToggleButtonParameterAttachment> toggleAttachments[10];

    // Resource provider
    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);
    static const char* getMimeForExtension(const juce::String& ext);

    CloudSeedAudioProcessor& audioProcessor;

    // 连续参数的 ID 列表（与 sliderRelays 顺序对应）
    static const juce::String sliderParamIds[35];
    // 布尔参数的 ID 列表（与 toggleRelays 顺序对应）
    static const juce::String toggleParamIds[10];

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CloudSeedAudioProcessorEditor)
};
