"""
UI Test Agent — BazaarLens
Playwright browser automation with Claude visual assertions.
Every locator is on a single line to avoid IndentationError in all Python versions.
"""
import base64
import json
import httpx
from state import AgentState, TestResult

ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL  = "claude-sonnet-4-20250514"


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
    """
    Common helper: hide landing page, show the app shell.
    Called by every test that needs the main UI rather than the landing page.
    """
    page.evaluate("() => { if (typeof hideLanding === 'function') hideLanding(); if (typeof showApp === 'function') showApp(); }")


def bypass_auth_and_trigger_analysis(page, symbol):
    """
    Common helper: hide landing, show app, then trigger a live analysis.
    Used by tests that need actual analysis data (charts, AI card, cache).
    showApp() only shows 'No analysis yet' if no cached data exists —
    we must call triggerAnalysis() explicitly to kick off the API call.
    """
    page.evaluate("() => { if (typeof hideLanding === 'function') hideLanding(); if (typeof showApp === 'function') showApp(); }")
    page.wait_for_timeout(3000)
    page.evaluate(f"() => typeof triggerAnalysis === 'function' && triggerAnalysis('{symbol}')")


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_no_js_errors(page, base_url):
    """Catch JS syntax errors that break the entire page."""
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)
    ok = len(errors) == 0
    return make_result(
        "No JavaScript errors on load",
        "pass" if ok else "fail",
        "pass" if ok else "critical",
        "window.onerror / pageerror should be empty on load",
        "; ".join(errors) if errors else "none",
        "zero JS errors"
    )


def test_page_loads(page, base_url):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    title = page.title()
    ok = "BazaarLens" in title
    return make_result(
        "Page load — title contains BazaarLens",
        "pass" if ok else "fail",
        "pass" if ok else "critical",
        f"GET {base_url} and check <title>",
        f'"{title}"',
        "Title contains 'BazaarLens'"
    )


def test_theme_toggle(page, base_url):
    """
    Hide the landing page first — its z-index:500 covers the sidebar theme button.
    Uses #theme-toggle ID to avoid matching the 3 buttons sharing .theme-toggle class.
    """
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    # Must hide landing before interacting with app shell elements
    page.evaluate("() => { if (typeof hideLanding === 'function') hideLanding(); }")
    page.wait_for_timeout(500)
    initial_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
    toggle = page.locator("#theme-toggle").first
    if toggle.count() == 0:
        return make_result("Theme toggle", "fail", "low", "No #theme-toggle element found", "not found", "#theme-toggle present")
    toggle.click()
    page.wait_for_timeout(300)
    new_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
    ok = initial_theme != new_theme
    return make_result(
        "Theme toggle — switches dark/light",
        "pass" if ok else "fail",
        "pass" if ok else "medium",
        "Click #theme-toggle → data-theme attribute should change",
        f"{initial_theme} → {new_theme}",
        "theme attribute changes"
    )


