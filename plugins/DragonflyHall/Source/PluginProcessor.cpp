#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "ffi.h"

const juce::String DragonflyHallAudioProcessor::paramIds[NUM_PARAMS] = {
    "dry_level", "early_level", "late_level", "size", "width", "predelay", "diffuse", "low_cut",
    "low_xo", "low_mult", "high_cut", "high_xo", "high_mult", "spin", "wander", "decay",
    "early_send", "modulation"
};

const juce::String DragonflyHallAudioProcessor::paramNames[NUM_PARAMS] = {
    "Dry Level", "Early Level", "Late Level", "Size", "Width", "Predelay", "Diffuse", "Low Cut",
    "Low Cross", "Low Mult", "High Cut", "High Cross", "High Mult", "Spin", "Wander", "Decay",
    "Early Send", "Modulation"
};

const float DragonflyHallAudioProcessor::paramMins[NUM_PARAMS] = {
    0.0f, 0.0f, 0.0f, 10.0f, 50.0f, 0.0f, 0.0f, 0.0f, 200.0f, 0.5f,
    1000.0f, 1000.0f, 0.2f, 0.0f, 0.0f, 0.1f, 0.0f, 0.0f
};

const float DragonflyHallAudioProcessor::paramMaxs[NUM_PARAMS] = {
    100.0f, 100.0f, 100.0f, 60.0f, 150.0f, 100.0f, 100.0f, 200.0f, 1200.0f, 2.5f,
    16000.0f, 16000.0f, 1.2f, 10.0f, 40.0f, 10.0f, 100.0f, 100.0f
};

const float DragonflyHallAudioProcessor::paramDefaults[NUM_PARAMS] = {
    80.0f, 10.0f, 20.0f, 24.0f, 100.0f, 4.0f, 90.0f, 4.0f, 500.0f, 1.30f,
    7600.0f, 5500.0f, 0.50f, 3.3f, 15.0f, 1.3f, 20.0f, 15.0f
};

const float DragonflyHallAudioProcessor::paramSteps[NUM_PARAMS] = {
    0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
    0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f
};

const juce::String DragonflyHallAudioProcessor::paramUnits[NUM_PARAMS] = {
    "%", "%", "%", "m", "%", "ms", "%", "Hz", "Hz", "X",
    "Hz", "Hz", "X", "Hz", "ms", "s", "%", "%"
};

const int DragonflyHallAudioProcessor::paramDecimals[NUM_PARAMS] = {
    1, 1, 1, 0, 0, 0, 0, 0, 0, 1,
    0, 0, 1, 2, 1, 1, 1, 0
};

DragonflyHallAudioProcessor::DragonflyHallAudioProcessor()
    : AudioProcessor (BusesProperties()
                        .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                        .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
    dspEngine = dfhall_create(44100);
}

DragonflyHallAudioProcessor::~DragonflyHallAudioProcessor()
{
    dfhall_destroy(dspEngine);
}

const juce::String DragonflyHallAudioProcessor::getName() const { return JucePlugin_Name; }
bool DragonflyHallAudioProcessor::acceptsMidi() const { return false; }
bool DragonflyHallAudioProcessor::producesMidi() const { return false; }
bool DragonflyHallAudioProcessor::isMidiEffect() const { return false; }
double DragonflyHallAudioProcessor::getTailLengthSeconds() const { return 10.0; }
int DragonflyHallAudioProcessor::getNumPrograms() { return 1; }
int DragonflyHallAudioProcessor::getCurrentProgram() { return 0; }
void DragonflyHallAudioProcessor::setCurrentProgram (int) {}
const juce::String DragonflyHallAudioProcessor::getProgramName (int) { return "Small Clear Hall"; }
void DragonflyHallAudioProcessor::changeProgramName (int, const juce::String&) {}

void DragonflyHallAudioProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    dfhall_set_sample_rate(dspEngine, static_cast<int32_t>(sampleRate), static_cast<int32_t>(samplesPerBlock));
}

void DragonflyHallAudioProcessor::releaseResources() {}

