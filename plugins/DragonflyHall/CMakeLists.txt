cmake_minimum_required(VERSION 3.22)

corrosion_import_crate(MANIFEST_PATH dsp/Cargo.toml)

if(APPLE)
    set(PLUGIN_FORMATS AU Standalone)
    set(AU_MAIN_TYPE kAudioUnitType_Effect)
else()
    message(FATAL_ERROR "DragonflyHall: Only macOS AU builds are supported")
endif()

message(STATUS "DragonflyHall: Building for ${PLUGIN_FORMATS}")

juce_add_binary_data(DragonflyHall_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/css/style.css
        Source/ui/public/js/index.js
        Source/ui/public/js/juce/index.js
        Source/ui/public/js/juce/check_native_interop.js
)

juce_add_plugin(DragonflyHall
    COMPANY_NAME "Da1sypetals"
    PLUGIN_MANUFACTURER_CODE Awin
    PLUGIN_CODE DHll
    FORMATS ${PLUGIN_FORMATS}
    PRODUCT_NAME "Dragonfly Hall"
    AU_MAIN_TYPE ${AU_MAIN_TYPE}
)

target_sources(DragonflyHall
    PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
)

target_link_libraries(DragonflyHall
    PRIVATE
        DragonflyHall_WebUI
        dragonfly_hall_ffi
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

target_compile_definitions(DragonflyHall
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_VST3_CAN_REPLACE_VST2=0
        JUCE_USE_CURL=0
)
