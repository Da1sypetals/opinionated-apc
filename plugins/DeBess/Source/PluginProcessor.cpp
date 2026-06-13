#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "ffi.h"

// 参数 ID（与 Rust parameter 模块顺序一致）
const juce::String DeBessAudioProcessor::paramIds[NUM_PARAMS] = {
    "intensity", "sharpness", "depth", "filter", "sense_mon"
};

const juce::String DeBessAudioProcessor::paramNames[NUM_PARAMS] = {
    "Amount", "Sharpness", "Range", "Frequency", "Listen"
};

const bool DeBessAudioProcessor::paramIsBool[NUM_PARAMS] = {
    false, false, false, false, true
};

// 默认值，与 DeBess.h 的 kDefaultValue_Param* 一致
const float DeBessAudioProcessor::paramDefaults[NUM_PARAMS] = {
    0.0f, 0.5f, 0.5f, 0.5f, 0.0f
};

DeBessAudioProcessor::DeBessAudioProcessor()
    : AudioProcessor (BusesProperties()
                        .withInput  ("Input",  juce::AudioChannelSet::mono(), true)
                        .withOutput ("Output", juce::AudioChannelSet::mono(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
    dspEngine = debess_create(44100);
}

DeBessAudioProcessor::~DeBessAudioProcessor()
{
    debess_destroy(dspEngine);
}

const juce::String DeBessAudioProcessor::getName() const { return JucePlugin_Name; }
bool DeBessAudioProcessor::acceptsMidi() const { return false; }
bool DeBessAudioProcessor::producesMidi() const { return false; }
bool DeBessAudioProcessor::isMidiEffect() const { return false; }
double DeBessAudioProcessor::getTailLengthSeconds() const { return 0.0; }
int DeBessAudioProcessor::getNumPrograms() { return 1; }
int DeBessAudioProcessor::getCurrentProgram() { return 0; }
void DeBessAudioProcessor::setCurrentProgram (int) {}
const juce::String DeBessAudioProcessor::getProgramName (int) { return "Default"; }
void DeBessAudioProcessor::changeProgramName (int, const juce::String&) {}

void DeBessAudioProcessor::prepareToPlay (double sampleRate, int)
{
    debess_set_sample_rate(dspEngine, static_cast<int32_t>(sampleRate));
}

void DeBessAudioProcessor::releaseResources() {}

bool DeBessAudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
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

void DeBessAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    lastProcessBlockTime.store(juce::Time::getMillisecondCounterHiRes(), std::memory_order_relaxed);

    // 将所有 APVTS 参数推送到 Rust
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
        debess_set_parameter(dspEngine, static_cast<uint32_t>(i), value);
    }

    auto numSamples = buffer.getNumSamples();
    auto numInputCh = getTotalNumInputChannels();
    auto numOutputCh = getTotalNumOutputChannels();

    auto* inL = buffer.getReadPointer(0);
    auto* inR = numInputCh > 1 ? buffer.getReadPointer(1) : inL;

    if (numOutputCh == 1)
    {
        juce::AudioBuffer<float> tmpOut(2, numSamples);
        debess_process(dspEngine, inL, inR,
                       tmpOut.getWritePointer(0), tmpOut.getWritePointer(1),
                       static_cast<uint32_t>(numSamples));
        buffer.copyFrom(0, 0, tmpOut, 0, 0, numSamples);
    }
    else
    {
        auto* outL = buffer.getWritePointer(0);
        auto* outR = buffer.getWritePointer(1);
        debess_process(dspEngine, inL, inR, outL, outR, static_cast<uint32_t>(numSamples));
    }
}

const char* DeBessAudioProcessor::getVizJson()
{
    return debess_get_viz_json(dspEngine);
}

void DeBessAudioProcessor::vizDecay()
{
    debess_viz_decay(dspEngine);
}

juce::AudioProcessorEditor* DeBessAudioProcessor::createEditor()
{
    return new DeBessAudioProcessorEditor(*this);
}

bool DeBessAudioProcessor::hasEditor() const { return true; }

void DeBessAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void DeBessAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xml(getXmlFromBinary(data, sizeInBytes));
    if (xml && xml->hasTagName(apvts.state.getType()))
    {
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
    }
}

juce::AudioProcessorValueTreeState::ParameterLayout DeBessAudioProcessor::createParameterLayout()
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
    return new DeBessAudioProcessor();
}
