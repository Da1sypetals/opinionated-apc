#pragma once

#include <cstdint>

extern "C" {

void* debess_create(int32_t sample_rate);
void debess_destroy(void* engine);
void debess_set_sample_rate(void* engine, int32_t sample_rate);
void debess_set_parameter(void* engine, uint32_t param_index, float value);
void debess_process(void* engine, const float* in_l, const float* in_r,
                    float* out_l, float* out_r, uint32_t num_samples);
uint32_t debess_get_parameter_count();
float debess_get_parameter(void* engine, uint32_t param_index);
uint32_t debess_get_state(void* engine, uint8_t* buffer, uint32_t buffer_size);
void debess_set_state(void* engine, const uint8_t* buffer, uint32_t size);
void debess_clear_buffers(void* engine);
void debess_viz_decay(void* engine);
const char* debess_get_viz_json(void* engine);

}