def test_add_stock(page, base_url, symbol="RELIANCE"):
    """
    Bypass Firebase auth via localStorage injection, then show the app.
    Opens Add Stock modal and verifies the symbol appears in the sidebar.
    Does NOT trigger analysis — just tests the modal + watchlist add flow.
    """
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate("() => localStorage.setItem('watchlist', JSON.stringify(['TITAGARH']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_show_app(page)
    page.wait_for_timeout(3000)

    add_btn = page.locator("button.add-btn").first
    if add_btn.count() == 0 or not add_btn.is_visible():
        return make_result(
            f"Add stock — modal opens ({symbol})",
            "fail", "critical",
            "Could not find .add-btn after hideLanding()+showApp()",
            "button not found", ".add-btn visible"
        )
    add_btn.click()
    page.wait_for_timeout(500)

    search = page.locator("#modal-search")
    search.fill(symbol)
    page.wait_for_timeout(800)

    first_result = page.locator("#modal-list .modal-stock-item").first
    if first_result.count() > 0:
        first_result.click()
    else:
        search.press("Enter")

    page.wait_for_timeout(2000)
    card = page.locator("#watchlist-container").filter(has_text=symbol).first
    visible = card.count() > 0
    return make_result(
        f"Add stock — {symbol} appears in sidebar",
        "pass" if visible else "fail",
        "pass" if visible else "critical",
        f"Click '+ Add Stock', type '{symbol}', click result → card in sidebar",
        f"card visible: {visible}",
        "stock card visible in sidebar"
    )


def test_chart_renders(page, base_url, symbol, api_key):
    """
    Injects watchlist, triggers a live analysis (required — showApp alone shows
    'No analysis yet' if no cache exists), then waits for chart to appear.
    """
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate(f"() => localStorage.setItem('watchlist', JSON.stringify(['{symbol}']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_trigger_analysis(page, symbol)
    page.wait_for_timeout(35000)   # wait for full API call + chart render
    ss = screenshot_b64(page)
    ok, reason = claude_assert(ss, api_key=api_key, question=(
        "Does this page show a financial chart — candlestick, line, or price chart with date x-axis? "
        "Answer true if any chart is visible, false if only loading spinners or empty state."
    ))
    return make_result(
        f"Chart renders — visible after analysis ({symbol})",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "Price chart should appear after triggerAnalysis() completes",
        reason, "Chart visible"
    )


def test_analysis_card_renders(page, base_url, symbol, api_key):
    """
    Triggers a live analysis and checks the AI scorecard shows BUY MORE/HOLD/REVIEW.
    """
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
        f"AI analysis card — signal rendered ({symbol})",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "AI scorecard should show BUY_MORE / HOLD / REVIEW after analysis",
        reason, "Visible signal label"
    )


def test_localstorage_cache(page, base_url, symbol):
    """
    Triggers analysis and checks localStorage for a cache entry.
    Cache is only written AFTER a successful analysis completes.
    """
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate(f"() => localStorage.setItem('watchlist', JSON.stringify(['{symbol}']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_trigger_analysis(page, symbol)
    page.wait_for_timeout(40000)   # extra time for cache to be written
    cache_keys = page.evaluate(
        f"() => Object.keys(localStorage).filter(k => k.toLowerCase().includes('{symbol.lower()}') || k === 'stockData')"
    )
    # Also check stockData key which is where storeAnalysis() writes
    stock_data = page.evaluate(
        f"() => {{ try {{ const d = JSON.parse(localStorage.getItem('stockData') || '{{}}'); return d['{symbol}'] != null; }} catch(e) {{ return false; }} }}"
    )
    ok = stock_data or len(cache_keys) > 0
    return make_result(
        f"localStorage cache — entry created ({symbol})",
        "pass" if ok else "fail",
        "pass" if ok else "medium",
        "storeAnalysis() should write to localStorage.stockData after analysis",
        f"stockData[{symbol}] present: {stock_data}, keys: {cache_keys or 'none'}",
        f"stockData[{symbol}] exists"
    )


def test_remove_stock(page, base_url, symbol):
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.evaluate(f"() => localStorage.setItem('watchlist', JSON.stringify(['{symbol}']))")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    bypass_auth_and_show_app(page)
    page.wait_for_timeout(3000)

    remove_btn = page.locator("#watchlist-container .remove-btn").first
    if remove_btn.count() == 0:
        return make_result(
            f"Remove stock — button exists ({symbol})",
            "fail", "medium",
            "Could not find .remove-btn on any stock card",
            "remove button not found", ".remove-btn visible on card"
        )
    remove_btn.click()
    page.wait_for_timeout(500)
    still_visible = page.locator("#watchlist-container").filter(has_text=symbol).count() > 0
    ok = not still_visible
    return make_result(
        f"Remove stock — card disappears ({symbol})",
        "pass" if ok else "fail",
        "pass" if ok else "medium",
        "After clicking .remove-btn, stock card should disappear",
        f"still visible: {still_visible}",
        "card removed from sidebar"
    )


def test_indices_visible(page, base_url, api_key):
    """Indices appear on the Hub page — no auth bypass needed."""
    page.goto(base_url, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(5000)
    ss = screenshot_b64(page)
    ok, reason = claude_assert(ss, api_key=api_key, question=(
        "Does this page show Indian stock market index values such as Nifty 50, Sensex, or Bank Nifty with numbers? "
        "Answer true if any market index with a numeric value is visible."
    ))
    return make_result(
        "Market indices — visible on load",
        "pass" if ok else "fail",
        "pass" if ok else "medium",
        "Nifty / Sensex index values should appear on the landing/hub page",
        reason, "Index values visible"
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

    print(f"[ui_agent] Testing {base_url}...")

    results = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page    = browser.new_page(viewport={"width": 1280, "height": 800})

        tests = [
            lambda: test_no_js_errors(page, base_url),
            lambda: test_page_loads(page, base_url),
            lambda: test_theme_toggle(page, base_url),
            lambda: test_indices_visible(page, base_url, api_key),
            lambda: test_add_stock(page, base_url, symbol),
            lambda: test_chart_renders(page, base_url, symbol, api_key),
            lambda: test_localstorage_cache(page, base_url, symbol),
            lambda: test_remove_stock(page, base_url, symbol),
        ]
        if api_key:
            tests.insert(6, lambda: test_analysis_card_renders(page, base_url, symbol, api_key))

        for test_fn in tests:
            try:
                r = test_fn()
                icon = "✓" if r["status"] == "pass" else "✗"
                print(f"  [{icon}] {r['test_name']} → {r['status'].upper()}")
                results.append(r)
            except Exception as e:
                results.append(make_result(
                    test_fn.__name__ if hasattr(test_fn, '__name__') else "unknown",
                    "error", "high", "Test threw an exception", str(e), "no exception"
                ))

        browser.close()

    passes   = sum(1 for r in results if r["status"] == "pass")
    failures = len(results) - passes
    print(f"[ui_agent] Done: {passes} passed, {failures} failed.\n")
    return {"ui_results": results}
