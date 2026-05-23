"""
Financial Test Agent
Tests the correctness of all mathematical indicators in analyze.js.
Reimplements them in Python and cross-validates against known values.
No browser or network needed — pure math validation.
"""
import math
from state import AgentState, TestResult


# ── Python reimplementations of analyze.js functions ────────────────────────

def avg(values: list[float]) -> float:
    v = [x for x in values if x is not None and not math.isnan(x)]
    return sum(v) / len(v) if v else 0.0


def calc_rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    gains, losses = 0.0, 0.0
    for i in range(len(closes) - period, len(closes)):
        diff = closes[i] - closes[i - 1]
        if diff > 0:
            gains += diff
        else:
            losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period or 0.001
    return 100 - 100 / (1 + avg_gain / avg_loss)


def ema(closes: list[float], period: int) -> float:
    if not closes or period > len(closes):
        return avg(closes)
    k = 2 / (period + 1)
    e = avg(closes[:period])
    for i in range(period, len(closes)):
        e = closes[i] * k + e * (1 - k)
    return e


def calc_macd(closes: list[float]) -> tuple[float, float]:
    """Returns (macd_line, signal_line)"""
    if len(closes) < 26:
        return 0.0, 0.0
    ema12 = ema(closes, 12)
    ema26 = ema(closes, 26)
    macd_val = ema12 - ema26
    # Signal is EMA(9) of MACD — approximate using last 9 values
    macd_series = [ema(closes[:i], 12) - ema(closes[:i], 26)
                   for i in range(26, len(closes) + 1)]
    signal = ema(macd_series, 9) if len(macd_series) >= 9 else macd_val
    return macd_val, signal


def calc_bb(closes: list[float]) -> tuple[float, float, float]:
    """Returns (upper, lower, pct_b) using last 20 closes"""
    window = closes[-20:]
    sma = avg(window)
    std = math.sqrt(avg([(c - sma) ** 2 for c in window]))
    upper = sma + 2 * std
    lower = sma - 2 * std
    price = closes[-1]
    pct = ((price - lower) / (upper - lower) * 100) if std > 0 else 50.0
    return upper, lower, pct


def calc_tech_score(closes: list[float], volumes: list[float]) -> float:
    """Replicates the scores object in analyze.js and returns techScoreNorm"""
    price  = closes[-1]
    sma20  = avg(closes[-20:])
    sma50  = avg(closes[-50:]) if len(closes) >= 50 else None
    rsi    = calc_rsi(closes)
    macd_v, macd_s = calc_macd(closes)
    high52 = max(closes)
    low52  = min(closes)
    change30d = ((closes[-1] - closes[-30]) / closes[-30] * 100) if len(closes) >= 30 else None
    avg_vol20 = avg(volumes[-20:])
    vol_ratio = (volumes[-1] / avg_vol20) if avg_vol20 > 0 else 1.0
    change_pct = (closes[-1] - closes[-2]) / closes[-2] * 100 if len(closes) >= 2 else 0
    _, _, bb_pct = calc_bb(closes)

    scores = {
        "trend":    2 if (price > sma20 and (sma50 is None or price > sma50))
                    else 1 if price > sma20
                    else -1 if (sma50 and price > sma50)
                    else -2,
        "momentum": 2 if (55 < rsi < 70)
                    else -1 if rsi > 70
                    else 2 if rsi < 35
                    else -1 if rsi < 45
                    else 0,
        "macdSig":  2 if (macd_v > 0 and macd_v > macd_s)
                    else 1 if macd_v > 0
                    else -2 if (macd_v < 0 and macd_v < macd_s)
                    else -1,
        "range52w": 2 if price > high52 * 0.9
                    else 1 if price > high52 * 0.7
                    else 0 if price > high52 * 0.5
                    else -1,
        "volume":   2 if (vol_ratio > 1.5 and change_pct > 0)
                    else -2 if (vol_ratio > 1.5 and change_pct < 0)
                    else -1 if vol_ratio < 0.6
                    else 0,
        "bbPos":    2 if bb_pct < 20
                    else -1 if bb_pct > 80
                    else 1 if bb_pct > 50
                    else 0,
        "return30d": (2 if change30d > 10
                      else 1 if change30d > 0
                      else -1 if change30d > -10
                      else -2) if change30d is not None else 0,
    }
    tech_score = sum(scores.values())
    return round((tech_score + 14) / 28 * 10, 1)


