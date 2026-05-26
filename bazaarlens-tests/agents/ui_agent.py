"""
UI Test Agent — BazaarLens
Tests both desktop (1280x800) and mobile (390x844) viewports.
Mobile uses a completely different UI: bottom nav, watchlist drawer, no sidebar.
"""
import base64
import json
import httpx
from state import AgentState, TestResult

ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL  = "claude-sonnet-4-20250514"

VIEWPORTS = {
    "desktop": {"width": 1280, "height": 800},
    "mobile":  {"width": 390,  "height": 844},   # iPhone 14 Pro
}


def make_result(test_name, status, severity, detail, actual, expected):
    return TestResult(
        agent="ui", test_name=test_name, status=status,
        severity=severity, detail=detail, actual=actual, expected=expected
    )


def screenshot_b64(page):
    return base64.b64encode(page.screenshot()).decode()


def claude_assert(b64, question, api_key):
    response = httpx.post(
        ANTHROPIC_API,
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
        json={
            "model": CLAUDE_MODEL, "max_tokens": 200,
            "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                {"type": "text", "text": f"{question}\n\nReply ONLY with JSON: {{\"pass\": true/false, \"reason\": \"one sentence\"}}"}
            ]}]
        },
        timeout=30.0
    )
    raw  = response.json()["content"][0]["text"].strip()
    data = json.loads(raw.replace("```json", "").replace("```", "").strip())
    return data["pass"], data["reason"]


def bypass_auth_and_show_app(page):
    page.evaluate("() => { if (typeof hideLanding === 'function') hideLanding(); if (typeof showApp === 'function') showApp(); }")


def bypass_auth_and_show_hub(page):
    """Show the Hub page (indices, welcome screen) without full Firebase auth."""
    page.evaluate("() => { if (typeof hideLanding === 'function') hideLanding(); if (typeof showHub === 'function') showHub(); }")


def bypass_auth_and_trigger_analysis(page, symbol):
    """Hide landing, show app, then trigger a live analysis via the API."""
    page.evaluate("() => { if (typeof hideLanding === 'function') hideLanding(); if (typeof showApp === 'function') showApp(); }")
    page.wait_for_timeout(3000)
    page.evaluate(f"() => typeof triggerAnalysis === 'function' && triggerAnalysis('{symbol}')")


# ── Shared tests (run on both viewports) ──────────────────────────────────────

def test_no_js_errors(page, base_url, vp):
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)
    ok = len(errors) == 0
    return make_result(
        f"[{vp}] No JavaScript errors on load",
        "pass" if ok else "fail",
        "pass" if ok else "critical",
        "pageerror should be empty on load",
        "; ".join(errors) if errors else "none",
        "zero JS errors"
    )


def test_page_loads(page, base_url, vp):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    title = page.title()
    ok = "BazaarLens" in title
    return make_result(
        f"[{vp}] Page load — title correct",
        "pass" if ok else "fail",
        "pass" if ok else "critical",
        f"GET {base_url} and check <title>",
        f'"{title}"',
        "Title contains 'BazaarLens'"
    )


