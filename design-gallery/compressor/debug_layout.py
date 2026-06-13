from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 900})
    page.goto("file:///Users/daisy/develop/audio-plugin-coder/design-gallery/compressor/index.html")
    page.wait_for_timeout(500)

    selectors = [
        ".plugin",
        ".hdr",
        ".viz-row",
        ".curve-box",
        ".gr-box",
        ".meters-box",
        ".ctrl-area",
        ".ctrl-left",
        ".ctrl-mid",
        ".ctrl-right",
        ".ctrl-right-toggles",
        ".ctrl-right-knobs",
        ".ctrl-right-bars",
        ".ctrl-right-rms",
        ".ftr",
    ]

    print(f"{'SELECTOR':<20} {'X':>5} {'Y':>5} {'W':>5} {'H':>5}")
    print("-" * 45)
    for sel in selectors:
        el = page.locator(sel).first
        box = el.bounding_box()
        if box:
            print(f"{sel:<20} {box['x']:>5.0f} {box['y']:>5.0f} {box['width']:>5.0f} {box['height']:>5.0f}")
        else:
            print(f"{sel:<20} NOT FOUND")

    browser.close()
