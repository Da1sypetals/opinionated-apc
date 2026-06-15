#pragma once
#include <cstdint>

extern "C" {

void* dfplate_create(int32_t sample_rate);
void dfplate_destroy(void* engine);
void dfplate_set_sample_rate(void* engine, int32_t sample_rate, int32_t max_block);
void dfplate_set_parameter(void* engine, uint32_t index, float value);
void dfplate_process(void* engine, const float* in_l, const float* in_r,
                     float* out_l, float* out_r, uint32_t frames);
void dfplate_clear_buffers(void* engine);
uint32_t dfplate_get_state(void* engine, uint8_t* buffer, uint32_t buffer_size);
void dfplate_set_state(void* engine, const uint8_t* buffer, uint32_t size);
uint32_t dfplate_get_viz_json(void* engine, uint8_t* buffer, uint32_t buffer_size);

}
