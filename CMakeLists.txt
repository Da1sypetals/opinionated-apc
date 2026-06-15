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
option(APC_BUILD_ONLY_CLOUDSEED "Build only CloudSeed" OFF)
option(APC_BUILD_ONLY_DEBESS "Build only DeBess" OFF)
option(APC_BUILD_ONLY_ZLCOMP "Build only ZLComp" OFF)
option(APC_BUILD_ONLY_DRAGONFLY_PLATE "Build only DragonflyPlate" OFF)
option(APC_BUILD_ONLY_DRAGONFLY_HALL "Build only DragonflyHall" OFF)

if(APC_BUILD_ONLY_CLOUDSEED)
    add_subdirectory(plugins/CloudSeed)
elseif(APC_BUILD_ONLY_DEBESS)
    add_subdirectory(plugins/DeBess)
elseif(APC_BUILD_ONLY_ZLCOMP)
    add_subdirectory(plugins/ZLComp)
elseif(APC_BUILD_ONLY_DRAGONFLY_PLATE)
    add_subdirectory(plugins/DragonflyPlate)
elseif(APC_BUILD_ONLY_DRAGONFLY_HALL)
    add_subdirectory(plugins/DragonflyHall)
else()
    add_subdirectory(plugins/CloudSeed)
    add_subdirectory(plugins/DeBess)
    add_subdirectory(plugins/ZLComp)
    add_subdirectory(plugins/DragonflyPlate)
    add_subdirectory(plugins/DragonflyHall)
endif()
