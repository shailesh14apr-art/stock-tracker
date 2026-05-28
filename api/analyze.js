export const config = { runtime: 'edge' };

const YF_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Browser-like headers — Yahoo Finance blocks bare Node/fetch user agents
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

// Race query1 and query2 in parallel — whichever responds first wins
async function fetchYF(path, timeout = 4000) {
  try {
    const results = await Promise.allSettled([
      fetch(`https://query1.finance.yahoo.com${path}`, { headers: YF_HEADERS, signal: AbortSignal.timeout(timeout) }),
      fetch(`https://query2.finance.yahoo.com${path}`, { headers: YF_HEADERS, signal: AbortSignal.timeout(timeout) }),
    ]);
    const winner = results.find(r => r.status === 'fulfilled' && r.value.ok);
    return winner ? winner.value : null;
  } catch (_) {
    return null;
  }
}

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

  // priceOnly mode — fast price refresh without full analysis
  if (p.get('priceOnly') === '1') {
    const yahooSym = symbol.toUpperCase() + '.NS';
    try {
      const res = await fetchYF(`/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=5d`);
      if (!res) return reply({ error: 'price fetch failed' }, 500, cors);
      const d = await res.json();
      const m = d?.chart?.result?.[0]?.meta || {};
      const q = d?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
      const closes = (q.close || []).filter(Boolean);
      const price = closes.at(-1) || m.regularMarketPrice;
      const prev  = closes.at(-2) || m.chartPreviousClose;
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

  let fund = {};
  try { fund = JSON.parse(p.get('fund') || '{}'); } catch (_) {}

  if (!symbol) return reply({ error: 'symbol is required' }, 400, cors);
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500, cors);

  try {
    const yahooSym = symbol.toUpperCase() + '.NS';
    const today    = new Date();
    const oneYrAgo = new Date(today); oneYrAgo.setFullYear(today.getFullYear() - 1);

    // ── 1. OHLCV (1yr daily) ─────────────────────────────────────────────────
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

    // ── 2. Fundamentals: two passes in parallel ──────────────────────────────
    let yfFund = {};
    let yfFetchedAny = false;

    const [_r7, _rQS] = await Promise.all([
      fetchYF(`/v7/finance/quote?symbols=${encodeURIComponent(yahooSym)}`).catch(() => null),
      fetchYF(`/v10/finance/quoteSummary/${encodeURIComponent(yahooSym)}?modules=financialData,defaultKeyStatistics,summaryDetail`).catch(() => null),
    ]);

    // 2a. v7/finance/quote — market cap, P/E, EPS, dividends
    try {
      const r = _r7;
      if (r) {
        const q7 = (await r.json())?.quoteResponse?.result?.[0] || {};
        if (q7.symbol) {
          yfFetchedAny = true;
          yfFund = {
            marketCapCr:   q7.marketCap                  ? +(q7.marketCap / 1e7).toFixed(0)      : null,
            pe:            q7.trailingPE                  ? +q7.trailingPE.toFixed(2)              : null,
            forwardPE:     q7.forwardPE                   ? +q7.forwardPE.toFixed(2)               : null,
            eps:           q7.epsTrailingTwelveMonths     ? +q7.epsTrailingTwelveMonths.toFixed(2) : null,
            pbRatio:       q7.priceToBook                 ? +q7.priceToBook.toFixed(2)             : null,
            bookValue:     q7.bookValue                   ? +q7.bookValue.toFixed(2)               : null,
            dividendYield: q7.dividendYield               || null,
            dividendRate:  q7.trailingAnnualDividendRate  || null,
          };
          pruneNulls(yfFund);
        }
      }
    } catch (_) {}

    // 2b. v10/quoteSummary — ROE, margins, D/E, growth, analyst targets
    try {
      const r = _rQS;
      if (r) {
        const sr = (await r.json())?.quoteSummary?.result?.[0];
        if (sr) {
          yfFetchedAny = true;
          const fd = sr.financialData        || {};
          const ks = sr.defaultKeyStatistics || {};
          const sd = sr.summaryDetail        || {};
          const rv  = v => (v && v.raw != null) ? v.raw : null;
          const pct = v => rv(v) != null ? +(rv(v) * 100).toFixed(2) : null;
          const fix = v => rv(v) != null ? +rv(v).toFixed(2) : null;
          const qsExtra = {
            roe:             pct(fd.returnOnEquity),
            operatingMargin: pct(fd.operatingMargins),
            debtToEquity:    fix(fd.debtToEquity),
            revenueGrowth:   pct(fd.revenueGrowth),
            earningsGrowth:  pct(fd.earningsGrowth),
            targetPrice:     fix(fd.targetMeanPrice),
            analystCount:    rv(fd.numberOfAnalystOpinions),
            recommendation:  fd.recommendationKey || null,
            pe:              fix(sd.trailingPE),
            forwardPE:       fix(sd.forwardPE),
            marketCapCr:     rv(sd.marketCap) != null ? +(rv(sd.marketCap)/1e7).toFixed(0) : null,
            eps:             fix(ks.trailingEps),
            pbRatio:         fix(ks.priceToBook),
          };
          pruneNulls(qsExtra);
          yfFund = { ...yfFund, ...qsExtra };
        }
      }
    } catch (_) {}

    // 2c. 52w range from chart meta (always available)
    if (meta.fiftyTwoWeekHigh) yfFund.high52w = meta.fiftyTwoWeekHigh;
    if (meta.fiftyTwoWeekLow)  yfFund.low52w  = meta.fiftyTwoWeekLow;

    // Manual fundamentals.json wins over Yahoo Finance
    fund = { ...yfFund, ...fund };

    // ── 3. Technical indicators ──────────────────────────────────────────────
    const price      = closes.at(-1);
    const changePct  = ((price - closes.at(-2)) / closes.at(-2)) * 100;
    const sma20      = avg(closes.slice(-20));
    const sma50      = closes.length >= 50 ? avg(closes.slice(-50)) : null;
    const macd       = ema(closes, 12) - ema(closes, 26);
    const macdSignal = ema(
      closes.slice(-35).map((_, i, a) => {
        if (i < 12) return null;
        return ema(a.slice(0, i+1), 12) - ema(a.slice(0, i+1), 26);
      }).filter(x => x !== null), 9
    );
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

    // ── 4. Signal score ──────────────────────────────────────────────────────
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

    // ── 5. EMA series ────────────────────────────────────────────────────────
    const ema20Series  = emaSeriesArr(closes, 20);
    const ema50Series  = closes.length >= 50  ? emaSeriesArr(closes, 50)  : null;
    const ema200Series = closes.length >= 200 ? emaSeriesArr(closes, 200) : null;

    // ── 6. Claude prompt ─────────────────────────────────────────────────────
    const smaLine = (v, l) => v != null
      ? `- ${l}: ₹${v.toFixed(2)} (${price > v ? '▲ ABOVE' : '▼ BELOW'} by ${Math.abs(((price/v)-1)*100).toFixed(1)}%)`
      : '';

    const knownFundLines = [
      fund.pe             != null ? `- P/E: ${fund.pe}x${fund.forwardPE ? ` | Fwd P/E: ${fund.forwardPE}x` : ''}` : '',
      fund.roe            != null ? `- ROE: ${fund.roe}%` + (fund.roce != null ? ` | ROCE: ${fund.roce}%` : '') : '',
      fund.revenueGrowth  != null ? `- Revenue Growth: +${fund.revenueGrowth}% YoY` + (fund.earningsGrowth != null ? ` | Earnings Growth: +${fund.earningsGrowth}%` : '') : '',
      fund.operatingMargin!= null ? `- Operating Margin: ${fund.operatingMargin}%` : '',
      fund.debtToEquity   != null ? `- D/E: ${fund.debtToEquity}x` : '',
      fund.targetPrice    != null ? `- Analyst Target: ₹${fund.targetPrice} (${fund.analystCount ?? '?'} analysts, consensus: ${(fund.recommendation||'').toUpperCase()})` : '',
    ].filter(Boolean).join('\n');

    const fundDataStatus = yfFetchedAny
      ? (knownFundLines
          ? `Fetched from Yahoo Finance:\n${knownFundLines}\nFill remaining null fields in knownFundamentals from your training data.`
          : `Yahoo Finance returned no fundamental data for ${symbol}. Fill ALL knownFundamentals fields from your training data.`)
      : `Yahoo Finance was unreachable. Fill ALL knownFundamentals fields from your training knowledge of ${name} (${symbol}). This is a well-known Indian company — provide realistic estimates based on its most recent financial year. Do NOT leave fields null unless truly not applicable.`;

    const prompt = `You are a senior equity analyst covering Indian markets.
Sector expertise: ${SECTOR_CONTEXT[sector] || SECTOR_CONTEXT.default}

Analyse ${name} (NSE: ${symbol}).

━━━ TECHNICAL DATA ━━━
- Price: ₹${price.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% today)
${smaLine(sma20, '20-day SMA')}
${smaLine(sma50, '50-day SMA')}
- RSI(14): ${rsi.toFixed(1)} — ${rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : rsi < 45 ? 'weakening' : 'healthy'}
- MACD: ${macd.toFixed(2)} vs Signal ${macdSignal.toFixed(2)} → ${macd > macdSignal ? 'BULLISH' : 'BEARISH'} crossover
- Bollinger Band position: ${bbPct.toFixed(0)}% (Upper ₹${bbUpper.toFixed(2)} | Lower ₹${bbLower.toFixed(2)}) — ${bbPct < 20 ? 'near lower band (oversold zone)' : bbPct > 80 ? 'near upper band (extended/caution)' : 'mid-band (room to run)'}
- 30d return: ${change30d !== null ? (change30d >= 0 ? '+' : '') + change30d.toFixed(2) + '%' : 'N/A'}
- 52w range: ₹${low52w.toFixed(2)} – ₹${high52w.toFixed(2)} | at ${(((price-low52w)/(high52w-low52w))*100).toFixed(0)}% of range
- Volume vs 20d avg: ${(volRatio*100).toFixed(0)}%${volRatio > 1.5 ? ' (HIGH — conviction move)' : volRatio < 0.6 ? ' (LOW — weak conviction)' : ' (average)'}

━━━ SIGNAL SCORE: ${techScoreNorm}/10 ━━━
→ ${techScore >= 6 ? 'Strong bullish' : techScore >= 2 ? 'Mild bullish' : techScore >= -2 ? 'Neutral/mixed' : techScore >= -6 ? 'Mild bearish' : 'Strong bearish'}

━━━ FUNDAMENTALS ━━━
${fundDataStatus}

Reply ONLY with valid JSON (no markdown, no code fences):
{"signal":"BUY"|"HOLD"|"REVIEW","confidence":"HIGH"|"MEDIUM"|"LOW","summary":"1-sentence overall verdict","technicalNarrative":"2-3 sentences that CONNECT the specific numbers above — e.g. price vs SMA, what RSI + BB together imply, whether MACD confirms, and whether momentum is sustainable or extended","valuationContext":"2 sentences: is the current PE stretched or fair vs sector peers? If analyst target exists, explicitly say whether your technical target is a shorter-term milestone toward it or disagrees with it and why","entryExitLevels":{"buyZone":"₹XXX–₹YYY — reason (e.g. near support/SMA20/pullback zone)","breakoutLevel":"₹XXX — what this level confirms and why it matters","technicalTarget":"₹XXX–₹YYY (2-4 week horizon)","stopLoss":"₹XXX — state clearly that bullish thesis weakens below this"},"investorAction":"BUY_GRADUALLY"|"WAIT_FOR_DIP"|"BUY_ON_BREAKOUT"|"HOLD_EXISTING"|"REDUCE","investorActionReason":"1-2 sentences giving the research rationale — what technical or fundamental condition supports this view, and what would change it. Do NOT use first-person portfolio advice language","confidenceReason":"1-2 sentences listing the SPECIFIC factors preventing HIGH confidence (e.g. BB position above 80%, near 52w high resistance, PE premium vs peers, volume below average, macro risk)","keyRisks":["concise risk phrase 1","concise risk phrase 2","concise risk phrase 3"],"support":"₹XXX — reason","resistance":"₹XXX — reason","outlook":"2-4 week price outlook","technicalPoints":["point 1","point 2","point 3"],"knownFundamentals":{"pe":null,"forwardPE":null,"pbRatio":null,"eps":null,"roe":null,"roce":null,"operatingMargin":null,"revenueGrowth":null,"earningsGrowth":null,"debtToEquity":null,"dividendYield":null,"marketCapCr":null,"targetPrice":null,"analystCount":null,"recommendation":null}}

IMPORTANT for knownFundamentals: dividendYield must be a decimal ratio matching Yahoo Finance format — 0.008 means 0.8% yield, NOT the number 0.8. roe, roce, operatingMargin, revenueGrowth, earningsGrowth are percentage values (e.g. 21.5 means 21.5%). debtToEquity is a ratio (e.g. 7.8 means 7.8x).`;

    // ── 7. Claude ────────────────────────────────────────────────────────────
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1800,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(18000)
    });

    if (!claudeRes.ok) return reply({ error: 'Claude: ' + (await claudeRes.text()).slice(0, 200) }, 500, cors);

    const cd       = await claudeRes.json();
    const raw      = cd.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const analysis = JSON.parse(raw);

    // Merge Claude's training knowledge into gaps
    // Priority: manual fundDB > Yahoo Finance > Claude training data
    if (analysis.knownFundamentals) {
      const cf = analysis.knownFundamentals;
      Object.keys(cf).forEach(k => {
        if (cf[k] != null && fund[k] == null) fund[k] = cf[k];
      });
      delete analysis.knownFundamentals;
    }

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
      fundamentals: fund,
      ohlcv: rows,
      ema20Series, ema50Series, ema200Series,
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