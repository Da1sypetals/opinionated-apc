cmake_minimum_required(VERSION 3.22)
project(APC_System VERSION 1.0.0)

# ============================================
# Corrosion（Rust 集成，供各插件的 dsp crate 使用）
# ============================================
include(FetchContent)
FetchContent_Declare(
    Corrosion
    GIT_REPOSITORY https://github.com/corrosion-rs/corrosion.git
    GIT_TAG v0.5.1
)
FetchContent_MakeAvailable(Corrosion)

# ============================================
# JUCE
# ============================================
add_subdirectory(_tools/JUCE)

# ============================================
# 插件
# ============================================
add_subdirectory(plugins/CloudSeed)
add_subdirectory(plugins/DeBess)
