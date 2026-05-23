"""
API Test Agent
Tests the analyze.js Vercel edge function endpoints using httpx.
Validates response shape, CORS headers, error handling, and data integrity.
"""
import httpx
import json
from state import AgentState, TestResult

TIMEOUT = 30.0   # Vercel edge cold starts can be slow


def make_result(test_name: str, status: str, severity: str,
                detail: str, actual: str, expected: str) -> TestResult:
    return TestResult(
        agent="api", test_name=test_name, status=status,
        severity=severity, detail=detail, actual=actual, expected=expected
    )


# ── Schema validators ─────────────────────────────────────────────────────────

PRICE_ONLY_KEYS = {"price", "changePct", "high52", "low52"}

FULL_ANALYSIS_KEYS = {
    "symbol", "name", "indicators", "analysis", "fundamentals",
    "ohlcv", "ema20Series", "fetchedAt"
}

ANALYSIS_KEYS = {"signal", "confidence", "summary", "technicalPoints",
                 "support", "resistance", "outlook", "keyRisk"}

VALID_SIGNALS     = {"BUY_MORE", "HOLD", "REVIEW"}
VALID_CONFIDENCES = {"HIGH", "MEDIUM", "LOW"}


# ── Individual test cases ─────────────────────────────────────────────────────

def test_price_only_returns_200(api_url: str, symbol: str) -> TestResult:
    """priceOnly=1 should return HTTP 200 with price fields"""
    url = f"{api_url}?symbol={symbol}&priceOnly=1"
    try:
        r = httpx.get(url, timeout=TIMEOUT)
        body = r.json()
        missing = PRICE_ONLY_KEYS - set(body.keys())
        ok = r.status_code == 200 and not missing
        return make_result(
            f"priceOnly — HTTP 200 + shape ({symbol})",
            "pass" if ok else "fail",
            "pass" if ok else "critical",
            f"GET {url}",
            f"status={r.status_code}, missing={missing or 'none'}",
            "200, all price keys present"
        )
    except Exception as e:
        return make_result(f"priceOnly — HTTP 200 ({symbol})", "error", "critical",
                           url, str(e), "200 response")


def test_price_only_values_sane(api_url: str, symbol: str) -> TestResult:
    """Price should be a positive number, changePct within ±30%"""
    url = f"{api_url}?symbol={symbol}&priceOnly=1"
    try:
        body = httpx.get(url, timeout=TIMEOUT).json()
        price  = body.get("price")
        change = body.get("changePct")
        ok = (
            isinstance(price, (int, float)) and price > 0 and
            isinstance(change, (int, float)) and -30 <= change <= 30
        )
        return make_result(
            f"priceOnly — sane values ({symbol})",
            "pass" if ok else "fail",
            "pass" if ok else "high",
            "price > 0 and changePct in [-30, 30]",
            f"price={price}, changePct={change}",
            "price > 0, changePct ∈ [-30, 30]"
        )
    except Exception as e:
        return make_result(f"priceOnly — sane values ({symbol})", "error", "high",
                           url, str(e), "valid numeric values")


def test_full_analysis_shape(api_url: str, symbol: str) -> TestResult:
    """Full analysis should return all required top-level keys"""
    url = f"{api_url}?symbol={symbol}&name={symbol}&sector=default"
    try:
        r = httpx.get(url, timeout=TIMEOUT)
        body = r.json()
        missing = FULL_ANALYSIS_KEYS - set(body.keys())
        ok = r.status_code == 200 and not missing
        return make_result(
            f"Full analysis — response shape ({symbol})",
            "pass" if ok else "fail",
            "pass" if ok else "critical",
            f"Top-level keys check: {FULL_ANALYSIS_KEYS}",
            f"missing={missing or 'none'}",
            "All keys present"
        )
    except Exception as e:
        return make_result(f"Full analysis — shape ({symbol})", "error", "critical",
                           url, str(e), "valid JSON response")


