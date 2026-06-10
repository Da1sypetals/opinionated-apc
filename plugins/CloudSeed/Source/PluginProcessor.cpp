#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "ffi.h"

// 参数 ID 字符串（与 Rust parameter module 对应）
const juce::String CloudSeedAudioProcessor::paramIds[NUM_PARAMS] = {
    "interpolation", "low_cut_enabled", "high_cut_enabled", "input_mix",
    "low_cut", "high_cut", "dry_out", "early_out", "late_out",
    "tap_enabled", "tap_count", "tap_decay", "tap_predelay", "tap_length",
    "early_diffuse_enabled", "early_diffuse_count", "early_diffuse_delay",
    "early_diffuse_mod_amount", "early_diffuse_feedback", "early_diffuse_mod_rate",
    "late_mode", "late_line_count", "late_diffuse_enabled", "late_diffuse_count",
    "late_line_size", "late_line_mod_amount", "late_diffuse_delay",
    "late_diffuse_mod_amount", "late_line_decay", "late_line_mod_rate",
    "late_diffuse_feedback", "late_diffuse_mod_rate",
    "eq_low_shelf_enabled", "eq_high_shelf_enabled", "eq_lowpass_enabled",
    "eq_low_freq", "eq_high_freq", "eq_cutoff", "eq_low_gain", "eq_high_gain",
    "eq_cross_seed",
    "seed_tap", "seed_diffusion", "seed_delay", "seed_post_diffusion"
};

const juce::String CloudSeedAudioProcessor::paramNames[NUM_PARAMS] = {
    "Interpolation", "Low Cut Enable", "High Cut Enable", "Input Mix",
    "Low Cut", "High Cut", "Dry", "Early", "Late",
    "Multitap Enable", "Tap Count", "Tap Decay", "Pre-Delay", "Tap Length",
    "Early Diffusion", "Diffusion Stages", "Diffusion Delay",
    "Diffusion Mod Amt", "Diffusion Feedback", "Diffusion Mod Rate",
    "Late Mode", "Line Count", "Late Diffusion", "Late Diff Stages",
    "Size", "Line Mod Amt", "Late Diff Delay",
    "Late Diff Mod Amt", "Decay", "Line Mod Rate",
    "Late Diff Feedback", "Late Diff Mod Rate",
    "Low Shelf", "High Shelf", "Lowpass",
    "Low Freq", "High Freq", "Cutoff", "Low Gain", "High Gain",
    "Cross Seed",
    "Tap Seed", "Diffusion Seed", "Delay Seed", "Post Diff Seed"
};

const bool CloudSeedAudioProcessor::paramIsBool[NUM_PARAMS] = {
    true, true, true, false,         // 0-3
    false, false, false, false, false, // 4-8
    true, false, false, false, false, // 9-13
    true, false, false, false, false, false, // 14-19
    true, false, true, false,         // 20-23
    false, false, false, false, false, false, false, false, // 24-31
    true, true, true,                 // 32-34
    false, false, false, false, false, false, // 35-40
    false, false, false, false        // 41-44
};

// Dark Plate 预设默认值
const float CloudSeedAudioProcessor::paramDefaults[NUM_PARAMS] = {
    1.0f, 1.0f, 0.0f, 0.2347f,
    0.64f, 0.2933f, 0.8706f, 0.0f, 0.6614f,
    0.0f, 0.196f, 1.0f, 0.0f, 0.9867f,
    0.0f, 0.296f, 0.3067f, 0.1439f, 0.7707f, 0.2467f,
    1.0f, 1.0f, 1.0f, 0.488f,
    0.4694f, 0.272f, 0.24f, 0.1468f, 0.6346f, 0.2293f, 0.8507f, 0.1667f,
    0.0f, 1.0f, 0.0f,
    0.388f, 0.5134f, 0.976f, 0.556f, 0.768f, 0.0f,
    0.334f, 0.185f, 0.2181f, 0.3653f
};

CloudSeedAudioProcessor::CloudSeedAudioProcessor()
    : AudioProcessor (BusesProperties()
                        .withInput  ("Input",  juce::AudioChannelSet::mono(), true)
                        .withOutput ("Output", juce::AudioChannelSet::mono(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
    dspEngine = cloudseed_create(44100);
}

CloudSeedAudioProcessor::~CloudSeedAudioProcessor()
{
    cloudseed_destroy(dspEngine);
}

const juce::String CloudSeedAudioProcessor::getName() const { return JucePlugin_Name; }
bool CloudSeedAudioProcessor::acceptsMidi() const { return false; }
bool CloudSeedAudioProcessor::producesMidi() const { return false; }
bool CloudSeedAudioProcessor::isMidiEffect() const { return false; }
double CloudSeedAudioProcessor::getTailLengthSeconds() const { return 5.0; }
int CloudSeedAudioProcessor::getNumPrograms() { return 1; }
int CloudSeedAudioProcessor::getCurrentProgram() { return 0; }
void CloudSeedAudioProcessor::setCurrentProgram (int) {}
const juce::String CloudSeedAudioProcessor::getProgramName (int) { return "Dark Plate"; }
void CloudSeedAudioProcessor::changeProgramName (int, const juce::String&) {}

void CloudSeedAudioProcessor::prepareToPlay (double sampleRate, int)
{
    cloudseed_set_sample_rate(dspEngine, static_cast<int32_t>(sampleRate));
}

void CloudSeedAudioProcessor::releaseResources() {}

bool CloudSeedAudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
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

void CloudSeedAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

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
        cloudseed_set_parameter(dspEngine, static_cast<uint32_t>(i), value);
    }

    auto numSamples = buffer.getNumSamples();
    auto numInputCh = getTotalNumInputChannels();
    auto numOutputCh = getTotalNumOutputChannels();

    auto* inL = buffer.getReadPointer(0);
    auto* inR = numInputCh > 1 ? buffer.getReadPointer(1) : inL;

    if (numOutputCh == 1)
    {
        // mono→mono: 处理后取左声道
        juce::AudioBuffer<float> tmpOut(2, numSamples);
        cloudseed_process(dspEngine, inL, inR,
                          tmpOut.getWritePointer(0), tmpOut.getWritePointer(1),
                          static_cast<uint32_t>(numSamples));
        buffer.copyFrom(0, 0, tmpOut, 0, 0, numSamples);
    }
    else
    {
        // stereo 输出
        auto* outL = buffer.getWritePointer(0);
        auto* outR = buffer.getWritePointer(1);
        cloudseed_process(dspEngine, inL, inR, outL, outR, static_cast<uint32_t>(numSamples));
    }
}

juce::AudioProcessorEditor* CloudSeedAudioProcessor::createEditor()
{
    return new CloudSeedAudioProcessorEditor(*this);
}

bool CloudSeedAudioProcessor::hasEditor() const { return true; }

void CloudSeedAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    // 序列化 APVTS 参数（标准方式）
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void CloudSeedAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xml(getXmlFromBinary(data, sizeInBytes));
    if (xml && xml->hasTagName(apvts.state.getType()))
    {
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
    }
}

juce::AudioProcessorValueTreeState::ParameterLayout CloudSeedAudioProcessor::createParameterLayout()
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
    return new CloudSeedAudioProcessor();
}