# ── Test helpers ─────────────────────────────────────────────────────────────

def make_result(test_name: str, status: str, severity: str,
                detail: str, actual: str, expected: str) -> TestResult:
    return TestResult(
        agent="financial", test_name=test_name, status=status,
        severity=severity, detail=detail, actual=actual, expected=expected
    )


def assert_close(a: float, b: float, tol: float = 0.5) -> bool:
    return abs(a - b) <= tol


# ── Individual test cases ─────────────────────────────────────────────────────

def test_rsi_flat_prices() -> TestResult:
    """Flat prices (no change) → RSI should be 50 (neutral)"""
    closes = [100.0] * 20
    result = calc_rsi(closes)
    ok = assert_close(result, 50.0, tol=1.0)
    return make_result(
        "RSI — flat prices",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "RSI on 20 identical prices should return ~50",
        f"{result:.2f}",
        "~50.0"
    )


def test_rsi_all_gains() -> TestResult:
    """Strictly increasing prices → RSI should be very high (overbought)"""
    closes = [float(100 + i) for i in range(20)]
    result = calc_rsi(closes)
    ok = result > 90
    return make_result(
        "RSI — all gains",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "Strictly increasing prices → RSI > 90",
        f"{result:.2f}",
        "> 90"
    )


def test_rsi_all_losses() -> TestResult:
    """Strictly decreasing prices → RSI should be very low (oversold)"""
    closes = [float(100 - i) for i in range(20)]
    result = calc_rsi(closes)
    ok = result < 10
    return make_result(
        "RSI — all losses",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "Strictly decreasing prices → RSI < 10",
        f"{result:.2f}",
        "< 10"
    )


def test_rsi_insufficient_data() -> TestResult:
    """Fewer than 15 data points → RSI should fall back to 50"""
    closes = [100.0] * 10
    result = calc_rsi(closes)
    ok = result == 50.0
    return make_result(
        "RSI — insufficient data fallback",
        "pass" if ok else "fail",
        "pass" if ok else "medium",
        "< 15 points → RSI fallback = 50",
        f"{result:.2f}",
        "50.0"
    )


def test_ema_convergence() -> TestResult:
    """EMA(n) of constant series should equal that constant"""
    closes = [200.0] * 50
    result = ema(closes, 20)
    ok = assert_close(result, 200.0, tol=0.01)
    return make_result(
        "EMA — constant series convergence",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "EMA of 50× 200.0 should equal 200.0",
        f"{result:.4f}",
        "200.0"
    )


def test_ema_responsiveness() -> TestResult:
    """EMA should react faster to recent prices than SMA"""
    baseline = [100.0] * 30
    spike    = baseline + [200.0] * 5
    ema_val  = ema(spike, 20)
    sma_val  = avg(spike[-20:])
    # EMA weights recent prices more, so it should be higher than SMA
    ok = ema_val > sma_val
    return make_result(
        "EMA — faster than SMA on price spike",
        "pass" if ok else "fail",
        "pass" if ok else "medium",
        "After price spike EMA should exceed SMA (recent weighting)",
        f"EMA={ema_val:.2f}, SMA={sma_val:.2f}",
        "EMA > SMA"
    )


def test_macd_bullish_crossover() -> TestResult:
    """Rising prices → MACD line should be positive (EMA12 > EMA26)"""
    closes = [float(50 + i * 0.5) for i in range(60)]
    macd_val, _ = calc_macd(closes)
    ok = macd_val > 0
    return make_result(
        "MACD — bullish on rising prices",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "Steadily rising prices → MACD line > 0",
        f"{macd_val:.4f}",
        "> 0"
    )


