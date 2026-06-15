#pragma once

#include <cmath>

inline bool d_isNotEqual(float a, float b)
{
    return std::fabs(a - b) > 1.0e-6f;
}
