#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "BinaryData.h"

const juce::String CloudSeedAudioProcessorEditor::sliderParamIds[35] = {
    "input_mix", "low_cut", "high_cut",
    "dry_out", "early_out", "late_out",
    "tap_count", "tap_decay", "tap_predelay", "tap_length",
    "early_diffuse_count", "early_diffuse_delay",
    "early_diffuse_mod_amount", "early_diffuse_feedback", "early_diffuse_mod_rate",
    "late_line_count", "late_diffuse_count",
    "late_line_size", "late_line_mod_amount", "late_diffuse_delay",
    "late_diffuse_mod_amount", "late_line_decay", "late_line_mod_rate",
    "late_diffuse_feedback", "late_diffuse_mod_rate",
    "eq_low_freq", "eq_high_freq", "eq_cutoff",
    "eq_low_gain", "eq_high_gain", "eq_cross_seed",
    "seed_tap", "seed_diffusion", "seed_delay", "seed_post_diffusion"
};

const juce::String CloudSeedAudioProcessorEditor::toggleParamIds[10] = {
    "interpolation", "low_cut_enabled", "high_cut_enabled",
    "tap_enabled", "early_diffuse_enabled",
    "late_mode", "late_diffuse_enabled",
    "eq_low_shelf_enabled", "eq_high_shelf_enabled", "eq_lowpass_enabled"
};

CloudSeedAudioProcessorEditor::CloudSeedAudioProcessorEditor (CloudSeedAudioProcessor& p)
    : AudioProcessorEditor (&p), audioProcessor (p)
{
    // 创建 attachments
    for (int i = 0; i < 35; ++i)
    {
        sliderAttachments[i] = std::make_unique<juce::WebSliderParameterAttachment>(
            *audioProcessor.apvts.getParameter(sliderParamIds[i]), sliderRelays[i]);
    }
    for (int i = 0; i < 10; ++i)
    {
        toggleAttachments[i] = std::make_unique<juce::WebToggleButtonParameterAttachment>(
            *audioProcessor.apvts.getParameter(toggleParamIds[i]), toggleRelays[i]);
    }

    // 创建 WebView
    auto options = juce::WebBrowserComponent::Options{}
        .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(
            juce::WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder(juce::File::getSpecialLocation(juce::File::SpecialLocationType::tempDirectory)))
        .withNativeIntegrationEnabled()
        .withResourceProvider([this](const auto& url) { return getResource(url); });

    // 注册所有 relay
    for (int i = 0; i < 35; ++i)
        options = options.withOptionsFrom(sliderRelays[i]);
    for (int i = 0; i < 10; ++i)
        options = options.withOptionsFrom(toggleRelays[i]);

    webView = std::make_unique<juce::WebBrowserComponent>(options);
    addAndMakeVisible(*webView);
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

    setSize(900, 600);
    startTimerHz(30);
}

CloudSeedAudioProcessorEditor::~CloudSeedAudioProcessorEditor()
{
    stopTimer();
}

void CloudSeedAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll(juce::Colours::black);
}

void CloudSeedAudioProcessorEditor::resized()
{
    if (webView)
        webView->setBounds(getLocalBounds());
}

void CloudSeedAudioProcessorEditor::timerCallback()
{
    // WebView UI 不需要从 C++ 推送数据（所有参数双向绑定由 relay 处理）
}

const char* CloudSeedAudioProcessorEditor::getMimeForExtension(const juce::String& ext)
{
    if (ext == "html") return "text/html";
    if (ext == "css") return "text/css";
    if (ext == "js" || ext == "mjs") return "text/javascript";
    if (ext == "json") return "application/json";
    if (ext == "png") return "image/png";
    if (ext == "svg") return "image/svg+xml";
    return "text/plain";
}

std::optional<juce::WebBrowserComponent::Resource> CloudSeedAudioProcessorEditor::getResource(const juce::String& url)
{
    auto resourcePath = url.fromFirstOccurrenceOf(
        juce::WebBrowserComponent::getResourceProviderRoot(), false, false);

    if (resourcePath.isEmpty() || resourcePath == "/")
        resourcePath = "/index.html";

    auto path = resourcePath.substring(1); // 去掉前导斜杠

    // 查找 BinaryData 资源
    const char* resourceData = nullptr;
    int resourceSize = 0;
    juce::String mimeType;

    if (path == "index.html")
    {
        resourceData = BinaryData::index_html;
        resourceSize = BinaryData::index_htmlSize;
        mimeType = "text/html";
    }
    else if (path == "js/index.js")
    {
        resourceData = BinaryData::index_js;
        resourceSize = BinaryData::index_jsSize;
        mimeType = "text/javascript";
    }
    else if (path == "js/juce/index.js")
    {
        resourceData = BinaryData::index_js2;
        resourceSize = BinaryData::index_js2Size;
        mimeType = "text/javascript";
    }
    else if (path == "js/juce/check_native_interop.js")
    {
        resourceData = BinaryData::check_native_interop_js;
        resourceSize = BinaryData::check_native_interop_jsSize;
        mimeType = "text/javascript";
    }

    if (resourceData != nullptr && resourceSize > 0)
    {
        std::vector<std::byte> data(static_cast<size_t>(resourceSize));
        std::memcpy(data.data(), resourceData, static_cast<size_t>(resourceSize));
        return juce::WebBrowserComponent::Resource { std::move(data), mimeType };
    }

    // 404 fallback
    juce::String html = "<html><body style='background:#1a1a2e;color:#fff;padding:40px;'>"
                        "<h1>Resource not found: " + path + "</h1></body></html>";
    std::vector<std::byte> fallback(html.getNumBytesAsUTF8());
    std::memcpy(fallback.data(), html.toRawUTF8(), fallback.size());
    return juce::WebBrowserComponent::Resource { std::move(fallback), "text/html" };
}
