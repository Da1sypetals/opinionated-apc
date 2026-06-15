#pragma once

#include <cstdint>

#if defined(__SSE__)
#include <xmmintrin.h>
#endif

class ScopedDenormalDisableImpl {
public:
    ScopedDenormalDisableImpl() noexcept {
#if defined(__aarch64__)
        previousFpcr = readFpcr();
        writeFpcr(previousFpcr | (1ull << 24));
#elif defined(__SSE__)
        previousMxcsr = _mm_getcsr();
        _mm_setcsr(previousMxcsr | 0x8040);
#endif
    }

    ~ScopedDenormalDisableImpl() noexcept {
#if defined(__aarch64__)
        writeFpcr(previousFpcr);
#elif defined(__SSE__)
        _mm_setcsr(previousMxcsr);
#endif
    }

private:
#if defined(__aarch64__)
    uint64_t previousFpcr = 0;

    static uint64_t readFpcr() noexcept {
        uint64_t value = 0;
        __asm__ volatile("mrs %0, fpcr" : "=r"(value));
        return value;
    }

    static void writeFpcr(uint64_t value) noexcept {
        __asm__ volatile("msr fpcr, %0" : : "r"(value));
    }
#elif defined(__SSE__)
    unsigned int previousMxcsr = 0;
#endif
};

#if defined(__clang__) || defined(__GNUC__)
#define ScopedDenormalDisable ScopedDenormalDisableImpl __attribute__((unused))
#else
#define ScopedDenormalDisable ScopedDenormalDisableImpl
#endif
