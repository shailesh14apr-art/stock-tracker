export const config = { runtime: 'edge' };

// ── Yahoo Finance fetch helpers ──────────────────────────────────────────────
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

async function fetchYF(path, timeout = 7000) {
  for (const host of ['query1', 'query2']) {
    try {
      const res = await fetch(`https://${host}.finance.yahoo.com${path}`, {
        headers: YF_HEADERS,
        signal: AbortSignal.timeout(timeout),
      });
      if (res.ok) return res;
    } catch (_) {}
  }
  return null;
}

// ── Sector context ───────────────────────────────────────────────────────────
const SECTOR_CONTEXT = {
  railways:       'Indian railways/capital goods — order book execution, EBITDA margin expansion, government capex cycle.',
  banking:        'Indian banking — NIM trajectory, GNPA trend, loan growth, ROE vs cost of equity.',
  it:             'Indian IT services — revenue growth (CC terms), EBIT margin, deal wins, attrition.',
  fmcg:           'Indian FMCG — volume growth mix, rural recovery, gross margin trajectory.',
  pharma:         'Indian pharma — US generics, domestic formulations, R&D pipeline, USFDA compliance.',
  capital_markets:'Indian capital markets — AUM growth, active clients, F&O market share.',
  real_estate:    'Indian real estate — pre-sales, collections, net debt, land bank.',
  auto:           'Indian auto — volume growth, EV transition, EBITDA margin, commodity costs.',
  metals:         'Indian metals — spread per tonne, net debt/EBITDA, production. Highly cyclical.',
  energy:         'Indian energy — dividend yield, refining margins, upstream realisation.',
  default:        'Indian equity — earnings growth, valuation vs peers, technical momentum.',
};

