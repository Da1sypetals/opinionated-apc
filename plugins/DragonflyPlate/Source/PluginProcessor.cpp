#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "ffi.h"

const juce::String DragonflyPlateAudioProcessor::paramIds[NUM_PARAMS] = {
    "dry_level", "wet_level", "algorithm", "width", "predelay", "decay", "low_cut", "high_cut", "damp"
};

const juce::String DragonflyPlateAudioProcessor::paramNames[NUM_PARAMS] = {
    "Dry Level", "Wet Level", "Algorithm", "Width", "Predelay", "Decay", "Low Cut", "High Cut", "Dampen"
};

const float DragonflyPlateAudioProcessor::paramMins[NUM_PARAMS] = {
    0.0f, 0.0f, 0.0f, 50.0f, 0.0f, 0.1f, 0.0f, 1000.0f, 1000.0f
};

const float DragonflyPlateAudioProcessor::paramMaxs[NUM_PARAMS] = {
    100.0f, 100.0f, 2.0f, 150.0f, 100.0f, 10.0f, 200.0f, 16000.0f, 16000.0f
};

const float DragonflyPlateAudioProcessor::paramDefaults[NUM_PARAMS] = {
    80.0f, 20.0f, 1.0f, 100.0f, 0.0f, 0.4f, 200.0f, 16000.0f, 13000.0f
};

const float DragonflyPlateAudioProcessor::paramSteps[NUM_PARAMS] = {
    0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f
};

const juce::String DragonflyPlateAudioProcessor::paramUnits[NUM_PARAMS] = {
    "%", "%", "", "%", "ms", "s", "Hz", "Hz", "Hz"
};

const int DragonflyPlateAudioProcessor::paramDecimals[NUM_PARAMS] = {
    1, 1, 0, 0, 0, 1, 0, 0, 0
};

DragonflyPlateAudioProcessor::DragonflyPlateAudioProcessor()
    : AudioProcessor (BusesProperties()
                        .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                        .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
    dspEngine = dfplate_create(44100);
}

DragonflyPlateAudioProcessor::~DragonflyPlateAudioProcessor()
{
    dfplate_destroy(dspEngine);
}

const juce::String DragonflyPlateAudioProcessor::getName() const { return JucePlugin_Name; }
bool DragonflyPlateAudioProcessor::acceptsMidi() const { return false; }
bool DragonflyPlateAudioProcessor::producesMidi() const { return false; }
bool DragonflyPlateAudioProcessor::isMidiEffect() const { return false; }
double DragonflyPlateAudioProcessor::getTailLengthSeconds() const { return 10.0; }
int DragonflyPlateAudioProcessor::getNumPrograms() { return 1; }
int DragonflyPlateAudioProcessor::getCurrentProgram() { return 0; }
void DragonflyPlateAudioProcessor::setCurrentProgram (int) {}
const juce::String DragonflyPlateAudioProcessor::getProgramName (int) { return "Bright Plate"; }
void DragonflyPlateAudioProcessor::changeProgramName (int, const juce::String&) {}

void DragonflyPlateAudioProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    dfplate_set_sample_rate(dspEngine, static_cast<int32_t>(sampleRate), static_cast<int32_t>(samplesPerBlock));
}

void DragonflyPlateAudioProcessor::releaseResources() {}

bool DragonflyPlateAudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto inSet = layouts.getMainInputChannelSet();
    const auto outSet = layouts.getMainOutputChannelSet();
    return (inSet == juce::AudioChannelSet::mono() && outSet == juce::AudioChannelSet::mono())
        || (inSet == juce::AudioChannelSet::mono() && outSet == juce::AudioChannelSet::stereo())
        || (inSet == juce::AudioChannelSet::stereo() && outSet == juce::AudioChannelSet::stereo());
}

void DragonflyPlateAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int numSamples = buffer.getNumSamples();
    if (numSamples == 0)
        return;

    for (int i = 0; i < NUM_PARAMS; ++i)
        dfplate_set_parameter(dspEngine, static_cast<uint32_t>(i), apvts.getRawParameterValue(paramIds[i])->load());

    const int numInputCh = getTotalNumInputChannels();
    const int numOutputCh = getTotalNumOutputChannels();

    juce::AudioBuffer<float> inBuffer(2, numSamples);
    juce::AudioBuffer<float> outBuffer(2, numSamples);
    inBuffer.copyFrom(0, 0, buffer, 0, 0, numSamples);
    if (numInputCh > 1)
        inBuffer.copyFrom(1, 0, buffer, 1, 0, numSamples);
    else
        inBuffer.copyFrom(1, 0, buffer, 0, 0, numSamples);

    dfplate_process(dspEngine,
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

juce::String DragonflyPlateAudioProcessor::getVizJson()
{
    const uint32_t required = dfplate_get_viz_json(dspEngine, nullptr, 0);
    juce::HeapBlock<uint8_t> buffer(required);
    dfplate_get_viz_json(dspEngine, buffer.get(), required);
    return juce::String::fromUTF8(reinterpret_cast<const char*>(buffer.get()));
}

juce::AudioProcessorEditor* DragonflyPlateAudioProcessor::createEditor()
{
    return new DragonflyPlateAudioProcessorEditor(*this);
}

bool DragonflyPlateAudioProcessor::hasEditor() const { return true; }

void DragonflyPlateAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void DragonflyPlateAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xml(getXmlFromBinary(data, sizeInBytes));
    if (xml && xml->hasTagName(apvts.state.getType()))
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessorValueTreeState::ParameterLayout DragonflyPlateAudioProcessor::createParameterLayout()
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

juce::String DragonflyPlateAudioProcessor::formatParameterValue (int index, float value)
{
    const juce::String text(value, paramDecimals[index]);
    if (paramUnits[index].isEmpty())
        return text;
    if (paramUnits[index] == "%")
        return text + "%";
    return text + " " + paramUnits[index];
}

float DragonflyPlateAudioProcessor::parseParameterValue (int index, const juce::String& text)
{
    return juce::jlimit(paramMins[index], paramMaxs[index], text.getFloatValue());
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new DragonflyPlateAudioProcessor();
}
