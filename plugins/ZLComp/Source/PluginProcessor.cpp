#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "ffi.h"

const juce::String ZLCompAudioProcessor::paramIds[NUM_PARAMS] = {
    "threshold", "ratio", "knee", "attack", "release",
    "pump", "smooth", "hold", "range", "makeup",
    "wet", "bypass", "range_inf", "lookahead", "style",
    "rms_on", "rms_length", "rms_speed", "rms_mix", "stereo_mode"
};

const juce::String ZLCompAudioProcessor::paramNames[NUM_PARAMS] = {
    "Threshold", "Ratio", "Knee", "Attack", "Release",
    "Pump", "Smooth", "Hold", "Range", "Makeup",
    "Wet", "Bypass", "Range INF", "Lookahead", "Style",
    "RMS ON", "RMS Length", "RMS Speed", "RMS Mix", "Stereo Mode"
};

const bool ZLCompAudioProcessor::paramIsBool[NUM_PARAMS] = {
    false, false, false, false, false,
    false, false, false, false, false,
    false, true, true, false, false,
    true, false, false, false, true
};

const float ZLCompAudioProcessor::paramDefaults[NUM_PARAMS] = {
    0.5f, 0.5f, 0.5f, 0.5f, 0.5f,
    0.0f, 0.0f, 0.0f, 1.0f, 0.5f,
    1.0f, 1.0f, 0.0f, 0.0f, 0.0f,
    0.0f, 0.5f, 0.5f, 0.5f, 0.0f
};

ZLCompAudioProcessor::ZLCompAudioProcessor()
    : AudioProcessor (BusesProperties()
                        .withInput  ("Input",  juce::AudioChannelSet::mono(), true)
                        .withOutput ("Output", juce::AudioChannelSet::mono(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
    dspEngine = zlcomp_create(44100);
}

ZLCompAudioProcessor::~ZLCompAudioProcessor()
{
    zlcomp_destroy(dspEngine);
}

const juce::String ZLCompAudioProcessor::getName() const { return JucePlugin_Name; }
bool ZLCompAudioProcessor::acceptsMidi() const { return false; }
bool ZLCompAudioProcessor::producesMidi() const { return false; }
bool ZLCompAudioProcessor::isMidiEffect() const { return false; }
double ZLCompAudioProcessor::getTailLengthSeconds() const { return 0.0; }
int ZLCompAudioProcessor::getNumPrograms() { return 1; }
int ZLCompAudioProcessor::getCurrentProgram() { return 0; }
void ZLCompAudioProcessor::setCurrentProgram (int) {}
const juce::String ZLCompAudioProcessor::getProgramName (int) { return "Default"; }
void ZLCompAudioProcessor::changeProgramName (int, const juce::String&) {}

void ZLCompAudioProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    zlcomp_set_sample_rate(dspEngine, static_cast<int32_t>(sampleRate), static_cast<int32_t>(samplesPerBlock));
}

void ZLCompAudioProcessor::releaseResources() {}

bool ZLCompAudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    auto outSet = layouts.getMainOutputChannelSet();
    auto inSet  = layouts.getMainInputChannelSet();

    if (inSet == juce::AudioChannelSet::mono() && outSet == juce::AudioChannelSet::mono())
        return true;
    if (inSet == juce::AudioChannelSet::mono() && outSet == juce::AudioChannelSet::stereo())
        return true;
    if (inSet == juce::AudioChannelSet::stereo() && outSet == juce::AudioChannelSet::stereo())
        return true;

    return false;
}

void ZLCompAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    lastProcessBlockTime.store(juce::Time::getMillisecondCounterHiRes(), std::memory_order_relaxed);

    for (int i = 0; i < NUM_PARAMS; ++i)
    {
        float value;
        if (paramIsBool[i])
        {
            auto* boolParam = dynamic_cast<juce::AudioParameterBool*>(apvts.getParameter(paramIds[i]));
            value = boolParam->get() ? 1.0f : 0.0f;
        }
        else
        {
            value = apvts.getRawParameterValue(paramIds[i])->load();
        }
        zlcomp_set_parameter(dspEngine, static_cast<uint32_t>(i), value);
    }

    auto numSamples = buffer.getNumSamples();
    if (numSamples == 0)
        return;

    auto numInputCh = getTotalNumInputChannels();
    auto numOutputCh = getTotalNumOutputChannels();

    if (numOutputCh == 1)
    {
        juce::AudioBuffer<float> rightBuffer(1, numSamples);
        rightBuffer.copyFrom(0, 0, buffer, 0, 0, numSamples);
        zlcomp_process(dspEngine,
                       buffer.getWritePointer(0),
                       rightBuffer.getWritePointer(0),
                       static_cast<uint32_t>(numSamples));
    }
    else
    {
        if (numInputCh == 1)
            buffer.copyFrom(1, 0, buffer, 0, 0, numSamples);

        zlcomp_process(dspEngine,
                       buffer.getWritePointer(0),
                       buffer.getWritePointer(1),
                       static_cast<uint32_t>(numSamples));
    }
}

const char* ZLCompAudioProcessor::getVizJson()
{
    return zlcomp_get_viz_json(dspEngine);
}

juce::AudioProcessorEditor* ZLCompAudioProcessor::createEditor()
{
    return new ZLCompAudioProcessorEditor(*this);
}

bool ZLCompAudioProcessor::hasEditor() const { return true; }

void ZLCompAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void ZLCompAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xml(getXmlFromBinary(data, sizeInBytes));
    if (xml && xml->hasTagName(apvts.state.getType()))
    {
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
    }
}

juce::AudioProcessorValueTreeState::ParameterLayout ZLCompAudioProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    for (int i = 0; i < NUM_PARAMS; ++i)
    {
        if (paramIsBool[i])
        {
            layout.add(std::make_unique<juce::AudioParameterBool>(
                paramIds[i], paramNames[i], paramDefaults[i] >= 0.5f));
        }
        else
        {
            layout.add(std::make_unique<juce::AudioParameterFloat>(
                paramIds[i], paramNames[i],
                juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f),
                paramDefaults[i]));
        }
    }

    return layout;
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new ZLCompAudioProcessor();
}
