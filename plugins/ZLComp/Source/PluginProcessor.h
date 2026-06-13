#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

class ZLCompAudioProcessor : public juce::AudioProcessor
{
public:
    ZLCompAudioProcessor();
    ~ZLCompAudioProcessor() override;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override;

    const juce::String getName() const override;
    bool acceptsMidi() const override;
    bool producesMidi() const override;
    bool isMidiEffect() const override;
    double getTailLengthSeconds() const override;

    int getNumPrograms() override;
    int getCurrentProgram() override;
    void setCurrentProgram (int index) override;
    const juce::String getProgramName (int index) override;
    void changeProgramName (int index, const juce::String& newName) override;

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    const char* getVizJson();

    std::atomic<double> lastProcessBlockTime { 0.0 };

    juce::AudioProcessorValueTreeState apvts;

    static constexpr int NUM_PARAMS = 20;

    static const juce::String paramIds[NUM_PARAMS];
    static const juce::String paramNames[NUM_PARAMS];
    static const bool paramIsBool[NUM_PARAMS];
    static const float paramDefaults[NUM_PARAMS];

private:
    juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

    void* dspEngine = nullptr;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ZLCompAudioProcessor)
};
