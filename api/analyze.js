export const config = { runtime: 'edge' };

// Stooq.com — free financial data, no auth, no rate limits, NSE via .NS suffix
// Used by pandas-datareader, quantlib etc. Very reliable from server-side.
const STOOQ = 'https://stooq.com/q/d/l';

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
    // ── 1. Fetch 6 months of daily OHLCV from Stooq ───────────────────────
    // Stooq uses lowercase .ns suffix for NSE stocks
    const stooqSym = symbol.toLowerCase() + '.ns';
    const today    = new Date();
    const sixMoAgo = new Date(today);
    sixMoAgo.setMonth(today.getMonth() - 6);
    const d1 = fmt(sixMoAgo);
    const d2 = fmt(today);

    const csvRes = await fetch(
      `${STOOQ}/?s=${stooqSym}&i=d&d1=${d1}&d2=${d2}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!csvRes.ok) throw new Error(`Stooq returned HTTP ${csvRes.status} for ${symbol}`);

    const csv  = await csvRes.text();
    const rows = csv.trim().split('\n').slice(1) // skip header
      .map(r => r.split(','))
      .filter(r => r.length >= 5 && !isNaN(parseFloat(r[4])))
      .sort((a, b) => a[0].localeCompare(b[0])); // oldest first

    if (rows.length < 14) {
      throw new Error(
        `Only ${rows.length} data points for ${symbol} — ` +
        `check the ticker is a valid NSE symbol (e.g. HDFCBANK, TITAGARH, RELIANCE).`
      );
    }

    const closes  = rows.map(r => parseFloat(r[4]));
    const volumes = rows.map(r => parseFloat(r[5] || '0'));
    const price   = closes.at(-1);
    const prev    = closes.at(-2);
    const changePct = ((price - prev) / prev) * 100;

    // ── 2. Compute indicators ──────────────────────────────────────────────
    const sma20    = avg(closes.slice(-20));
    const sma50    = closes.length >= 50 ? avg(closes.slice(-50)) : null;
    const macd     = ema(closes, 12) - ema(closes, 26);
    const rsi      = calcRSI(closes);
    const high52w  = Math.max(...closes.slice(-252));
    const low52w   = Math.min(...closes.slice(-252));
    const change30d = closes.length >= 30
      ? ((closes.at(-1) - closes.at(-30)) / closes.at(-30)) * 100 : null;
    const avgVol20  = avg(volumes.slice(-20));
    const volRatio  = avgVol20 > 0 ? (volumes.at(-1) || avgVol20) / avgVol20 : 1;

    // ── 3. Build Claude prompt ─────────────────────────────────────────────
    const smaLine = (v, l) => v != null
      ? `- ${l}: Rs.${v.toFixed(2)} (price ${price > v ? 'ABOVE' : 'BELOW'} by ${Math.abs(((price/v)-1)*100).toFixed(1)}%)`
      : '';

    const prompt = `You are a professional technical analyst for Indian equity markets.
Analyse ONLY the technical data for ${name} (NSE: ${symbol}${sector ? ', Sector: ' + sector : ''}).
Pure price/momentum/volume analysis only — no fundamentals, no macro.

LIVE NSE DATA (from Stooq):
- Price: Rs.${price.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% today)
${smaLine(sma20, '20-day SMA')}
${smaLine(sma50, '50-day SMA')}
- RSI(14): ${rsi.toFixed(1)} — ${rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : 'neutral'}
- MACD: ${macd.toFixed(2)} (${macd > 0 ? 'bullish' : 'bearish'})
- 30d return: ${change30d !== null ? change30d.toFixed(2) + '%' : 'N/A'}
- 52w range: Rs.${low52w.toFixed(2)} – Rs.${high52w.toFixed(2)}
- From 52w high: ${((price/high52w-1)*100).toFixed(1)}%
- From 52w low: +${((price/low52w-1)*100).toFixed(1)}%
- Volume vs 20d avg: ${(volRatio*100).toFixed(0)}%

Reply ONLY with valid JSON, no markdown:
{"signal":"BUY_MORE","confidence":"HIGH","summary":"2-3 sentence overview","technicalPoints":["point 1","point 2","point 3"],"support":"Rs.XXX - reason","resistance":"Rs.XXX - reason","outlook":"1-2 sentence short-term outlook (2-4 weeks)"}
signal: BUY_MORE | HOLD | REVIEW
confidence: HIGH | MEDIUM | LOW`;

    // ── 4. Call Claude ─────────────────────────────────────────────────────
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

    if (!claudeRes.ok) return reply({ error: 'Claude: ' + (await claudeRes.text()).slice(0, 200) }, 500, cors);

    const cd       = await claudeRes.json();
    const raw      = cd.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const analysis = JSON.parse(raw);

    return reply({
      symbol: symbol.toUpperCase(), name,
      indicators: {
        price: +price.toFixed(2), changePct: +changePct.toFixed(2),
        sma20: +sma20.toFixed(2), sma50: sma50 ? +sma50.toFixed(2) : null,
        rsi: +rsi.toFixed(1), macd: +macd.toFixed(2),
        change30d: change30d !== null ? +change30d.toFixed(2) : null,
        high52w: +high52w.toFixed(2), low52w: +low52w.toFixed(2),
        volRatio: +volRatio.toFixed(2),
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

const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '');

function avg(a) { const v = a.filter(x => !isNaN(x)); return v.length ? v.reduce((s,x)=>s+x,0)/v.length : 0; }
function ema(c, p) { const k=2/(p+1); let e=avg(c.slice(0,p)); for(let i=p;i<c.length;i++) e=c[i]*k+e*(1-k); return e; }
function calcRSI(c, p=14) {
  if (c.length < p+1) return 50;
  let g=0, l=0;
  for (let i=c.length-p; i<c.length; i++) { const d=c[i]-c[i-1]; if(d>0) g+=d; else l-=d; }
  return 100-100/(1+(g/p)/((l/p)||0.001));
}
