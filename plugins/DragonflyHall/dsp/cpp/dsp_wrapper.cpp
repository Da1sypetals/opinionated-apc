#include "DistrhoPluginInfo.h"
#include "DSP.hpp"

#include <algorithm>
#include <cstdint>

extern "C" {

void* dragonfly_hall_create(int32_t sample_rate)
{
    return new DragonflyReverbDSP(static_cast<double>(sample_rate));
}

void dragonfly_hall_destroy(void* engine)
{
    delete static_cast<DragonflyReverbDSP*>(engine);
}

void dragonfly_hall_set_sample_rate(void* engine, int32_t sample_rate)
{
    auto* dsp = static_cast<DragonflyReverbDSP*>(engine);
    dsp->sampleRateChanged(static_cast<double>(sample_rate));
    dsp->mute();
}

void dragonfly_hall_set_parameter(void* engine, uint32_t index, float value)
{
    static_cast<DragonflyReverbDSP*>(engine)->setParameterValue(index, value);
}

float dragonfly_hall_get_parameter(void* engine, uint32_t index)
{
    return static_cast<DragonflyReverbDSP*>(engine)->getParameterValue(index);
}

void dragonfly_hall_process(
    void* engine,
    const float* in_l,
    const float* in_r,
    float* out_l,
    float* out_r,
    uint32_t frames)
{
    const float* inputs[2] = { in_l, in_r };
    float* outputs[2] = { out_l, out_r };
    static_cast<DragonflyReverbDSP*>(engine)->run(inputs, outputs, frames);
}

void dragonfly_hall_clear_buffers(void* engine)
{
    static_cast<DragonflyReverbDSP*>(engine)->mute();
}

}
