# CloudSeed - Algorithmic Reverb (Rust DSP + WebView UI)
# macOS AU-only build

cmake_minimum_required(VERSION 3.22)

# ============================================
# RUST DSP 引擎（通过 Corrosion 集成）
# ============================================
include(FetchContent)
FetchContent_Declare(
    Corrosion
    GIT_REPOSITORY https://github.com/corrosion-rs/corrosion.git
    GIT_TAG v0.5.1
)
FetchContent_MakeAvailable(Corrosion)

corrosion_import_crate(MANIFEST_PATH dsp/Cargo.toml)

# ============================================
# 平台配置
# ============================================
if(APPLE)
    set(PLUGIN_FORMATS AU Standalone)
    set(AU_MAIN_TYPE kAudioUnitType_Effect)
else()
    message(FATAL_ERROR "CloudSeed: Only macOS AU builds are supported")
endif()

message(STATUS "CloudSeed: Building for ${PLUGIN_FORMATS}")

# ============================================
# Web UI 资源（嵌入为 BinaryData）
# ============================================
juce_add_binary_data(CloudSeed_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/js/index.js
        Source/ui/public/js/juce/index.js
        Source/ui/public/js/juce/check_native_interop.js
)

# ============================================
# 插件定义
# ============================================
juce_add_plugin(CloudSeed
    COMPANY_NAME "Noizefield"
    PLUGIN_MANUFACTURER_CODE Nfld
    PLUGIN_CODE CSed
    FORMATS ${PLUGIN_FORMATS}
    PRODUCT_NAME "CloudSeed"
    AU_MAIN_TYPE ${AU_MAIN_TYPE}
)

# ============================================
# 源文件
# ============================================
target_sources(CloudSeed
    PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
)

# ============================================
# 链接库
# ============================================
target_link_libraries(CloudSeed
    PRIVATE
        CloudSeed_WebUI
        cloudseed_ffi
        juce::juce_audio_basics
        juce::juce_audio_devices
        juce::juce_audio_formats
        juce::juce_audio_plugin_client
        juce::juce_audio_processors
        juce::juce_audio_utils
        juce::juce_core
        juce::juce_data_structures
        juce::juce_events
        juce::juce_graphics
        juce::juce_gui_basics
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)

# ============================================
# 编译定义
# ============================================
target_compile_definitions(CloudSeed
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_VST3_CAN_REPLACE_VST2=0
        JUCE_USE_CURL=0
)