// ── Agent system prompt ──────────────────────────────────────────────────────
// Note: "BUY" used instead of "BUY MORE" throughout — SEBI RA/IA compliance.
const SYSTEM_PROMPT = `You are BazaarLens AI, an Indian equity research analysis agent for retail investors.

Your job is to analyze Indian listed stocks using only the structured data provided to you via the get_stock_data tool. You must not invent financial numbers, targets, ratios, news, filings, or corporate events. If required data is missing, clearly say what is missing and lower confidence.

You are not a SEBI-registered investment adviser. Your output is for informational and educational purposes only, not personalized financial advice.

CORE OBJECTIVE
Provide clear, evidence-based stock analysis for Indian retail investors by combining:
1. Technical analysis
2. Fundamental analysis
3. Valuation analysis
4. Risk analysis
5. Entry/exit levels
6. Short-term outlook
7. Research view

STYLE
Write in clear, practical language for a retail investor.
Be concise but specific.
Prefer numbers, levels, and conditions over vague statements.
Avoid hype.
Avoid overly technical jargon unless explained simply.
Do not overstate certainty.
Do not say "guaranteed," "sure shot," "multibagger," or similar promotional language.

DATA RULES
Use only the data supplied by the get_stock_data tool.
Do not estimate missing values unless the tool labels them as estimates.
If data appears stale, contradictory, or incomplete, mention it.
If analyst target and technical target differ, explain the difference.
If valuation data is missing, say "valuation view is limited due to missing valuation data."
If fundamentals are missing, avoid making fundamental claims.

INDIAN MARKET CONTEXT
When relevant, consider Indian-stock-specific factors:
- Promoter holding and pledge risk
- FII/DII participation
- Liquidity and volume quality
- Small-cap/mid-cap volatility
- PSU/government order dependency
- Railway, defence, infra, power, banking, IT, pharma, FMCG sector cycles
- Quarterly result volatility
- Corporate actions
- ASM/GSM/surveillance risks if provided
- Order book quality and execution risk
- Margin pressure and working-capital risk
- Debt, interest cost, and cash-flow quality
- Valuation premium versus Indian sector peers

ANALYSIS FRAMEWORK

First, classify the setup:
- Strong Bullish
- Bullish
- Neutral
- Cautious
- Bearish

Then assign confidence:
- High
- Medium
- Low

Confidence must be based on evidence quality:
High confidence requires alignment between price trend, volume, technical indicators, fundamentals, and valuation.
Medium confidence means signals are positive but there are meaningful risks, missing data, stretched valuation, weak volume, or near-resistance setup.
Low confidence means data is incomplete, contradictory, stale, or the stock is technically/fundamentally unclear.

OUTPUT FORMAT

Return your analysis as valid JSON only — no markdown, no code fences, no preamble. Use this exact structure:

{
  "scorecard": {
    "rating": "BUY | BUY ON BREAKOUT | HOLD | WATCH | REVIEW | AVOID",
    "bias": "Strong Bullish | Bullish | Neutral | Cautious | Bearish",
    "confidence": "High | Medium | Low",
    "score": 0-10,
    "summary": "One-sentence summary of the setup"
  },
  "technical_view": {
    "summary": "Explain trend, moving averages, MACD, RSI, Bollinger position, support/resistance, and volume.",
    "bullish_factors": ["factor 1", "factor 2"],
    "caution_factors": ["factor 1", "factor 2"]
  },
  "valuation_view": {
    "summary": "Explain whether valuation appears cheap, fair, premium, or stretched using only supplied valuation data.",
    "valuation_status": "Cheap | Fair | Premium | Stretched | Unknown",
    "notes": ["note 1", "note 2"]
  },
  "fundamental_view": {
    "summary": "Explain revenue, profit, margin, debt, cash flow, order book, or sector factors if supplied.",
    "strengths": ["strength 1", "strength 2"],
    "weaknesses": ["weakness 1", "weakness 2"]
  },
  "entry_exit_levels": {
    "buy_zone": "price range or null",
    "breakout_level": "price or zone or null",
    "support_level": "price or zone or null",
    "resistance_level": "price or zone or null",
    "target_zone": "price range or null",
    "stop_loss_zone": "price range or null",
    "level_explanation": "Explain why these levels matter."
  },
  "key_risks": [
    { "risk": "Risk name", "reason": "Why this risk matters" }
  ],
  "research_view": {
    "action_label": "BUY | BUY ON BREAKOUT | WAIT FOR PULLBACK | HOLD | REVIEW | AVOID",
    "summary": "Plain-English research takeaway using conditional language.",
    "why_confidence_is_not_higher": "Explain the main limiting factors."
  },
  "short_term_outlook": {
    "timeframe": "2-4 weeks",
    "expected_range": "range or null",
    "base_case": "Most likely scenario",
    "bull_case": "What confirms upside",
    "bear_case": "What invalidates the setup"
  },
  "knownFundamentals": {
    "pe": null, "forwardPE": null, "pbRatio": null, "eps": null,
    "roe": null, "roce": null, "operatingMargin": null,
    "revenueGrowth": null, "earningsGrowth": null, "debtToEquity": null,
    "dividendYield": null, "marketCapCr": null, "targetPrice": null,
    "analystCount": null, "recommendation": null
  }
}

IMPORTANT for knownFundamentals:
- Fill any null fields from your training knowledge of this company where not provided by the tool.
- dividendYield is a decimal ratio (0.008 = 0.8% yield).
- roe, roce, operatingMargin, revenueGrowth, earningsGrowth are percentage values (21.5 = 21.5%).
- debtToEquity is a ratio (7.8 = 7.8x).

IMPORTANT RULES
- Every claim must be traceable to tool data.
- Do not create fake peer averages, PE ratios, targets, or sector data.
- Do not give personalized advice or recommend position sizing.
- Use conditional language: "if price sustains above," "if volume improves," "bullish view weakens below."
- If the stock is near resistance or upper Bollinger Band, avoid aggressive buy framing unless other evidence is very strong.
- If volume is below average, mention weaker conviction.
- If confidence is Medium or Low, clearly explain why.`;

