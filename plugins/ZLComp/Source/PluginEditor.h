#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

class ZLCompAudioProcessorEditor : public juce::AudioProcessorEditor,
                                   public juce::Timer
{
public:
    ZLCompAudioProcessorEditor (ZLCompAudioProcessor&);
    ~ZLCompAudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;
    void timerCallback() override;

private:
    static constexpr int NUM_SLIDERS = 16;
    static constexpr int NUM_TOGGLES = 4;

    // 1. RELAYS (slider参数: 0-10, 13, 16, 17, 18, 14 => 16个连续参数)
    juce::WebSliderRelay sliderRelays[NUM_SLIDERS] = {
        {"threshold"}, {"ratio"}, {"knee"}, {"attack"}, {"release"},
        {"pump"}, {"smooth"}, {"hold"}, {"range"}, {"makeup"},
        {"wet"}, {"lookahead"}, {"rms_length"}, {"rms_speed"}, {"rms_mix"}, {"style"}
    };
    juce::WebToggleButtonRelay toggleRelays[NUM_TOGGLES] = {
        {"bypass"}, {"range_inf"}, {"rms_on"}, {"stereo_mode"}
    };

    // 2. WEBVIEW
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. ATTACHMENTS
    std::unique_ptr<juce::WebSliderParameterAttachment> sliderAttachments[NUM_SLIDERS];
    std::unique_ptr<juce::WebToggleButtonParameterAttachment> toggleAttachments[NUM_TOGGLES];

    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);

    ZLCompAudioProcessor& audioProcessor;

    static const juce::String sliderParamIds[NUM_SLIDERS];
    static const juce::String toggleParamIds[NUM_TOGGLES];

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ZLCompAudioProcessorEditor)
};
