#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "BinaryData.h"

const juce::String DeBessAudioProcessorEditor::sliderParamIds[4] = {
    "intensity", "sharpness", "depth", "filter"
};

const juce::String DeBessAudioProcessorEditor::toggleParamIds[1] = {
    "sense_mon"
};

DeBessAudioProcessorEditor::DeBessAudioProcessorEditor (DeBessAudioProcessor& p)
    : AudioProcessorEditor (&p), audioProcessor (p)
{
    for (int i = 0; i < 4; ++i)
    {
        sliderAttachments[i] = std::make_unique<juce::WebSliderParameterAttachment>(
            *audioProcessor.apvts.getParameter(sliderParamIds[i]), sliderRelays[i]);
    }
    for (int i = 0; i < 1; ++i)
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

    for (int i = 0; i < 4; ++i)
        options = options.withOptionsFrom(sliderRelays[i]);
    for (int i = 0; i < 1; ++i)
        options = options.withOptionsFrom(toggleRelays[i]);

    webView = std::make_unique<juce::WebBrowserComponent>(options);
    addAndMakeVisible(*webView);
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

    setSize(720, 480);
    startTimerHz(30);
}

DeBessAudioProcessorEditor::~DeBessAudioProcessorEditor()
{
    stopTimer();
}

void DeBessAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll(juce::Colours::black);
}

void DeBessAudioProcessorEditor::resized()
{
    if (webView)
        webView->setBounds(getLocalBounds());
}

void DeBessAudioProcessorEditor::timerCallback()
{
    if (!webView || !webView->isVisible())
        return;

    double now = juce::Time::getMillisecondCounterHiRes();
    double elapsed = now - audioProcessor.lastProcessBlockTime.load(std::memory_order_relaxed);
    if (elapsed > 200.0)
        audioProcessor.vizDecay();

    const char* json = audioProcessor.getVizJson();
    if (json == nullptr)
        return;

    juce::String js = "if(window.__debessViz){window.__debessViz('";
    js += json;
    js += "');}";
    webView->evaluateJavascript(js);
}

std::optional<juce::WebBrowserComponent::Resource> DeBessAudioProcessorEditor::getResource(const juce::String& url)
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
    else if (path == "js/viz/spectrum.js")
    {
        resourceData = BinaryData::spectrum_js;
        resourceSize = BinaryData::spectrum_jsSize;
        mimeType = "text/javascript";
    }
    else if (path == "js/viz/timeline.js")
    {
        resourceData = BinaryData::timeline_js;
        resourceSize = BinaryData::timeline_jsSize;
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