def test_chart_renders(page, base_url, symbol, api_key, vp):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate(f"() => localStorage.setItem('watchlist', JSON.stringify(['{symbol}']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_trigger_analysis(page, symbol)
    page.wait_for_timeout(35000)
    ss = screenshot_b64(page)
    ok, reason = claude_assert(ss, api_key=api_key, question=(
        "Does this page show a financial chart — candlestick, line, or price chart with a date x-axis? "
        "Answer true if any chart is visible, false if only loading spinners or empty state."
    ))
    return make_result(
        f"[{vp}] Chart renders after analysis",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        f"Price chart should appear after triggerAnalysis('{symbol}')",
        reason, "Chart visible"
    )


def test_analysis_card_renders(page, base_url, symbol, api_key, vp):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate(f"() => localStorage.setItem('watchlist', JSON.stringify(['{symbol}']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_trigger_analysis(page, symbol)
    page.wait_for_timeout(35000)
    ss = screenshot_b64(page)
    ok, reason = claude_assert(ss, api_key=api_key, question=(
        "Does this stock analysis app show an AI analysis card with BUY MORE, HOLD, or REVIEW? "
        "Answer true if one of these three words is prominently visible."
    ))
    return make_result(
        f"[{vp}] AI analysis card — signal visible",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "AI scorecard should show BUY_MORE / HOLD / REVIEW after analysis",
        reason, "Visible signal label"
    )


def test_localstorage_cache(page, base_url, symbol, vp):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate(f"() => localStorage.setItem('watchlist', JSON.stringify(['{symbol}']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_trigger_analysis(page, symbol)
    page.wait_for_timeout(40000)
    stock_data_present = page.evaluate(
        f"() => {{ try {{ return JSON.parse(localStorage.getItem('stockData') || '{{}}')['{symbol}'] != null; }} catch(e) {{ return false; }} }}"
    )
    return make_result(
        f"[{vp}] localStorage cache written after analysis",
        "pass" if stock_data_present else "fail",
        "pass" if stock_data_present else "medium",
        "storeAnalysis() should write to localStorage.stockData",
        f"stockData[{symbol}] present: {stock_data_present}",
        f"stockData[{symbol}] exists"
    )


def test_indices_visible(page, base_url, api_key, vp):
    """
    Indices live in the Hub page (#hub-indices), not the landing page.
    Must bypass auth and call showHub() to see them — otherwise the
    landing page is shown and indices never load.
    """
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    bypass_auth_and_show_hub(page)
    # Give indices API time to fetch (called by _startIndicesTicker)
    page.wait_for_timeout(8000)
    ss = screenshot_b64(page)
    ok, reason = claude_assert(ss, api_key=api_key, question=(
        "Does this page show Indian stock market index values such as Nifty 50 or Sensex with numeric prices? "
        "Answer true only if you can see actual numbers next to index names, not placeholder dashes."
    ))
    return make_result(
        f"[{vp}] Market indices visible in Hub",
        "pass" if ok else "fail",
        "pass" if ok else "medium",
        "Nifty/Sensex should appear in #hub after showHub() + 8s wait",
        reason, "Index values with numbers visible"
    )


# ── Desktop-only tests ────────────────────────────────────────────────────────

def test_theme_toggle_desktop(page, base_url):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate("() => { if (typeof hideLanding === 'function') hideLanding(); }")
    page.wait_for_timeout(500)
    initial_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
    toggle = page.locator("#theme-toggle").first
    if toggle.count() == 0:
        return make_result("[desktop] Theme toggle", "fail", "low",
                           "No #theme-toggle found", "not found", "#theme-toggle present")
    toggle.click()
    page.wait_for_timeout(300)
    new_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
    ok = initial_theme != new_theme
    return make_result(
        "[desktop] Theme toggle — switches dark/light",
        "pass" if ok else "fail",
        "pass" if ok else "medium",
        "Click #theme-toggle → data-theme should change",
        f"{initial_theme} → {new_theme}", "theme attribute changes"
    )


def test_add_stock_desktop(page, base_url, symbol):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate("() => localStorage.setItem('watchlist', JSON.stringify(['TITAGARH']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_show_app(page)
    page.wait_for_timeout(3000)
    add_btn = page.locator("button.add-btn").first
    if add_btn.count() == 0 or not add_btn.is_visible():
        return make_result(f"[desktop] Add stock ({symbol})", "fail", "critical",
                           "Could not find .add-btn in sidebar", "not found", ".add-btn visible")
    add_btn.click()
    page.wait_for_timeout(500)
    page.locator("#modal-search").fill(symbol)
    page.wait_for_timeout(800)
    first = page.locator("#modal-list .modal-stock-item").first
    if first.count() > 0:
        first.click()
    else:
        page.locator("#modal-search").press("Enter")
    page.wait_for_timeout(2000)
    visible = page.locator("#watchlist-container").filter(has_text=symbol).count() > 0
    return make_result(
        f"[desktop] Add stock — {symbol} in sidebar",
        "pass" if visible else "fail",
        "pass" if visible else "critical",
        "Add Stock modal → symbol appears in sidebar watchlist",
        f"visible: {visible}", "stock card in sidebar"
    )


def test_remove_stock_desktop(page, base_url, symbol):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate(f"() => localStorage.setItem('watchlist', JSON.stringify(['{symbol}']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_show_app(page)
    page.wait_for_timeout(3000)
    remove_btn = page.locator("#watchlist-container .remove-btn").first
    if remove_btn.count() == 0:
        return make_result(f"[desktop] Remove stock ({symbol})", "fail", "medium",
                           ".remove-btn not found on stock card", "not found", ".remove-btn present")
    remove_btn.click()
    page.wait_for_timeout(500)
    gone = page.locator("#watchlist-container").filter(has_text=symbol).count() == 0
    return make_result(
        "[desktop] Remove stock — card disappears",
        "pass" if gone else "fail",
        "pass" if gone else "medium",
        "Click .remove-btn → stock card removed from sidebar",
        f"gone: {gone}", "card removed"
    )


# ── Mobile-only tests ─────────────────────────────────────────────────────────

def test_mobile_no_horizontal_scroll(page, base_url):
    """
    Measures actual DOM scroll width vs viewport width using JavaScript.
    Claude screenshots can't detect horizontal overflow — only JS can.
    Checks both the landing page and the app shell.
    """
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)

    # Check landing page overflow
    landing_overflow = page.evaluate("""() => {
        const body = document.body;
        const html = document.documentElement;
        const viewportWidth = window.innerWidth;
        const scrollWidth = Math.max(
            body.scrollWidth, body.offsetWidth,
            html.scrollWidth, html.offsetWidth
        );
        return {
            viewportWidth: viewportWidth,
            scrollWidth: scrollWidth,
            hasOverflow: scrollWidth > viewportWidth + 2
        };
    }""")

    # Also check app view
    bypass_auth_and_show_app(page)
    page.wait_for_timeout(3000)
    app_overflow = page.evaluate("""() => {
        const body = document.body;
        const html = document.documentElement;
        const viewportWidth = window.innerWidth;
        const scrollWidth = Math.max(
            body.scrollWidth, body.offsetWidth,
            html.scrollWidth, html.offsetWidth
        );
        return {
            viewportWidth: viewportWidth,
            scrollWidth: scrollWidth,
            hasOverflow: scrollWidth > viewportWidth + 2
        };
    }""")

    landing_ok = not landing_overflow["hasOverflow"]
    app_ok     = not app_overflow["hasOverflow"]
    ok         = landing_ok and app_ok

    detail = (
        f"Landing: viewport={landing_overflow['viewportWidth']}px scroll={landing_overflow['scrollWidth']}px | "
        f"App: viewport={app_overflow['viewportWidth']}px scroll={app_overflow['scrollWidth']}px"
    )
    return make_result(
        "[mobile] No horizontal scrolling required",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "scrollWidth should not exceed viewportWidth on any page at 390px",
        detail,
        "scrollWidth <= viewportWidth on landing and app"
    )


def test_mobile_bottom_nav_fixed(page, base_url):
    """
    Verifies the bottom nav is:
    1. Visible without scrolling (in viewport on page load)
    2. Fixed to the bottom (position:fixed, not position:static/relative)
    3. Not hidden behind content — getBoundingClientRect().bottom <= window.innerHeight
    """
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate("() => localStorage.setItem('watchlist', JSON.stringify(['TITAGARH']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_show_app(page)
    page.wait_for_timeout(2000)

    nav_info = page.evaluate("""() => {
        const nav = document.getElementById('mobile-nav');
        if (!nav) return { found: false };
        const rect = nav.getBoundingClientRect();
        const style = window.getComputedStyle(nav);
        return {
            found: true,
            position: style.position,
            display: style.display,
            rectTop: Math.round(rect.top),
            rectBottom: Math.round(rect.bottom),
            viewportHeight: window.innerHeight,
            visibleWithoutScroll: rect.bottom <= window.innerHeight && rect.top >= 0,
            isFixed: style.position === 'fixed'
        };
    }""")

    if not nav_info.get("found"):
        return make_result("[mobile] Bottom nav — fixed position", "fail", "high",
                           "#mobile-nav element not found in DOM", "not found", "#mobile-nav exists")

    is_fixed   = nav_info["isFixed"]
    in_viewport = nav_info["visibleWithoutScroll"]
    ok = is_fixed and in_viewport

    actual = (
        f"position={nav_info['position']}, "
        f"rect.bottom={nav_info['rectBottom']}px, "
        f"viewportHeight={nav_info['viewportHeight']}px, "
        f"visibleWithoutScroll={in_viewport}"
    )
    return make_result(
        "[mobile] Bottom nav — fixed and visible without scrolling",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "#mobile-nav must be position:fixed and within viewport on page load (no scroll needed)",
        actual,
        "position=fixed, rect.bottom <= viewportHeight"
    )


def test_mobile_watchlist_drawer(page, base_url, symbol):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate(f"() => localStorage.setItem('watchlist', JSON.stringify(['{symbol}']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_show_app(page)
    page.wait_for_timeout(3000)
    wl_btn = page.locator("#nav-btn-watchlist").first
    if wl_btn.count() == 0:
        return make_result("[mobile] Watchlist drawer", "fail", "high",
                           "#nav-btn-watchlist not found", "not found", "button present")
    wl_btn.click()
    page.wait_for_timeout(800)
    drawer_open = "open" in (page.locator("#mob-wl-drawer").get_attribute("class") or "")
    return make_result(
        "[mobile] Watchlist drawer opens on tap",
        "pass" if drawer_open else "fail",
        "pass" if drawer_open else "high",
        "Tap #nav-btn-watchlist → #mob-wl-drawer should have class 'open'",
        f"drawer open: {drawer_open}", "drawer opens"
    )


def test_mobile_add_stock(page, base_url, symbol):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate("() => localStorage.setItem('watchlist', JSON.stringify(['TITAGARH']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_show_app(page)
    page.wait_for_timeout(3000)
    add_btn = page.locator("#nav-btn-add").first
    if add_btn.count() == 0:
        return make_result(f"[mobile] Add stock ({symbol})", "fail", "critical",
                           "#nav-btn-add not found in mobile bottom nav", "not found", "button present")
    add_btn.click()
    page.wait_for_timeout(500)
    modal_open = "open" in (page.locator("#modal").get_attribute("class") or "")
    if not modal_open:
        return make_result("[mobile] Add stock — modal opens", "fail", "critical",
                           "Tap #nav-btn-add → modal should open", f"open={modal_open}", "modal open")
    page.locator("#modal-search").fill(symbol)
    page.wait_for_timeout(800)
    first = page.locator("#modal-list .modal-stock-item").first
    if first.count() > 0:
        first.click()
    else:
        page.locator("#modal-search").press("Enter")
    page.wait_for_timeout(2000)
    page.locator("#nav-btn-watchlist").click()
    page.wait_for_timeout(800)
    visible = page.locator("#mob-wl-list").filter(has_text=symbol).count() > 0
    return make_result(
        f"[mobile] Add stock — {symbol} in watchlist drawer",
        "pass" if visible else "fail",
        "pass" if visible else "critical",
        "Add via mobile nav → symbol appears in watchlist drawer",
        f"visible: {visible}", "stock in mobile drawer"
    )


def test_mobile_layout(page, base_url, api_key):
    """Visual check via Claude screenshot — catches layout issues not measurable in JS."""
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(3000)
    ss = screenshot_b64(page)
    ok, reason = claude_assert(ss, api_key=api_key, question=(
        "Does this page look like a properly designed mobile app layout at 390px width? "
        "Check: text is readable (not tiny), there is no obvious content cut off on the right edge, "
        "and the layout uses full width sensibly. "
        "Answer false if you see a horizontal scrollbar, content bleeding off the right edge, "
        "or text too small to read comfortably."
    ))
    return make_result(
        "[mobile] Layout — visually mobile-friendly",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "Page should render correctly at 390px — no cut-off, no tiny text",
        reason, "Mobile-friendly layout"
    )


# ── Agent entry point ─────────────────────────────────────────────────────────

def ui_agent(state: AgentState) -> dict:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"ui_results": [make_result(
            "Playwright import", "error", "critical",
            "Run: pip install playwright && playwright install chromium",
            "ImportError", "playwright installed"
        )]}

    import os
    base_url = state["base_url"]
    symbols  = state["test_symbols"]
    api_key  = os.environ.get("ANTHROPIC_API_KEY", "")
    symbol   = symbols[0]

    print(f"[ui_agent] Testing {base_url} on desktop + mobile...")

    results = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)

        # ── Desktop tests ──────────────────────────────────────────────────
        print("  [desktop] Running desktop tests...")
        dp = browser.new_page(viewport=VIEWPORTS["desktop"])

        desktop_tests = [
            lambda: test_no_js_errors(dp, base_url, "desktop"),
            lambda: test_page_loads(dp, base_url, "desktop"),
            lambda: test_theme_toggle_desktop(dp, base_url),
            lambda: test_indices_visible(dp, base_url, api_key, "desktop"),
            lambda: test_add_stock_desktop(dp, base_url, symbol),
            lambda: test_chart_renders(dp, base_url, symbol, api_key, "desktop"),
            lambda: test_localstorage_cache(dp, base_url, symbol, "desktop"),
            lambda: test_remove_stock_desktop(dp, base_url, symbol),
        ]
        if api_key:
            desktop_tests.insert(6, lambda: test_analysis_card_renders(dp, base_url, symbol, api_key, "desktop"))

        for test_fn in desktop_tests:
            try:
                r = test_fn()
                icon = "✓" if r["status"] == "pass" else "✗"
                print(f"    [{icon}] {r['test_name']} → {r['status'].upper()}")
                results.append(r)
            except Exception as e:
                results.append(make_result("desktop_test", "error", "high",
                                           "Test threw exception", str(e), "no exception"))
        dp.close()

        # ── Mobile tests ───────────────────────────────────────────────────
        print("  [mobile] Running mobile tests...")
        mp = browser.new_page(
            viewport=VIEWPORTS["mobile"],
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        )

        mobile_tests = [
            lambda: test_no_js_errors(mp, base_url, "mobile"),
            lambda: test_page_loads(mp, base_url, "mobile"),
            lambda: test_mobile_no_horizontal_scroll(mp, base_url),
            lambda: test_mobile_bottom_nav_fixed(mp, base_url),
            lambda: test_mobile_layout(mp, base_url, api_key),
            lambda: test_indices_visible(mp, base_url, api_key, "mobile"),
            lambda: test_mobile_watchlist_drawer(mp, base_url, symbol),
            lambda: test_mobile_add_stock(mp, base_url, symbol),
            lambda: test_chart_renders(mp, base_url, symbol, api_key, "mobile"),
        ]
        if api_key:
            mobile_tests.append(lambda: test_analysis_card_renders(mp, base_url, symbol, api_key, "mobile"))

        for test_fn in mobile_tests:
            try:
                r = test_fn()
                icon = "✓" if r["status"] == "pass" else "✗"
                print(f"    [{icon}] {r['test_name']} → {r['status'].upper()}")
                results.append(r)
            except Exception as e:
                results.append(make_result("mobile_test", "error", "high",
                                           "Test threw exception", str(e), "no exception"))
        mp.close()
        browser.close()

    passes   = sum(1 for r in results if r["status"] == "pass")
    failures = len(results) - passes
    print(f"[ui_agent] Done: {passes} passed, {failures} failed.\n")
    return {"ui_results": results}
