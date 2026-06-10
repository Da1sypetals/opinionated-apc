#pragma once
#include <cstdint>

extern "C" {

void* cloudseed_create(int32_t sample_rate);
void cloudseed_destroy(void* engine);
void cloudseed_set_sample_rate(void* engine, int32_t sample_rate);
void cloudseed_set_parameter(void* engine, uint32_t param_index, float value);
void cloudseed_process(void* engine, const float* in_l, const float* in_r,
                       float* out_l, float* out_r, uint32_t num_samples);
uint32_t cloudseed_get_parameter_count();
float cloudseed_get_parameter(void* engine, uint32_t param_index);
uint32_t cloudseed_get_state(void* engine, uint8_t* buffer, uint32_t buffer_size);
void cloudseed_set_state(void* engine, const uint8_t* buffer, uint32_t size);
void cloudseed_clear_buffers(void* engine);

}
