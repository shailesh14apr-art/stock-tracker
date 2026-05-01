export const config = { runtime: 'edge' };

// This function ONLY calls Claude.
// Price data is fetched client-side in index.html and sent here as POST body.
// This keeps the function fast (~3s) and well within Vercel Hobby's 10s limit.

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return reply(null, 204, cors);
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405, cors);

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set in Vercel env vars' }, 500, cors);

  let body;
  try { body = await req.json(); }
  catch { return reply({ error: 'Invalid JSON body' }, 400, cors); }

  const { symbol, name, sector, indicators: ind } = body;
  if (!symbol || !ind) return reply({ error: 'symbol and indicators are required' }, 400, cors);

  const smaLine = (v, l) => v != null
    ? `- ${l}: Rs.${v.toFixed(2)} (price ${ind.price > v ? 'ABOVE' : 'BELOW'} by ${Math.abs(((ind.price / v) - 1) * 100).toFixed(1)}%)`
    : '';

  const prompt = `You are a professional technical analyst for Indian equity markets.
Analyse ONLY technical data for ${name || symbol} (NSE: ${symbol}${sector ? ', Sector: ' + sector : ''}).
Pure technical analysis — no fundamentals, no macro.

LIVE NSE DATA:
- Price: Rs.${ind.price.toFixed(2)} (${ind.changePct >= 0 ? '+' : ''}${ind.changePct.toFixed(2)}% today)
${smaLine(ind.sma20, '20-day SMA')}
${smaLine(ind.sma50, '50-day SMA')}
- RSI(14): ${ind.rsi.toFixed(1)} — ${ind.rsi > 70 ? 'OVERBOUGHT' : ind.rsi < 30 ? 'OVERSOLD' : 'neutral'}
- MACD: ${ind.macd.toFixed(2)} (${ind.macd > 0 ? 'bullish' : 'bearish'})
- 30d return: ${ind.change30d != null ? ind.change30d.toFixed(2) + '%' : 'N/A'}
- 52w range: Rs.${ind.low52w.toFixed(2)} – Rs.${ind.high52w.toFixed(2)}
- From 52w high: ${((ind.price / ind.high52w - 1) * 100).toFixed(1)}%
- From 52w low: +${((ind.price / ind.low52w - 1) * 100).toFixed(1)}%
- Volume vs 20d avg: ${(ind.volRatio * 100).toFixed(0)}%

Reply ONLY with valid JSON, no markdown:
{"signal":"BUY_MORE","confidence":"HIGH","summary":"2-3 sentence overview","technicalPoints":["point 1","point 2","point 3"],"support":"Rs.XXX - reason","resistance":"Rs.XXX - reason","outlook":"1-2 sentence short-term outlook (2-4 weeks)"}
signal: BUY_MORE | HOLD | REVIEW
confidence: HIGH | MEDIUM | LOW`;

  try {
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

    const cd  = await claudeRes.json();
    const raw = cd.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const analysis = JSON.parse(raw);

    return reply({ symbol: symbol.toUpperCase(), name, indicators: ind, analysis, fetchedAt: new Date().toISOString() }, 200, cors);

  } catch (e) {
    return reply({ error: e.name === 'AbortError' ? 'Claude timed out — please retry' : e.message }, 500, cors);
  }
}

const reply = (data, status, headers) =>
  new Response(data ? JSON.stringify(data) : '', {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