def test_analysis_signal_valid(api_url: str, symbol: str) -> TestResult:
    """analysis.signal must be BUY_MORE | HOLD | REVIEW"""
    url = f"{api_url}?symbol={symbol}&sector=default"
    try:
        body  = httpx.get(url, timeout=TIMEOUT).json()
        sig   = body.get("analysis", {}).get("signal")
        conf  = body.get("analysis", {}).get("confidence")
        ok    = sig in VALID_SIGNALS and conf in VALID_CONFIDENCES
        return make_result(
            f"Analysis — valid signal + confidence ({symbol})",
            "pass" if ok else "fail",
            "pass" if ok else "critical",
            f"signal ∈ {VALID_SIGNALS}, confidence ∈ {VALID_CONFIDENCES}",
            f"signal={sig}, confidence={conf}",
            "valid enum values"
        )
    except Exception as e:
        return make_result(f"Analysis — signal ({symbol})", "error", "critical",
                           url, str(e), "valid signal enum")


def test_ohlcv_has_data(api_url: str, symbol: str) -> TestResult:
    """ohlcv array should have ≥ 20 rows for charting to work"""
    url = f"{api_url}?symbol={symbol}&sector=default"
    try:
        body  = httpx.get(url, timeout=TIMEOUT).json()
        ohlcv = body.get("ohlcv", [])
        count = len(ohlcv)
        ok    = count >= 20
        return make_result(
            f"OHLCV — at least 20 rows ({symbol})",
            "pass" if ok else "fail",
            "pass" if ok else "high",
            "Frontend chart needs ≥20 data points",
            f"{count} rows",
            "≥ 20 rows"
        )
    except Exception as e:
        return make_result(f"OHLCV rows ({symbol})", "error", "high",
                           url, str(e), "≥20 rows")


def test_invalid_symbol_returns_error(api_url: str) -> TestResult:
    """Invalid ticker should return 4xx or 5xx with an error field"""
    url = f"{api_url}?symbol=NOTASTOCK999&sector=default"
    try:
        r    = httpx.get(url, timeout=TIMEOUT)
        body = r.json()
        ok   = r.status_code >= 400 or "error" in body
        return make_result(
            "Error handling — invalid symbol",
            "pass" if ok else "fail",
            "pass" if ok else "high",
            "Nonsense ticker should return error, not silent 200",
            f"status={r.status_code}, has_error={'error' in body}",
            "status ≥ 400 or body.error present"
        )
    except Exception as e:
        return make_result("Error handling — invalid symbol", "error", "high",
                           url, str(e), "error response")


def test_missing_symbol_returns_400(api_url: str) -> TestResult:
    """Omitting symbol param should return 400"""
    url = f"{api_url}?sector=default"
    try:
        r  = httpx.get(url, timeout=TIMEOUT)
        ok = r.status_code == 400
        return make_result(
            "Validation — missing symbol → 400",
            "pass" if ok else "fail",
            "pass" if ok else "medium",
            "Request with no symbol param",
            f"status={r.status_code}",
            "400 Bad Request"
        )
    except Exception as e:
        return make_result("Validation — missing symbol", "error", "medium",
                           url, str(e), "400 response")


def test_cors_headers_present(api_url: str) -> TestResult:
    """CORS headers must be present for GitHub Pages to call the API"""
    url = f"{api_url}?symbol=TCS&priceOnly=1"
    try:
        r   = httpx.get(url, timeout=TIMEOUT)
        acao = r.headers.get("access-control-allow-origin", "")
        ok   = acao == "*" or "bazaarlens" in acao
        return make_result(
            "CORS — Access-Control-Allow-Origin present",
            "pass" if ok else "fail",
            "pass" if ok else "critical",
            "GitHub Pages frontend requires CORS header on API responses",
            f"Access-Control-Allow-Origin: {acao or 'MISSING'}",
            "* or bazaarlens origin"
        )
    except Exception as e:
        return make_result("CORS headers", "error", "critical",
                           url, str(e), "CORS header present")


