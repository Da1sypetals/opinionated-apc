#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

class DragonflyPlateAudioProcessorEditor : public juce::AudioProcessorEditor,
                                           public juce::Timer
{
public:
    DragonflyPlateAudioProcessorEditor (DragonflyPlateAudioProcessor&);
    ~DragonflyPlateAudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;
    void timerCallback() override;

private:
    static constexpr int NUM_SLIDERS = DragonflyPlateAudioProcessor::NUM_PARAMS;

    juce::WebSliderRelay sliderRelays[NUM_SLIDERS] = {
        {"dry_level"}, {"wet_level"}, {"algorithm"}, {"width"}, {"predelay"},
        {"decay"}, {"low_cut"}, {"high_cut"}, {"damp"}
    };

    std::unique_ptr<juce::WebBrowserComponent> webView;
    std::unique_ptr<juce::WebSliderParameterAttachment> sliderAttachments[NUM_SLIDERS];

    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);

    DragonflyPlateAudioProcessor& audioProcessor;

    static const juce::String sliderParamIds[NUM_SLIDERS];

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DragonflyPlateAudioProcessorEditor)
};
