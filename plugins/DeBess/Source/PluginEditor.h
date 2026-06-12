#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

/**
 * DeBess Editor - WebView UI
 *
 * 成员声明顺序（防止 DAW 卸载崩溃）：
 * 1. Relays（最后销毁）
 * 2. WebBrowserComponent（中间销毁）
 * 3. Attachments（最先销毁）
 */
class DeBessAudioProcessorEditor : public juce::AudioProcessorEditor,
                                   public juce::Timer
{
public:
    DeBessAudioProcessorEditor (DeBessAudioProcessor&);
    ~DeBessAudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;
    void timerCallback() override;

private:
    // 1. RELAYS
    juce::WebSliderRelay sliderRelays[4] = {
        {"intensity"}, {"sharpness"}, {"depth"}, {"filter"}
    };
    juce::WebToggleButtonRelay toggleRelays[1] = {
        {"sense_mon"}
    };

    // 2. WEBVIEW
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. ATTACHMENTS
    std::unique_ptr<juce::WebSliderParameterAttachment> sliderAttachments[4];
    std::unique_ptr<juce::WebToggleButtonParameterAttachment> toggleAttachments[1];

    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);

    DeBessAudioProcessor& audioProcessor;

    static const juce::String sliderParamIds[4];
    static const juce::String toggleParamIds[1];

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DeBessAudioProcessorEditor)
};