def test_options_preflight(api_url: str) -> TestResult:
    """OPTIONS preflight should return 204 with CORS headers"""
    url = f"{api_url}?symbol=TCS"
    try:
        r  = httpx.options(url, timeout=TIMEOUT)
        ok = r.status_code == 204
        return make_result(
            "CORS — OPTIONS preflight → 204",
            "pass" if ok else "fail",
            "pass" if ok else "high",
            "Browser sends OPTIONS preflight before POST/GET from other origin",
            f"status={r.status_code}",
            "204 No Content"
        )
    except Exception as e:
        return make_result("CORS — OPTIONS preflight", "error", "high",
                           url, str(e), "204 response")


def test_indicators_numeric(api_url: str, symbol: str) -> TestResult:
    """All indicator fields should be numbers, not null or strings"""
    url = f"{api_url}?symbol={symbol}&sector=default"
    try:
        body  = httpx.get(url, timeout=TIMEOUT).json()
        ind   = body.get("indicators", {})
        non_numeric = {k: v for k, v in ind.items()
                       if v is not None and not isinstance(v, (int, float, dict))}
        ok = len(non_numeric) == 0
        return make_result(
            f"Indicators — all numeric ({symbol})",
            "pass" if ok else "fail",
            "pass" if ok else "medium",
            "indicators object fields should be numbers or null",
            f"Non-numeric: {non_numeric or 'none'}",
            "All numeric or null"
        )
    except Exception as e:
        return make_result(f"Indicators — numeric ({symbol})", "error", "medium",
                           url, str(e), "numeric indicator values")


# ── Agent entry point ─────────────────────────────────────────────────────────

def api_agent(state: AgentState) -> dict:
    """
    LangGraph node — runs all API endpoint tests.
    Runs in parallel with ui_agent and financial_agent.
    """
    api_url = state["api_url"]
    symbols = state["test_symbols"][:2]   # Test with first 2 symbols to keep runtime short

    print(f"[api_agent] Testing {api_url} with symbols {symbols}...")

    results: list[TestResult] = []

    # CORS + error handling (symbol-independent)
    for test_fn in [test_cors_headers_present, test_options_preflight,
                    test_invalid_symbol_returns_error, test_missing_symbol_returns_400]:
        try:
            # Some tests take api_url only, others take api_url + symbol
            import inspect
            sig = inspect.signature(test_fn)
            if len(sig.parameters) == 1:
                r = test_fn(api_url)
            else:
                r = test_fn(api_url, symbols[0])
            icon = "✓" if r["status"] == "pass" else "✗"
            print(f"  [{icon}] {r['test_name']} → {r['status'].upper()}")
            results.append(r)
        except Exception as e:
            results.append(make_result(test_fn.__name__, "error", "critical",
                                       "Test threw", str(e), "no exception"))

    # Per-symbol tests
    per_symbol_tests = [
        test_price_only_returns_200,
        test_price_only_values_sane,
        test_full_analysis_shape,
        test_analysis_signal_valid,
        test_ohlcv_has_data,
        test_indicators_numeric,
    ]
    for symbol in symbols:
        for test_fn in per_symbol_tests:
            try:
                r = test_fn(api_url, symbol)
                icon = "✓" if r["status"] == "pass" else "✗"
                print(f"  [{icon}] {r['test_name']} → {r['status'].upper()}")
                results.append(r)
            except Exception as e:
                results.append(make_result(f"{test_fn.__name__}_{symbol}", "error", "critical",
                                           "Test threw", str(e), "no exception"))

    passes   = sum(1 for r in results if r["status"] == "pass")
    failures = len(results) - passes
    print(f"[api_agent] Done: {passes} passed, {failures} failed.\n")

    return {"api_results": results}