def test_macd_bearish_crossover() -> TestResult:
    """Falling prices → MACD line should be negative"""
    closes = [float(200 - i * 0.5) for i in range(60)]
    macd_val, _ = calc_macd(closes)
    ok = macd_val < 0
    return make_result(
        "MACD — bearish on falling prices",
        "pass" if ok else "fail",
        "pass" if ok else "high",
        "Steadily falling prices → MACD line < 0",
        f"{macd_val:.4f}",
        "< 0"
    )


def test_bb_middle_price() -> TestResult:
    """Price exactly at SMA → BB% should be ~50"""
    closes = [100.0] * 19 + [100.0]   # flat then same price
    _, _, pct = calc_bb(closes)
    # With all same prices std=0, pct defaults to 50
    ok = assert_close(pct, 50.0, tol=5.0)
    return make_result(
        "Bollinger bands — price at midline",
        "pass" if ok else "fail",
        "pass" if ok else "medium",
        "Price at SMA → BB% ≈ 50",
        f"{pct:.2f}%",
        "~50%"
    )


def test_tech_score_range() -> TestResult:
    """techScoreNorm must always fall in [0, 10]"""
    import random
    random.seed(42)
    scores = []
    for _ in range(20):
        closes  = [random.uniform(80, 120) for _ in range(60)]
        volumes = [random.uniform(1e6, 5e6) for _ in range(60)]
        scores.append(calc_tech_score(closes, volumes))
    out_of_range = [s for s in scores if not (0 <= s <= 10)]
    ok = len(out_of_range) == 0
    return make_result(
        "Tech score normalisation — always [0, 10]",
        "pass" if ok else "fail",
        "pass" if ok else "critical",
        "techScoreNorm must stay in [0, 10] for 20 random price series",
        f"Out-of-range: {out_of_range}" if out_of_range else "All in range",
        "[0, 10] for all inputs"
    )


def test_known_reliance_rsi() -> TestResult:
    """
    Sanity-check: a real Reliance price series from a known date range
    should produce an RSI in a plausible range (30–80).
    Using a synthetic but realistic series here — replace with actual data.
    """
    # Synthetic realistic Reliance-like series (₹2400–2600 range, 30 days)
    import random
    random.seed(7)
    price = 2450.0
    closes = []
    for _ in range(30):
        price += random.gauss(0, 15)
        closes.append(max(2200, price))
    result = calc_rsi(closes)
    ok = 20 < result < 85
    return make_result(
        "RSI — realistic NSE price series",
        "pass" if ok else "fail",
        "pass" if ok else "medium",
        "RSI on a realistic NSE price series should be in [20, 85]",
        f"{result:.2f}",
        "20 < RSI < 85"
    )


# ── Agent entry point ─────────────────────────────────────────────────────────

def financial_agent(state: AgentState) -> dict:
    """
    LangGraph node — runs all financial tests and returns results.
    This node runs in parallel with ui_agent and api_agent via Send().
    """
    print("[financial_agent] Starting mathematical validation tests...")

    tests = [
        test_rsi_flat_prices,
        test_rsi_all_gains,
        test_rsi_all_losses,
        test_rsi_insufficient_data,
        test_ema_convergence,
        test_ema_responsiveness,
        test_macd_bullish_crossover,
        test_macd_bearish_crossover,
        test_bb_middle_price,
        test_tech_score_range,
        test_known_reliance_rsi,
    ]

    results = []
    for test_fn in tests:
        try:
            r = test_fn()
            icon = "✓" if r["status"] == "pass" else "✗"
            print(f"  [{icon}] {r['test_name']} → {r['status'].upper()}")
            results.append(r)
        except Exception as e:
            results.append(make_result(
                test_fn.__name__, "error", "critical",
                "Test threw an exception", str(e), "no exception"
            ))

    passes   = sum(1 for r in results if r["status"] == "pass")
    failures = len(results) - passes
    print(f"[financial_agent] Done: {passes} passed, {failures} failed.\n")

    return {"financial_results": results}
