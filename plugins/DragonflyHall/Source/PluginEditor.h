#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

class DragonflyHallAudioProcessorEditor : public juce::AudioProcessorEditor,
                                          public juce::Timer
{
public:
    DragonflyHallAudioProcessorEditor (DragonflyHallAudioProcessor&);
    ~DragonflyHallAudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;
    void timerCallback() override;

private:
    static constexpr int NUM_SLIDERS = DragonflyHallAudioProcessor::NUM_PARAMS;

    juce::WebSliderRelay sliderRelays[NUM_SLIDERS] = {
        {"dry_level"}, {"early_level"}, {"late_level"}, {"size"}, {"width"}, {"predelay"},
        {"diffuse"}, {"low_cut"}, {"low_xo"}, {"low_mult"}, {"high_cut"}, {"high_xo"},
        {"high_mult"}, {"spin"}, {"wander"}, {"decay"}, {"early_send"}, {"modulation"}
    };

    std::unique_ptr<juce::WebBrowserComponent> webView;
    std::unique_ptr<juce::WebSliderParameterAttachment> sliderAttachments[NUM_SLIDERS];

    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);

    DragonflyHallAudioProcessor& audioProcessor;

    static const juce::String sliderParamIds[NUM_SLIDERS];

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DragonflyHallAudioProcessorEditor)
};
