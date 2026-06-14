#pragma once

#include <cstdint>

extern "C" {

void* zlcomp_create(int32_t sample_rate);
void zlcomp_destroy(void* engine);
void zlcomp_set_sample_rate(void* engine, int32_t sample_rate, int32_t max_block_size);
void zlcomp_set_parameter(void* engine, uint32_t param_index, float value);
void zlcomp_process(void* engine, float* main_l, float* main_r, uint32_t num_samples);
uint32_t zlcomp_get_parameter_count();
float zlcomp_get_parameter(void* engine, uint32_t param_index);
uint32_t zlcomp_get_state(void* engine, uint8_t* buffer, uint32_t buffer_size);
void zlcomp_set_state(void* engine, const uint8_t* buffer, uint32_t size);
void zlcomp_clear_buffers(void* engine);
const char* zlcomp_get_viz_json(void* engine);

}