bool DragonflyHallAudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto inSet = layouts.getMainInputChannelSet();
    const auto outSet = layouts.getMainOutputChannelSet();
    return (inSet == juce::AudioChannelSet::mono() && outSet == juce::AudioChannelSet::mono())
        || (inSet == juce::AudioChannelSet::mono() && outSet == juce::AudioChannelSet::stereo())
        || (inSet == juce::AudioChannelSet::stereo() && outSet == juce::AudioChannelSet::stereo());
}

void DragonflyHallAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int numSamples = buffer.getNumSamples();
    if (numSamples == 0)
        return;

    for (int i = 0; i < NUM_PARAMS; ++i)
        dfhall_set_parameter(dspEngine, static_cast<uint32_t>(i), apvts.getRawParameterValue(paramIds[i])->load());

    const int numInputCh = getTotalNumInputChannels();
    const int numOutputCh = getTotalNumOutputChannels();

    juce::AudioBuffer<float> inBuffer(2, numSamples);
    juce::AudioBuffer<float> outBuffer(2, numSamples);
    inBuffer.copyFrom(0, 0, buffer, 0, 0, numSamples);
    if (numInputCh > 1)
        inBuffer.copyFrom(1, 0, buffer, 1, 0, numSamples);
    else
        inBuffer.copyFrom(1, 0, buffer, 0, 0, numSamples);

    dfhall_process(dspEngine,
                   inBuffer.getReadPointer(0),
                   inBuffer.getReadPointer(1),
                   outBuffer.getWritePointer(0),
                   outBuffer.getWritePointer(1),
                   static_cast<uint32_t>(numSamples));

    if (numOutputCh == 1)
    {
        buffer.copyFrom(0, 0, outBuffer.getReadPointer(0), numSamples, 0.5f);
        buffer.addFrom(0, 0, outBuffer.getReadPointer(1), numSamples, 0.5f);
    }
    else
    {
        buffer.copyFrom(0, 0, outBuffer, 0, 0, numSamples);
        buffer.copyFrom(1, 0, outBuffer, 1, 0, numSamples);
    }
}

juce::String DragonflyHallAudioProcessor::getVizJson()
{
    const uint32_t required = dfhall_get_viz_json(dspEngine, nullptr, 0);
    juce::HeapBlock<uint8_t> buffer(required);
    dfhall_get_viz_json(dspEngine, buffer.get(), required);
    return juce::String::fromUTF8(reinterpret_cast<const char*>(buffer.get()));
}

juce::AudioProcessorEditor* DragonflyHallAudioProcessor::createEditor()
{
    return new DragonflyHallAudioProcessorEditor(*this);
}

bool DragonflyHallAudioProcessor::hasEditor() const { return true; }

void DragonflyHallAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void DragonflyHallAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xml(getXmlFromBinary(data, sizeInBytes));
    if (xml && xml->hasTagName(apvts.state.getType()))
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessorValueTreeState::ParameterLayout DragonflyHallAudioProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    for (int i = 0; i < NUM_PARAMS; ++i)
    {
        const auto attributes = juce::AudioParameterFloatAttributes()
            .withLabel(paramUnits[i])
            .withStringFromValueFunction([i] (float value, int) {
                return formatParameterValue(i, value);
            })
            .withValueFromStringFunction([i] (const juce::String& text) {
                return parseParameterValue(i, text);
            });

        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID { paramIds[i], 1 },
            paramNames[i],
            juce::NormalisableRange<float>(paramMins[i], paramMaxs[i], paramSteps[i]),
            paramDefaults[i],
            attributes));
    }

    return layout;
}

juce::String DragonflyHallAudioProcessor::formatParameterValue (int index, float value)
{
    const juce::String text(value, paramDecimals[index]);
    if (paramUnits[index].isEmpty())
        return text;
    if (paramUnits[index] == "%")
        return text + "%";
    return text + " " + paramUnits[index];
}

float DragonflyHallAudioProcessor::parseParameterValue (int index, const juce::String& text)
{
    return juce::jlimit(paramMins[index], paramMaxs[index], text.getFloatValue());
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new DragonflyHallAudioProcessor();
}
