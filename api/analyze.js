export const config = { runtime: 'edge' };

const YF_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

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
  default:        'Indian equity — earnings growth, valuation vs peers, technical momentum.'
};

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

  // fundamentals passed from frontend (quarterlyResults stripped client-side to keep URL short)
  let fund = {};
  try { fund = JSON.parse(p.get('fund') || '{}'); } catch (_) {}

  if (!symbol) return reply({ error: 'symbol is required' }, 400, cors);

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500, cors);

  try {
    const yahooSym = symbol.toUpperCase() + '.NS';
    const today    = new Date();
    const oneYrAgo = new Date(today); oneYrAgo.setFullYear(today.getFullYear() - 1);

    // ── 1. Fetch 1yr daily OHLCV ──────────────────────────────────────────
    const chartRes = await fetch(
      `${YF_CHART}/${encodeURIComponent(yahooSym)}?interval=1d&period1=${Math.floor(oneYrAgo/1000)}&period2=${Math.floor(today/1000)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (!chartRes.ok) throw new Error(`Yahoo Finance: HTTP ${chartRes.status}`);

    const chartData = await chartRes.json();
    const result    = chartData?.chart?.result?.[0];
    if (!result) throw new Error(chartData?.chart?.error?.description || `No chart data for ${symbol}`);

    const q0   = result.indicators?.quote?.[0] || {};
    // Full OHLCV rows — t in ms for Chart.js timeseries scale
    const rows = (result.timestamp || [])
      .map((ts, i) => ({
        t: ts * 1000,
        o: q0.open?.[i],
        h: q0.high?.[i],
        l: q0.low?.[i],
        c: q0.close?.[i],
        v: q0.volume?.[i] ?? 0,
      }))
      .filter(r => r.c != null && r.o != null && r.h != null && r.l != null);

    const closes  = rows.map(r => r.c);
    const volumes = rows.map(r => r.v);

    if (closes.length < 20) throw new Error(`Only ${closes.length} data points — need 20+`);

    // ── 1b. Fetch fundamentals from Yahoo Finance quoteSummary ────────────
    // Best-effort — if it fails, analysis continues with whatever fund was passed in
    let yfFund = {};
    try {
      const sumRes = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSym)}?modules=summaryDetail,financialData,defaultKeyStatistics`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
      );
      if (sumRes.ok) {
        const sumData = await sumRes.json();
        const sr = sumData?.quoteSummary?.result?.[0];
        if (sr) {
          const sd = sr.summaryDetail        || {};
          const fd = sr.financialData        || {};
          const ks = sr.defaultKeyStatistics || {};
          const rv = v => (v && v.raw != null) ? v.raw : null;
          const pc = v => rv(v) != null ? +(rv(v) * 100).toFixed(2) : null;
          yfFund = {
            marketCapCr:     rv(sd.marketCap)              != null ? +(rv(sd.marketCap) / 1e7).toFixed(0) : null,
            pe:              rv(sd.trailingPE)             != null ? +rv(sd.trailingPE).toFixed(2)        : null,
            forwardPE:       rv(sd.forwardPE)              != null ? +rv(sd.forwardPE).toFixed(2)         : null,
            dividendYield:   rv(sd.dividendYield),
            dividendRate:    rv(sd.dividendRate),
            eps:             rv(ks.trailingEps)            != null ? +rv(ks.trailingEps).toFixed(2)       : null,
            pbRatio:         rv(ks.priceToBook)            != null ? +rv(ks.priceToBook).toFixed(2)       : null,
            bookValue:       rv(ks.bookValue)              != null ? +rv(ks.bookValue).toFixed(2)         : null,
            roe:             pc(fd.returnOnEquity),
            operatingMargin: pc(fd.operatingMargins),
            debtToEquity:    rv(fd.debtToEquity)           != null ? +rv(fd.debtToEquity).toFixed(2)      : null,
            revenueGrowth:   pc(fd.revenueGrowth),
            earningsGrowth:  pc(fd.earningsGrowth),
            targetPrice:     rv(fd.targetMeanPrice)        != null ? +rv(fd.targetMeanPrice).toFixed(2)   : null,
            analystCount:    rv(fd.numberOfAnalystOpinions),
            recommendation:  fd.recommendationKey || null,
          };
          // Strip null/undefined keys
          Object.keys(yfFund).forEach(k => { if (yfFund[k] == null) delete yfFund[k]; });
        }
      }
    } catch (_) { /* quoteSummary is best-effort */ }

    // Merge: manually-passed fund (from fundamentals.json) overrides Yahoo Finance where set
    fund = { ...yfFund, ...fund };

    // ── 2. Technical indicators ───────────────────────────────────────────
    const price      = closes.at(-1);
    const changePct  = ((price - closes.at(-2)) / closes.at(-2)) * 100;
    const sma20      = avg(closes.slice(-20));
    const sma50      = closes.length >= 50 ? avg(closes.slice(-50)) : null;
    const macd       = ema(closes, 12) - ema(closes, 26);
    const macdSignal = ema(closes.slice(-35).map((_, i, a) => {
      if (i < 12) return null;
      return ema(a.slice(0, i+1), 12) - ema(a.slice(0, i+1), 26);
    }).filter(x => x !== null), 9);
    const rsi       = calcRSI(closes);
    const high52w   = Math.max(...closes);
    const low52w    = Math.min(...closes);
    const change30d = closes.length >= 30
      ? ((closes.at(-1) - closes.at(-30)) / closes.at(-30)) * 100 : null;
    const avgVol20  = avg(volumes.slice(-20));
    const volRatio  = avgVol20 > 0 ? (volumes.at(-1) || avgVol20) / avgVol20 : 1;
    const stddev20  = Math.sqrt(avg(closes.slice(-20).map(c => Math.pow(c - sma20, 2))));
    const bbUpper   = sma20 + 2 * stddev20;
    const bbLower   = sma20 - 2 * stddev20;
    const bbPct     = stddev20 > 0 ? ((price - bbLower) / (bbUpper - bbLower)) * 100 : 50;

    // ── 3. Signal score ───────────────────────────────────────────────────
    const scores = {
      trend:    price > sma20 && (!sma50 || price > sma50) ? 2 : price > sma20 ? 1 : sma50 && price > sma50 ? -1 : -2,
      momentum: rsi > 55 && rsi < 70 ? 2 : rsi > 70 ? -1 : rsi < 35 ? 2 : rsi < 45 ? -1 : 0,
      macdSig:  macd > 0 && macd > macdSignal ? 2 : macd > 0 ? 1 : macd < 0 && macd < macdSignal ? -2 : -1,
      range52w: price > high52w * 0.9 ? 2 : price > high52w * 0.7 ? 1 : price > high52w * 0.5 ? 0 : -1,
      volume:   volRatio > 1.5 && changePct > 0 ? 2 : volRatio > 1.5 && changePct < 0 ? -2 : volRatio < 0.6 ? -1 : 0,
      bbPos:    bbPct < 20 ? 2 : bbPct > 80 ? -1 : bbPct > 50 ? 1 : 0,
      return30d: change30d != null ? (change30d > 10 ? 2 : change30d > 0 ? 1 : change30d > -10 ? -1 : -2) : 0,
    };
    const techScore     = Object.values(scores).reduce((a, b) => a + b, 0);
    const techScoreNorm = +((techScore + 14) / 28 * 10).toFixed(1);

    // ── 4. EMA series for chart overlays ─────────────────────────────────
    const ema20Series  = emaSeriesArr(closes, 20);
    const ema50Series  = closes.length >= 50  ? emaSeriesArr(closes, 50)  : null;
    const ema200Series = closes.length >= 200 ? emaSeriesArr(closes, 200) : null;

    // ── 5. Claude prompt ──────────────────────────────────────────────────
    const smaLine = (v, l) => v != null
      ? `- ${l}: ₹${v.toFixed(2)} (${price > v ? '▲ ABOVE' : '▼ BELOW'} by ${Math.abs(((price/v)-1)*100).toFixed(1)}%)`
      : '';

    const fundLines = [
      fund.pe             != null ? `- P/E: ${fund.pe}x${fund.forwardPE ? ` | Fwd P/E: ${fund.forwardPE}x` : ''}` : '',
      fund.roe            != null ? `- ROE: ${fund.roe}% | ROCE: ${fund.roce ?? 'N/A'}%` : '',
      fund.revenueGrowth  != null ? `- Revenue Growth: +${fund.revenueGrowth}% YoY | Earnings Growth: ${fund.earningsGrowth != null ? '+'+fund.earningsGrowth+'%' : 'N/A'}` : '',
      fund.operatingMargin!= null ? `- Operating Margin: ${fund.operatingMargin}%` : '',
      fund.debtToEquity   != null ? `- D/E: ${fund.debtToEquity}x` : '',
      fund.targetPrice    != null ? `- Analyst Target: ₹${fund.targetPrice} (${fund.analystCount ?? '?'} analysts, consensus: ${(fund.recommendation||'').toUpperCase()})` : '',
    ].filter(Boolean).join('\n');

    const prompt = `You are a senior equity analyst covering Indian markets.
Sector expertise: ${SECTOR_CONTEXT[sector] || SECTOR_CONTEXT.default}

Analyse ${name} (NSE: ${symbol}) — signal must reflect CONFLUENCE of multiple factors.

━━━ TECHNICAL DATA ━━━
- Price: ₹${price.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% today)
${smaLine(sma20, '20-day SMA')}
${smaLine(sma50, '50-day SMA')}
- RSI(14): ${rsi.toFixed(1)} — ${rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : rsi < 45 ? 'weakening' : 'healthy'}
- MACD: ${macd.toFixed(2)} vs Signal ${macdSignal.toFixed(2)} → ${macd > macdSignal ? 'BULLISH' : 'BEARISH'} crossover
- BB position: ${bbPct.toFixed(0)}% — ${bbPct < 20 ? 'near lower band' : bbPct > 80 ? 'near upper band (extended)' : 'mid-band'}
- 30d return: ${change30d !== null ? (change30d >= 0 ? '+' : '') + change30d.toFixed(2) + '%' : 'N/A'}
- 52w range: ₹${low52w.toFixed(2)} – ₹${high52w.toFixed(2)} | at ${(((price-low52w)/(high52w-low52w))*100).toFixed(0)}% of range
- Volume vs 20d avg: ${(volRatio*100).toFixed(0)}%${volRatio > 1.5 ? ' (HIGH conviction)' : volRatio < 0.6 ? ' (LOW conviction)' : ''}

━━━ SIGNAL SCORE: ${techScoreNorm}/10 ━━━
→ ${techScore >= 6 ? 'Strong bullish' : techScore >= 2 ? 'Mild bullish' : techScore >= -2 ? 'Neutral/mixed' : techScore >= -6 ? 'Mild bearish' : 'Strong bearish'}

━━━ FUNDAMENTALS (from company filings) ━━━
${fundLines || '(not available in database yet)'}

Reply ONLY with valid JSON, no markdown:
{"signal":"BUY_MORE"|"HOLD"|"REVIEW","confidence":"HIGH"|"MEDIUM"|"LOW","summary":"2-3 sentences referencing score, key technicals and fundamentals","technicalPoints":["point 1","point 2","point 3"],"support":"₹XXX — reason","resistance":"₹XXX — reason","outlook":"2-4 week outlook with specific trigger","keyRisk":"biggest risk to this view"}`;

    // ── 6. Call Claude ─────────────────────────────────────────────────────
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(20000)
    });

    if (!claudeRes.ok) return reply({ error: 'Claude: ' + (await claudeRes.text()).slice(0, 200) }, 500, cors);

    const cd       = await claudeRes.json();
    const raw      = cd.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const analysis = JSON.parse(raw);

    return reply({
      symbol: symbol.toUpperCase(), name,
      indicators: {
        price: +price.toFixed(2), changePct: +changePct.toFixed(2),
        sma20: +sma20.toFixed(2), sma50: sma50 ? +sma50.toFixed(2) : null,
        rsi: +rsi.toFixed(1), macd: +macd.toFixed(2), macdSignal: +macdSignal.toFixed(2),
        bbUpper: +bbUpper.toFixed(2), bbLower: +bbLower.toFixed(2), bbPct: +bbPct.toFixed(1),
        change30d: change30d !== null ? +change30d.toFixed(2) : null,
        high52w: +high52w.toFixed(2), low52w: +low52w.toFixed(2),
        volRatio: +volRatio.toFixed(2), techScore: techScoreNorm, scores,
      },
      analysis,
      fundamentals: fund,   // merged Yahoo Finance + manual data
      ohlcv: rows,
      ema20Series,
      ema50Series,
      ema200Series,
      fetchedAt: new Date().toISOString()
    }, 200, cors);

  } catch (e) {
    return reply({ error: e.message }, 500, cors);
  }
}

const reply = (data, status, headers) =>
  new Response(data ? JSON.stringify(data) : '', {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...headers }
  });

function avg(a) { const v = a.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((s,x)=>s+x,0)/v.length : 0; }
function ema(c, p) { if (!c.length || p > c.length) return avg(c); const k=2/(p+1); let e=avg(c.slice(0,p)); for(let i=p;i<c.length;i++) e=c[i]*k+e*(1-k); return e; }
function calcRSI(c, p=14) {
  if (c.length < p+1) return 50;
  let g=0, l=0;
  for (let i=c.length-p; i<c.length; i++) { const d=c[i]-c[i-1]; if(d>0) g+=d; else l-=d; }
  return 100-100/(1+(g/p)/((l/p)||0.001));
}
// Returns full EMA series aligned with closes array; values before period are null
function emaSeriesArr(c, p) {
  const k = 2/(p+1), res = new Array(c.length).fill(null);
  if (c.length < p) return res;
  res[p-1] = avg(c.slice(0, p));
  for (let i = p; i < c.length; i++) res[i] = c[i]*k + res[i-1]*(1-k);
  return res;
}