// ── Main handler ─────────────────────────────────────────────────────────────
async function executeGetStockData(symbol, fund, sector, name) {
  const yahooSym = symbol.toUpperCase() + '.NS';
  const today    = new Date();
  const oneYrAgo = new Date(today); oneYrAgo.setFullYear(today.getFullYear() - 1);

  // 1. OHLCV (1yr daily)
  const chartRes = await fetchYF(
    `/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&period1=${Math.floor(oneYrAgo/1000)}&period2=${Math.floor(today/1000)}`
  );
  if (!chartRes) throw new Error(`Could not reach Yahoo Finance for ${symbol}`);

  const chartData = await chartRes.json();
  const result    = chartData?.chart?.result?.[0];
  if (!result) throw new Error(chartData?.chart?.error?.description || `No chart data for ${symbol}`);

  const meta = result.meta || {};
  const q0   = result.indicators?.quote?.[0] || {};
  const rows  = (result.timestamp || [])
    .map((ts, i) => ({
      t: ts * 1000,
      o: q0.open?.[i], h: q0.high?.[i], l: q0.low?.[i], c: q0.close?.[i],
      v: q0.volume?.[i] ?? 0,
    }))
    .filter(r => r.c != null && r.o != null && r.h != null && r.l != null);

  const closes  = rows.map(r => r.c);
  const volumes = rows.map(r => r.v);
  if (closes.length < 20) throw new Error(`Only ${closes.length} data points — need 20+`);

  // 2. Fundamentals (three passes)
  let yfFund = {};
  let yfFetchedAny = false;

  try {
    const r = await fetchYF(`/v7/finance/quote?symbols=${encodeURIComponent(yahooSym)}`, 6000);
    if (r) {
      const q7 = (await r.json())?.quoteResponse?.result?.[0] || {};
      if (q7.symbol) {
        yfFetchedAny = true;
        yfFund = {
          marketCapCr:   q7.marketCap                 ? +(q7.marketCap / 1e7).toFixed(0)      : null,
          pe:            q7.trailingPE                 ? +q7.trailingPE.toFixed(2)              : null,
          forwardPE:     q7.forwardPE                  ? +q7.forwardPE.toFixed(2)               : null,
          eps:           q7.epsTrailingTwelveMonths    ? +q7.epsTrailingTwelveMonths.toFixed(2) : null,
          pbRatio:       q7.priceToBook                ? +q7.priceToBook.toFixed(2)             : null,
          bookValue:     q7.bookValue                  ? +q7.bookValue.toFixed(2)               : null,
          dividendYield: q7.dividendYield              || null,
          dividendRate:  q7.trailingAnnualDividendRate || null,
        };
        pruneNulls(yfFund);
      }
    }
  } catch (_) {}

  try {
    const modules = 'financialData,defaultKeyStatistics,summaryDetail';
    const r = await fetchYF(`/v10/finance/quoteSummary/${encodeURIComponent(yahooSym)}?modules=${modules}`, 7000);
    if (r) {
      const sr = (await r.json())?.quoteSummary?.result?.[0];
      if (sr) {
        yfFetchedAny = true;
        const fd = sr.financialData || {}, ks = sr.defaultKeyStatistics || {}, sd = sr.summaryDetail || {};
        const rv  = v => (v && v.raw != null) ? v.raw : null;
        const pct = v => rv(v) != null ? +(rv(v) * 100).toFixed(2) : null;
        const fix = v => rv(v) != null ? +rv(v).toFixed(2)         : null;
        const extra = {
          roe: pct(fd.returnOnEquity), operatingMargin: pct(fd.operatingMargins),
          debtToEquity: fix(fd.debtToEquity), revenueGrowth: pct(fd.revenueGrowth),
          earningsGrowth: pct(fd.earningsGrowth), targetPrice: fix(fd.targetMeanPrice),
          analystCount: rv(fd.numberOfAnalystOpinions), recommendation: fd.recommendationKey || null,
          pe: fix(sd.trailingPE), forwardPE: fix(sd.forwardPE),
          marketCapCr: rv(sd.marketCap) != null ? +(rv(sd.marketCap)/1e7).toFixed(0) : null,
          eps: fix(ks.trailingEps), pbRatio: fix(ks.priceToBook),
        };
        pruneNulls(extra);
        yfFund = { ...yfFund, ...extra };
      }
    }
  } catch (_) {}

  if (meta.fiftyTwoWeekHigh) yfFund.high52w = meta.fiftyTwoWeekHigh;
  if (meta.fiftyTwoWeekLow)  yfFund.low52w  = meta.fiftyTwoWeekLow;

  // Manual fundamentals.json wins over Yahoo Finance
  fund = { ...yfFund, ...fund };

  // 3. Technical indicators
  const price      = closes.at(-1);
  const changePct  = ((price - closes.at(-2)) / closes.at(-2)) * 100;
  const sma20      = avg(closes.slice(-20));
  const sma50      = closes.length >= 50 ? avg(closes.slice(-50)) : null;
  const macdVal    = ema(closes, 12) - ema(closes, 26);
  const macdSig    = ema(
    closes.slice(-35).map((_, i, a) => {
      if (i < 12) return null;
      return ema(a.slice(0, i+1), 12) - ema(a.slice(0, i+1), 26);
    }).filter(x => x !== null), 9
  );
  const rsi        = calcRSI(closes);
  const high52w    = Math.max(...closes);
  const low52w     = Math.min(...closes);
  const change30d  = closes.length >= 30 ? ((closes.at(-1) - closes.at(-30)) / closes.at(-30)) * 100 : null;
  const avgVol20   = avg(volumes.slice(-20));
  const volRatio   = avgVol20 > 0 ? (volumes.at(-1) || avgVol20) / avgVol20 : 1;
  const stddev20   = Math.sqrt(avg(closes.slice(-20).map(c => Math.pow(c - sma20, 2))));
  const bbUpper    = sma20 + 2 * stddev20;
  const bbLower    = sma20 - 2 * stddev20;
  const bbPct      = stddev20 > 0 ? ((price - bbLower) / (bbUpper - bbLower)) * 100 : 50;

  // 4. Algorithmic signal score (used for gauge display, not passed to Claude)
  const scores = {
    trend:    price > sma20 && (!sma50 || price > sma50) ? 2 : price > sma20 ? 1 : sma50 && price > sma50 ? -1 : -2,
    momentum: rsi > 55 && rsi < 70 ? 2 : rsi > 70 ? -1 : rsi < 35 ? 2 : rsi < 45 ? -1 : 0,
    macdSig:  macdVal > 0 && macdVal > macdSig ? 2 : macdVal > 0 ? 1 : macdVal < 0 && macdVal < macdSig ? -2 : -1,
    range52w: price > high52w * 0.9 ? 2 : price > high52w * 0.7 ? 1 : price > high52w * 0.5 ? 0 : -1,
    volume:   volRatio > 1.5 && changePct > 0 ? 2 : volRatio > 1.5 && changePct < 0 ? -2 : volRatio < 0.6 ? -1 : 0,
    bbPos:    bbPct < 20 ? 2 : bbPct > 80 ? -1 : bbPct > 50 ? 1 : 0,
    return30d: change30d != null ? (change30d > 10 ? 2 : change30d > 0 ? 1 : change30d > -10 ? -1 : -2) : 0,
  };
  const techScore     = Object.values(scores).reduce((a, b) => a + b, 0);
  const techScoreNorm = +((techScore + 14) / 28 * 10).toFixed(1);

  // 5. EMA series (for chart rendering)
  const ema20Series  = emaSeriesArr(closes, 20);
  const ema50Series  = closes.length >= 50  ? emaSeriesArr(closes, 50)  : null;
  const ema200Series = closes.length >= 200 ? emaSeriesArr(closes, 200) : null;

  // ── Build the structured data object Claude will reason over ────────────────
  const pricePct = (v, ref) => ref ? `${price > ref ? '▲ ABOVE' : '▼ BELOW'} by ${Math.abs(((price/ref)-1)*100).toFixed(1)}%` : null;
  const fmtPct   = v => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : null;
  const fmtN     = (v, d=2) => v != null ? +v.toFixed(d) : null;

  const fundStatus = yfFetchedAny
    ? (Object.keys(fund).length > 2 ? 'Fetched from Yahoo Finance' : 'Yahoo Finance returned limited data')
    : 'Yahoo Finance unreachable — data from training knowledge only';

  const dataForClaude = {
    stock: {
      symbol: symbol.toUpperCase(),
      name,
      sector,
      sector_context: SECTOR_CONTEXT[sector] || SECTOR_CONTEXT.default,
    },
    price_action: {
      current_price:        fmtN(price),
      change_today_pct:     fmtN(changePct),
      week_52_high:         fmtN(high52w),
      week_52_low:          fmtN(low52w),
      week_52_position_pct: fmtN(((price - low52w) / (high52w - low52w)) * 100, 0),
      return_30d_pct:       fmtN(change30d),
    },
    moving_averages: {
      sma20:          fmtN(sma20),
      price_vs_sma20: pricePct(price, sma20),
      sma50:          sma50 ? fmtN(sma50) : null,
      price_vs_sma50: pricePct(price, sma50),
    },
    momentum: {
      rsi_14:      fmtN(rsi, 1),
      rsi_status:  rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : rsi < 45 ? 'weakening' : 'healthy',
      macd:        fmtN(macdVal),
      macd_signal: fmtN(macdSig),
      macd_bias:   macdVal > macdSig ? 'BULLISH crossover' : 'BEARISH crossover',
    },
    bollinger_bands: {
      upper:        fmtN(bbUpper),
      middle_sma20: fmtN(sma20),
      lower:        fmtN(bbLower),
      position_pct: fmtN(bbPct, 0),
      status:       bbPct < 20 ? 'near lower band — oversold zone' : bbPct > 80 ? 'near upper band — extended/caution' : 'mid-band — room to move',
    },
    volume: {
      volume_vs_20d_avg_pct: fmtN(volRatio * 100, 0),
      conviction:            volRatio > 1.5 ? 'HIGH — conviction move' : volRatio < 0.6 ? 'LOW — weak conviction' : 'average',
    },
    algo_score: {
      score:   techScoreNorm,
      out_of:  10,
      label:   techScore >= 6 ? 'Strong bullish' : techScore >= 2 ? 'Mild bullish' : techScore >= -2 ? 'Neutral/mixed' : techScore >= -6 ? 'Mild bearish' : 'Strong bearish',
    },
    fundamentals: {
      data_source:        fundStatus,
      pe:                 fund.pe             ?? null,
      forward_pe:         fund.forwardPE       ?? null,
      pb_ratio:           fund.pbRatio         ?? null,
      eps:                fund.eps             ?? null,
      roe_pct:            fund.roe             ?? null,
      roce_pct:           fund.roce            ?? null,
      operating_margin_pct: fund.operatingMargin ?? null,
      revenue_growth_pct: fund.revenueGrowth   ?? null,
      earnings_growth_pct:fund.earningsGrowth  ?? null,
      debt_to_equity:     fund.debtToEquity    ?? null,
      dividend_yield_pct: fund.dividendYield != null ? +(fund.dividendYield * 100).toFixed(2) : null,
      market_cap_cr:      fund.marketCapCr     ?? null,
      analyst_target:     fund.targetPrice     ?? null,
      analyst_count:      fund.analystCount    ?? null,
      analyst_consensus:  fund.recommendation  ?? null,
    },
  };

  return {
    dataForClaude,
    indicators: {
      price: +price.toFixed(2), changePct: +changePct.toFixed(2),
      sma20: +sma20.toFixed(2), sma50: sma50 ? +sma50.toFixed(2) : null,
      rsi: +rsi.toFixed(1), macd: +macdVal.toFixed(2), macdSignal: +macdSig.toFixed(2),
      bbUpper: +bbUpper.toFixed(2), bbLower: +bbLower.toFixed(2), bbPct: +bbPct.toFixed(1),
      change30d: change30d !== null ? +change30d.toFixed(2) : null,
      high52w: +high52w.toFixed(2), low52w: +low52w.toFixed(2),
      volRatio: +volRatio.toFixed(2), techScore: techScoreNorm, scores,
    },
    fund,
    ohlcv: rows,
    ema20Series, ema50Series, ema200Series,
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return reply(null, 204, cors);

  const p      = new URL(req.url).searchParams;
  const symbol = p.get('symbol');
  const name   = p.get('name')   || symbol;
  const sector = p.get('sector') || 'default';

  // ── priceOnly fast refresh ────────────────────────────────────────────────
  if (p.get('priceOnly') === '1') {
    const yahooSym = symbol.toUpperCase() + '.NS';
    try {
      const res = await fetchYF(`/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=5d`);
      if (!res) return reply({ error: 'price fetch failed' }, 500, cors);
      const d = await res.json();
      const m = d?.chart?.result?.[0]?.meta || {};
      const q = d?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
      const cls = (q.close || []).filter(Boolean);
      const price = cls.at(-1) || m.regularMarketPrice;
      const prev  = cls.at(-2) || m.chartPreviousClose;
      const changePct = prev ? ((price - prev) / prev) * 100 : 0;
      return reply({
        price: price ? +price.toFixed(2) : null,
        changePct: +changePct.toFixed(2),
        high52: m.fiftyTwoWeekHigh || null,
        low52:  m.fiftyTwoWeekLow  || null,
      }, 200, cors);
    } catch (e) {
      return reply({ error: e.message }, 500, cors);
    }
  }

  if (!symbol) return reply({ error: 'symbol is required' }, 400, cors);
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500, cors);

  let fund = {};
  try { fund = JSON.parse(p.get('fund') || '{}'); } catch (_) {}

  try {
    // ── Step 1: Deterministic data pipeline ───────────────────────────────────
    // Backend always fetches and computes. Claude never decides what to fetch.
    const stockData = await executeGetStockData(symbol, fund, sector, name);
    fund = stockData.fund;

    // ── Step 2: Claude reasons over the assembled stock_context JSON ──────────
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system:     SYSTEM_PROMPT,
        messages: [{
          role:    'user',
          content: `Analyse the following stock and return your analysis as JSON:\n\n${JSON.stringify(stockData.dataForClaude)}`,
        }],
      }),
      signal: AbortSignal.timeout(28000),
    });

    if (!claudeRes.ok) throw new Error('Claude: ' + (await claudeRes.text()).slice(0, 200));

    // ── Step 3: Parse and enrich ──────────────────────────────────────────────
    const cd  = await claudeRes.json();
    const raw = cd.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const finalAnalysis = JSON.parse(raw);

    if (finalAnalysis.knownFundamentals) {
      const cf = finalAnalysis.knownFundamentals;
      Object.keys(cf).forEach(k => { if (cf[k] != null && fund[k] == null) fund[k] = cf[k]; });
      delete finalAnalysis.knownFundamentals;
    }

    return reply({
      symbol: symbol.toUpperCase(), name,
      indicators:   stockData.indicators,
      analysis:     finalAnalysis,
      fundamentals: fund,
      ohlcv:        stockData.ohlcv,
      ema20Series:  stockData.ema20Series,
      ema50Series:  stockData.ema50Series,
      ema200Series: stockData.ema200Series,
      fetchedAt:    new Date().toISOString(),
    }, 200, cors);

  } catch (e) {
    return reply({ error: e.message }, 500, cors);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
const reply = (data, status, headers) =>
  new Response(data ? JSON.stringify(data) : '', {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

function pruneNulls(obj) { Object.keys(obj).forEach(k => { if (obj[k] == null) delete obj[k]; }); }
function avg(a) { const v = a.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((s,x)=>s+x,0)/v.length : 0; }
function ema(c, p) { if (!c.length || p > c.length) return avg(c); const k=2/(p+1); let e=avg(c.slice(0,p)); for(let i=p;i<c.length;i++) e=c[i]*k+e*(1-k); return e; }
function calcRSI(c, p=14) {
  if (c.length < p+1) return 50;
  let g=0, l=0;
  for (let i=c.length-p; i<c.length; i++) { const d=c[i]-c[i-1]; if(d>0) g+=d; else l-=d; }
  return 100-100/(1+(g/p)/((l/p)||0.001));
}
function emaSeriesArr(c, p) {
  const k = 2/(p+1), res = new Array(c.length).fill(null);
  if (c.length < p) return res;
  res[p-1] = avg(c.slice(0, p));
  for (let i = p; i < c.length; i++) res[i] = c[i]*k + res[i-1]*(1-k);
  return res;
}