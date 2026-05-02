export const config = { runtime: 'edge' };

const YF_CHART   = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YF_SUMMARY = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';

const SECTOR_CONTEXT = {
  railways:       'Indian railways/capital goods — key drivers: order book execution, EBITDA margin expansion, government capex cycle. Valuation anchor: P/E vs order book visibility.',
  banking:        'Indian private/PSU banking — key drivers: NIM trajectory, GNPA trend, loan growth, ROE vs cost of equity. Watch: credit costs and CASA ratio.',
  it:             'Indian IT services — key drivers: revenue growth (CC terms), EBIT margin, deal TCV wins, attrition normalisation. Valuation: P/E vs growth premium.',
  fmcg:           'Indian FMCG — key drivers: volume growth vs price growth mix, rural recovery, gross margin trajectory. Valuation: premium P/E justified by consistency.',
  pharma:         'Indian pharma — key drivers: US generics momentum, domestic formulations growth, R&D pipeline, USFDA compliance. Watch: price erosion in US.',
  capital_markets:'Indian capital markets — key drivers: AUM growth, active client additions, market share in F&O. Highly correlated with market volumes and sentiment.',
  real_estate:    'Indian real estate — key drivers: pre-sales momentum, collections, net debt trajectory, land bank. Valuation: NAV discount/premium.',
  auto:           'Indian automobiles — key drivers: volume growth, EV transition pace, EBITDA margin, market share. Watch: commodity costs and rural demand.',
  metals:         'Indian metals/mining — key drivers: spread per tonne, net debt/EBITDA, production volume. Highly cyclical — commodity price and China demand.',
  energy:         'Indian energy/oil — key drivers: dividend yield, refining margins, upstream realisation, net debt. Regulatory risk: APM pricing.',
  default:        'Indian equity — focus on earnings growth trajectory, valuation vs sector peers, and technical momentum confluence.'
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

  if (!symbol) return reply({ error: 'symbol is required' }, 400, cors);

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set in Vercel env vars' }, 500, cors);

  try {
    const yahooSym = symbol.toUpperCase() + '.NS';
    const today    = new Date();
    const oneYrAgo = new Date(today); oneYrAgo.setFullYear(today.getFullYear() - 1);
    const period1  = Math.floor(oneYrAgo / 1000);
    const period2  = Math.floor(today / 1000);

    // ── 1. Parallel fetch: chart + full fundamentals ───────────────────────
    const [chartRes, summaryRes] = await Promise.all([
      fetch(
        `${YF_CHART}/${encodeURIComponent(yahooSym)}?interval=1d&period1=${period1}&period2=${period2}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
      ),
      fetch(
        `${YF_SUMMARY}/${encodeURIComponent(yahooSym)}?modules=defaultKeyStatistics,financialData,summaryDetail,assetProfile`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
      )
    ]);

    if (!chartRes.ok) throw new Error(`Yahoo Finance chart: HTTP ${chartRes.status}`);
    const chartData = await chartRes.json();
    const result    = chartData?.chart?.result?.[0];
    if (!result) throw new Error(chartData?.chart?.error?.description || `No chart data for ${symbol}`);

    const timestamps = result.timestamp || [];
    const q0         = result.indicators?.quote?.[0] || {};
    const rows       = timestamps
      .map((ts, i) => ({ close: q0.close?.[i], volume: q0.volume?.[i] ?? 0 }))
      .filter(r => r.close != null);
    const closes  = rows.map(r => r.close);
    const volumes = rows.map(r => r.volume);

    if (closes.length < 20) throw new Error(`Only ${closes.length} data points for ${symbol} — need 20+`);

    // ── 2. Parse fundamentals ─────────────────────────────────────────────
    let fund = {};
    try {
      if (summaryRes.ok) {
        const sj  = await summaryRes.json();
        const res = sj?.quoteSummary?.result?.[0] || {};
        const ks  = res.defaultKeyStatistics || {};
        const fd  = res.financialData        || {};
        const sd  = res.summaryDetail        || {};

        const mcapRaw = sd.marketCap?.raw ?? null;
        const price   = closes.at(-1);
        const pb      = ks.priceToBook?.raw ?? null;

        fund = {
          // Valuation
          pe:              sd.trailingPE?.raw           ?? null,
          forwardPE:       sd.forwardPE?.raw            ?? null,
          pbRatio:         pb,
          bookValue:       pb && price ? +(price / pb).toFixed(2) : null,
          eps:             ks.trailingEps?.raw           ?? null,
          evEbitda:        ks.enterpriseToEbitda?.raw    ?? null,
          // Quality
          roe:             fd.returnOnEquity?.raw        ?? null,
          roce:            fd.returnOnAssets?.raw        ?? null,   // proxy; YF doesn't expose ROCE directly
          operatingMargin: fd.operatingMargins?.raw      ?? null,
          grossMargin:     fd.grossMargins?.raw          ?? null,
          // Growth
          revenueGrowth:   fd.revenueGrowth?.raw         ?? null,
          earningsGrowth:  fd.earningsGrowth?.raw        ?? null,
          // Health
          debtToEquity:    fd.debtToEquity?.raw          ?? null,
          currentRatio:    fd.currentRatio?.raw          ?? null,
          // Income
          dividendYield:   sd.dividendYield?.raw         ?? null,
          dividendRate:    sd.dividendRate?.raw           ?? null,
          // Size
          marketCap:       mcapRaw,
          marketCapCr:     mcapRaw ? +(mcapRaw / 1e7).toFixed(0) : null,
          // Analyst
          targetPrice:     fd.targetMeanPrice?.raw       ?? null,
          targetHigh:      fd.targetHighPrice?.raw       ?? null,
          targetLow:       fd.targetLowPrice?.raw        ?? null,
          analystCount:    fd.numberOfAnalystOpinions?.raw ?? null,
          recommendation:  fd.recommendationKey          ?? null,
        };
      }
    } catch (_) { /* fundamentals optional */ }

    // ── 3. Technical indicators ───────────────────────────────────────────
    const price      = closes.at(-1);
    const prev       = closes.at(-2);
    const changePct  = ((price - prev) / prev) * 100;
    const sma20      = avg(closes.slice(-20));
    const sma50      = closes.length >= 50 ? avg(closes.slice(-50)) : null;
    const macd       = ema(closes, 12) - ema(closes, 26);
    const macdSignal = ema(closes.slice(-35).map((_, i, a) => {
      if (i < 12) return null;
      return ema(a.slice(0, i+1), 12) - ema(a.slice(0, i+1), 26);
    }).filter(x => x !== null), 9);
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

    // ── 4. Signal score ───────────────────────────────────────────────────
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
    const techScoreNorm = ((techScore + 14) / 28 * 10).toFixed(1);

    // ── 5. Claude prompt ──────────────────────────────────────────────────
    const smaLine    = (v, l) => v != null ? `- ${l}: ₹${v.toFixed(2)} (${price > v ? '▲ ABOVE' : '▼ BELOW'} by ${Math.abs(((price/v)-1)*100).toFixed(1)}%)` : '';
    const scoreLines = Object.entries(scores).map(([k, v]) => `  ${k.padEnd(10)}: ${v > 0 ? '+' : ''}${v}`).join('\n');
    const fundLines  = [
      fund.pe             != null ? `- Trailing P/E: ${fund.pe.toFixed(1)}x${fund.forwardPE ? ` | Forward P/E: ${fund.forwardPE.toFixed(1)}x` : ''}` : '',
      fund.pbRatio        != null ? `- Price/Book: ${fund.pbRatio.toFixed(2)}x` : '',
      fund.roe            != null ? `- ROE: ${(fund.roe * 100).toFixed(1)}%` : '',
      fund.revenueGrowth  != null ? `- Revenue Growth (YoY): ${(fund.revenueGrowth * 100).toFixed(1)}%` : '',
      fund.earningsGrowth != null ? `- Earnings Growth (YoY): ${(fund.earningsGrowth * 100).toFixed(1)}%` : '',
      fund.operatingMargin!= null ? `- Operating Margin: ${(fund.operatingMargin * 100).toFixed(1)}%` : '',
      fund.debtToEquity   != null ? `- Debt/Equity: ${fund.debtToEquity.toFixed(2)}x` : '',
      fund.dividendYield  != null ? `- Dividend Yield: ${(fund.dividendYield * 100).toFixed(2)}%` : '',
      fund.targetPrice    != null ? `- Analyst Target: ₹${fund.targetPrice.toFixed(0)}${fund.analystCount ? ` (${fund.analystCount} analysts, consensus: ${fund.recommendation?.toUpperCase()})` : ''}` : '',
    ].filter(Boolean).join('\n');

    const prompt = `You are a senior equity analyst covering Indian markets with deep expertise in ${SECTOR_CONTEXT[sector] || SECTOR_CONTEXT.default}

Analyse ${name} (NSE: ${symbol}) using the data below. Signal must be based on CONFLUENCE — multiple confirming factors.

━━━ TECHNICAL DATA ━━━
- Price: ₹${price.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% today)
${smaLine(sma20, '20-day SMA')}
${smaLine(sma50, '50-day SMA')}
- RSI(14): ${rsi.toFixed(1)} — ${rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : rsi < 45 ? 'weakening' : 'healthy'}
- MACD: ${macd.toFixed(2)} vs Signal ${macdSignal.toFixed(2)} → ${macd > macdSignal ? 'BULLISH crossover' : 'BEARISH crossover'}
- BB position: ${bbPct.toFixed(0)}% — ${bbPct < 20 ? 'near lower band (oversold)' : bbPct > 80 ? 'near upper band (extended)' : 'mid-band'}
- 30d return: ${change30d !== null ? (change30d >= 0 ? '+' : '') + change30d.toFixed(2) + '%' : 'N/A'}
- 52w range: ₹${low52w.toFixed(2)} – ₹${high52w.toFixed(2)} | at ${(((price-low52w)/(high52w-low52w))*100).toFixed(0)}% of range
- Volume vs 20d avg: ${(volRatio*100).toFixed(0)}%${volRatio > 1.5 ? ' (HIGH conviction)' : volRatio < 0.6 ? ' (LOW conviction)' : ''}

━━━ SIGNAL SCORE: ${techScoreNorm}/10 ━━━
${scoreLines}
→ ${techScore >= 6 ? 'Strong bullish confluence' : techScore >= 2 ? 'Mild bullish bias' : techScore >= -2 ? 'Neutral/mixed' : techScore >= -6 ? 'Mild bearish' : 'Strong bearish'}

━━━ FUNDAMENTALS ━━━
${fundLines || '(unavailable — base signal on technicals only)'}

━━━ SECTOR CONTEXT ━━━
${SECTOR_CONTEXT[sector] || SECTOR_CONTEXT.default}

Reply ONLY with valid JSON, no markdown:
{"signal":"BUY_MORE"|"HOLD"|"REVIEW","confidence":"HIGH"|"MEDIUM"|"LOW","summary":"2-3 sentences: technical score + key fundamental + sector context","technicalPoints":["signal 1","signal 2","signal 3"],"support":"₹XXX — reason","resistance":"₹XXX — reason","outlook":"2-4 week outlook with specific trigger to watch","keyRisk":"single biggest risk to this view"}`;

    // ── 6. Claude ─────────────────────────────────────────────────────────
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
        volRatio: +volRatio.toFixed(2), techScore: +techScoreNorm, scores,
      },
      fundamentals: fund,
      analysis,
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