#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "BinaryData.h"

const juce::String ZLCompAudioProcessorEditor::sliderParamIds[NUM_SLIDERS] = {
    "threshold", "ratio", "knee", "attack", "release",
    "pump", "smooth", "hold", "range", "makeup",
    "wet", "lookahead", "rms_length", "rms_speed", "rms_mix", "style"
};

const juce::String ZLCompAudioProcessorEditor::toggleParamIds[NUM_TOGGLES] = {
    "bypass", "range_inf", "rms_on", "stereo_mode"
};

ZLCompAudioProcessorEditor::ZLCompAudioProcessorEditor (ZLCompAudioProcessor& p)
    : AudioProcessorEditor (&p), audioProcessor (p)
{
    for (int i = 0; i < NUM_SLIDERS; ++i)
    {
        sliderAttachments[i] = std::make_unique<juce::WebSliderParameterAttachment>(
            *audioProcessor.apvts.getParameter(sliderParamIds[i]), sliderRelays[i]);
    }
    for (int i = 0; i < NUM_TOGGLES; ++i)
    {
        toggleAttachments[i] = std::make_unique<juce::WebToggleButtonParameterAttachment>(
            *audioProcessor.apvts.getParameter(toggleParamIds[i]), toggleRelays[i]);
    }

    auto options = juce::WebBrowserComponent::Options{}
        .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(
            juce::WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder(juce::File::getSpecialLocation(juce::File::SpecialLocationType::tempDirectory)))
        .withNativeIntegrationEnabled()
        .withResourceProvider([this](const auto& url) { return getResource(url); });

    for (int i = 0; i < NUM_SLIDERS; ++i)
        options = options.withOptionsFrom(sliderRelays[i]);
    for (int i = 0; i < NUM_TOGGLES; ++i)
        options = options.withOptionsFrom(toggleRelays[i]);

    webView = std::make_unique<juce::WebBrowserComponent>(options);
    addAndMakeVisible(*webView);
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

    setSize(540, 492);
    startTimerHz(30);
}

ZLCompAudioProcessorEditor::~ZLCompAudioProcessorEditor()
{
    stopTimer();
}

void ZLCompAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll(juce::Colours::black);
}

void ZLCompAudioProcessorEditor::resized()
{
    if (webView)
        webView->setBounds(getLocalBounds());
}

void ZLCompAudioProcessorEditor::timerCallback()
{
    if (!webView || !webView->isVisible())
        return;

    double now = juce::Time::getMillisecondCounterHiRes();
    double elapsed = now - audioProcessor.lastProcessBlockTime.load(std::memory_order_relaxed);
    const bool audioActive = elapsed <= 200.0;

    const char* json = audioProcessor.getVizJson();
    if (json == nullptr)
        return;

    juce::String js = "if(window.__zlcompViz){window.__zlcompViz('";
    js += json;
    js += "',";
    js += audioActive ? "true" : "false";
    js += ");}";
    webView->evaluateJavascript(js);
}

std::optional<juce::WebBrowserComponent::Resource> ZLCompAudioProcessorEditor::getResource(const juce::String& url)
{
    auto root = juce::WebBrowserComponent::getResourceProviderRoot();
    juce::String path;

    if (url.startsWith(root))
        path = url.substring(root.length());
    else
        path = url;

    if (path.startsWith("/"))
        path = path.substring(1);

    if (path.isEmpty())
        path = "index.html";

    const char* resourceData = nullptr;
    int resourceSize = 0;
    juce::String mimeType;

    if (path == "index.html")
    {
        resourceData = BinaryData::index_html;
        resourceSize = BinaryData::index_htmlSize;
        mimeType = "text/html";
    }
    else if (path == "css/style.css")
    {
        resourceData = BinaryData::style_css;
        resourceSize = BinaryData::style_cssSize;
        mimeType = "text/css";
    }
    else if (path == "js/index.js")
    {
        resourceData = BinaryData::index_js;
        resourceSize = BinaryData::index_jsSize;
        mimeType = "text/javascript";
    }
    else if (path == "js/knob.js")
    {
        resourceData = BinaryData::knob_js;
        resourceSize = BinaryData::knob_jsSize;
        mimeType = "text/javascript";
    }
    else if (path == "js/format.js")
    {
        resourceData = BinaryData::format_js;
        resourceSize = BinaryData::format_jsSize;
        mimeType = "text/javascript";
    }
    else if (path == "js/viz/meter.js")
    {
        resourceData = BinaryData::meter_js;
        resourceSize = BinaryData::meter_jsSize;
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

    juce::String html = "<html><body style='background:#0f1114;color:#fff;padding:40px;'>"
                        "<h1>Resource not found: " + path + "</h1></body></html>";
    std::vector<std::byte> fallback(html.getNumBytesAsUTF8());
    std::memcpy(fallback.data(), html.toRawUTF8(), fallback.size());
    return juce::WebBrowserComponent::Resource { std::move(fallback), "text/html" };
}
