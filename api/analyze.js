export const config = { runtime: 'edge' };

const STOCK_API = 'https://military-jobye-haiqstudios-14f59639.koyeb.app';

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
  const sector = p.get('sector') || '';

  if (!symbol) return reply({ error: 'symbol is required' }, 400, cors);

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set in Vercel env vars' }, 500, cors);

  try {
    // ── 1. Warm up the Koyeb server (free tier sleeps between requests) ────
    // Fire a cheap GET / ping and don't wait — this wakes the server
    // while we prepare, reducing cold-start latency on the stock call
    fetch(`${STOCK_API}/`).catch(() => {});

    // ── 2. Fetch stock data — try variants, retry once on 404 (cold start) ─
    const variants  = [symbol, `${symbol}.NS`, `${symbol}.BO`];
    let stockData   = null;
    let lastErr     = '';

    for (let attempt = 0; attempt < 2; attempt++) {
      for (const v of variants) {
        try {
          const res = await fetch(
            `${STOCK_API}/stock?symbol=${encodeURIComponent(v)}&res=num`,
            { signal: AbortSignal.timeout(7000) }
          );
          // 404 on first attempt = cold start; break inner loop and retry
          if (res.status === 404 && attempt === 0) {
            await sleep(2000); // give the server 2s to wake up
            break;
          }
          if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }

          const json = await res.json();
          if (json.status === 'success' && json.data) {
            stockData = json.data;
            break;
          }
          // Application-level error (stock not found etc.)
          lastErr = json.message || `No data for ${v}`;
        } catch (e) {
          lastErr = e.message;
        }
      }
      if (stockData) break;
    }

    // ── 3. If still not found, try the search endpoint as last resort ──────
    if (!stockData) {
      try {
        const searchRes = await fetch(
          `${STOCK_API}/search?q=${encodeURIComponent(symbol)}`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (searchRes.ok) {
          const searchJson = await searchRes.json();
          const results = searchJson.results || [];
          for (const r of results.slice(0, 3)) {
            const candidate = r.symbol;
            if (!candidate) continue;
            const sr = await fetch(
              `${STOCK_API}/stock?symbol=${encodeURIComponent(candidate)}&res=num`,
              { signal: AbortSignal.timeout(6000) }
            );
            if (sr.ok) {
              const sj = await sr.json();
              if (sj.status === 'success' && sj.data) { stockData = sj.data; break; }
            }
          }
        }
      } catch (_) {}
    }

    if (!stockData) {
      throw new Error(
        `Could not fetch data for "${symbol}" on NSE/BSE. ${lastErr ? lastErr + '. ' : ''}` +
        `Check the ticker symbol is correct (e.g. HDFCBANK, RELIANCE, TCS, TITAGARH).`
      );
    }

    // ── 4. Parse response fields ───────────────────────────────────────────
    const d          = stockData;
    const price      = +d.last_price         || 0;
    const prevClose  = +d.previous_close     || price;
    const changePct  = +d.percent_change     || ((price - prevClose) / prevClose * 100);
    const dayHigh    = +d.day_high           || price;
    const dayLow     = +d.day_low            || price;
    const high52w    = +d.year_high          || price * 1.3;
    const low52w     = +d.year_low           || price * 0.7;
    const volume     = +d.volume             || 0;
    const avgVol     = +(d.average_volume ?? d.avg_volume ?? volume);
    const pe         = d.pe_ratio            ? +d.pe_ratio            : null;
    const eps        = d.earnings_per_share  ? +d.earnings_per_share  : null;
    const marketCap  = d.market_cap          ? +d.market_cap          : null;
    const divYield   = d.dividend_yield      ? +d.dividend_yield      : null;

    const pctFromHigh = ((price / high52w) - 1) * 100;
    const pctFromLow  = ((price / low52w)  - 1) * 100;
    const volRatio    = avgVol > 0 ? volume / avgVol : 1;
    const dayRangePct = dayHigh > dayLow ? ((price - dayLow) / (dayHigh - dayLow) * 100) : 50;

    // ── 5. Call Claude ─────────────────────────────────────────────────────
    const prompt = `You are a professional technical and quantitative analyst for Indian equity markets.
Analyse the following live market data for ${name} (NSE: ${symbol}${sector ? ', Sector: ' + sector : ''}).

LIVE NSE DATA:
- Current Price: Rs.${price.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% today)
- Day Range: Rs.${dayLow.toFixed(2)} – Rs.${dayHigh.toFixed(2)} (at ${dayRangePct.toFixed(0)}% of day's range)
- 52-Week Range: Rs.${low52w.toFixed(2)} – Rs.${high52w.toFixed(2)}
- From 52w high: ${pctFromHigh.toFixed(1)}% | From 52w low: +${pctFromLow.toFixed(1)}%
- Volume vs avg: ${(volRatio * 100).toFixed(0)}%${volRatio > 1.5 ? ' (HIGH — strong participation)' : volRatio < 0.6 ? ' (LOW — weak participation)' : ' (normal)'}
${pe       ? `- P/E Ratio: ${pe.toFixed(1)}x`                         : ''}
${eps      ? `- EPS: Rs.${eps.toFixed(2)}`                            : ''}
${divYield ? `- Dividend Yield: ${divYield.toFixed(2)}%`              : ''}
${marketCap ? `- Market Cap: Rs.${(marketCap / 1e7).toFixed(0)} Cr`  : ''}

Key signals:
- 52w position: ${pctFromLow.toFixed(0)}% above 52w low → ${pctFromLow > 70 ? 'near highs, strong momentum' : pctFromLow < 30 ? 'near lows, downtrend or support zone' : 'mid-range'}
- Today: ${Math.abs(changePct).toFixed(2)}% ${changePct >= 0 ? 'gain' : 'decline'}${Math.abs(changePct) > 3 ? ' — significant move' : ''}
- Day range position: ${dayRangePct.toFixed(0)}% → ${dayRangePct > 70 ? 'closing near highs (bullish)' : dayRangePct < 30 ? 'closing near lows (bearish)' : 'mid-range'}

Reply ONLY with valid JSON, no markdown:
{"signal":"BUY_MORE","confidence":"HIGH","summary":"2-3 sentence analysis","technicalPoints":["point 1","point 2","point 3"],"support":"Rs.XXX - reason","resistance":"Rs.XXX - reason","outlook":"1-2 sentence short-term outlook (2-4 weeks)"}
signal: BUY_MORE | HOLD | REVIEW
confidence: HIGH | MEDIUM | LOW`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(12000)
    });

    if (!claudeRes.ok) {
      return reply({ error: 'Claude API error: ' + (await claudeRes.text()).slice(0, 200) }, 500, cors);
    }

    const cd       = await claudeRes.json();
    const raw      = cd.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const analysis = JSON.parse(raw);

    return reply({
      symbol: symbol.toUpperCase(), name,
      indicators: {
        price:       +price.toFixed(2),
        changePct:   +changePct.toFixed(2),
        dayHigh:     +dayHigh.toFixed(2),
        dayLow:      +dayLow.toFixed(2),
        high52w:     +high52w.toFixed(2),
        low52w:      +low52w.toFixed(2),
        pctFromHigh: +pctFromHigh.toFixed(1),
        pctFromLow:  +pctFromLow.toFixed(1),
        volRatio:    +volRatio.toFixed(2),
        pe:          pe ? +pe.toFixed(1) : null,
        // Null fields kept for UI compatibility
        sma20: null, sma50: null, rsi: null, macd: null, change30d: null,
      },
      analysis,
      fetchedAt: new Date().toISOString()
    }, 200, cors);

  } catch (e) {
    return reply({ error: e.message }, 500, cors);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const reply = (data, status, headers) =>
  new Response(data ? JSON.stringify(data) : '', {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...headers }
  });

const sleep = ms => new Promise(r => setTimeout(r, ms));
