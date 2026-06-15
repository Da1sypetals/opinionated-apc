#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "BinaryData.h"

const juce::String DragonflyHallAudioProcessorEditor::sliderParamIds[NUM_SLIDERS] = {
    "dry_level", "early_level", "late_level", "size", "width", "predelay",
    "diffuse", "low_cut", "low_xo", "low_mult", "high_cut", "high_xo",
    "high_mult", "spin", "wander", "decay", "early_send", "modulation"
};

DragonflyHallAudioProcessorEditor::DragonflyHallAudioProcessorEditor (DragonflyHallAudioProcessor& p)
    : AudioProcessorEditor (&p), audioProcessor (p)
{
    for (int i = 0; i < NUM_SLIDERS; ++i)
    {
        sliderAttachments[i] = std::make_unique<juce::WebSliderParameterAttachment>(
            *audioProcessor.apvts.getParameter(sliderParamIds[i]), sliderRelays[i]);
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

    webView = std::make_unique<juce::WebBrowserComponent>(options);
    addAndMakeVisible(*webView);
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

    setSize(920, 345);
    startTimerHz(8);
}

DragonflyHallAudioProcessorEditor::~DragonflyHallAudioProcessorEditor()
{
    stopTimer();
}

void DragonflyHallAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll(juce::Colours::black);
}

void DragonflyHallAudioProcessorEditor::resized()
{
    if (webView)
        webView->setBounds(getLocalBounds());
}

void DragonflyHallAudioProcessorEditor::timerCallback()
{
    if (!webView || !webView->isVisible())
        return;

    juce::String json = audioProcessor.getVizJson();
    json = json.replace("\\", "\\\\").replace("'", "\\'");
    webView->evaluateJavascript("if(window.__dragonflyViz){window.__dragonflyViz('" + json + "');}");
}

std::optional<juce::WebBrowserComponent::Resource> DragonflyHallAudioProcessorEditor::getResource(const juce::String& url)
{
    auto root = juce::WebBrowserComponent::getResourceProviderRoot();
    juce::String path = url.startsWith(root) ? url.substring(root.length()) : url;
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

    juce::String html = "<html><body style='background:#222;color:#fff;padding:24px;'>Missing resource: " + path + "</body></html>";
    std::vector<std::byte> fallback(html.getNumBytesAsUTF8());
    std::memcpy(fallback.data(), html.toRawUTF8(), fallback.size());
    return juce::WebBrowserComponent::Resource { std::move(fallback), "text/html" };
}
