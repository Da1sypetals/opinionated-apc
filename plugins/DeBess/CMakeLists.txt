# DeBess - De-esser (Rust DSP + WebView UI)
# macOS AU-only build

cmake_minimum_required(VERSION 3.22)

# ============================================
# RUST DSP 引擎（通过 Corrosion 集成）
# ============================================
corrosion_import_crate(MANIFEST_PATH dsp/Cargo.toml)

# ============================================
# 平台配置
# ============================================
if(APPLE)
    set(PLUGIN_FORMATS AU Standalone)
    set(AU_MAIN_TYPE kAudioUnitType_Effect)
else()
    message(FATAL_ERROR "DeBess: Only macOS AU builds are supported")
endif()

message(STATUS "DeBess: Building for ${PLUGIN_FORMATS}")

# ============================================
# Web UI 资源（嵌入为 BinaryData）
# ============================================
juce_add_binary_data(DeBess_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/css/style.css
        Source/ui/public/js/index.js
        Source/ui/public/js/knob.js
        Source/ui/public/js/format.js
        ../../shared/ui/viz/spectrum.js
        ../../shared/ui/viz/timeline.js
        ../../shared/ui/viz/meter.js
        Source/ui/public/js/juce/index.js
        Source/ui/public/js/juce/check_native_interop.js
)

# ============================================
# 插件定义
# ============================================
juce_add_plugin(DeBess
    COMPANY_NAME "Da1sypetals"
    PLUGIN_MANUFACTURER_CODE Awin
    PLUGIN_CODE DBss
    FORMATS ${PLUGIN_FORMATS}
    PRODUCT_NAME "DeBess"
    AU_MAIN_TYPE ${AU_MAIN_TYPE}
)

# ============================================
# 源文件
# ============================================
target_sources(DeBess
    PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
)

# ============================================
# 链接库
# ============================================
target_link_libraries(DeBess
    PRIVATE
        DeBess_WebUI
        debess_ffi
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
target_compile_definitions(DeBess
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_VST3_CAN_REPLACE_VST2=0
        JUCE_USE_CURL=0
)
