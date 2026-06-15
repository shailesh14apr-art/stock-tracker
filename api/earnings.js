export const config = { runtime: 'edge' };

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

async function fetchYF(path, timeout = 6000) {
  try {
    return await Promise.any([
      fetch(`https://query1.finance.yahoo.com${path}`, { headers: YF_HEADERS, signal: AbortSignal.timeout(timeout) })
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r; }),
      fetch(`https://query2.finance.yahoo.com${path}`, { headers: YF_HEADERS, signal: AbortSignal.timeout(timeout) })
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r; }),
    ]);
  } catch { return null; }
}

async function fetchEarnings(symbol) {
  try {
    const r = await fetchYF(
      `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents,earningsHistory,price`
    );
    if (!r) return null;
    const res = (await r.json())?.quoteSummary?.result?.[0];
    if (!res) return null;

    const ce      = res.calendarEvents?.earnings;
    const price   = res.price;
    const history = res.earningsHistory?.history || [];

    const now = Date.now();
    const upcomingTs = ce?.earningsDate?.find(d => d.raw * 1000 >= now - 86400000)?.raw ?? null;

    return {
      symbol,
      name:         price?.longName || price?.shortName || symbol,
      currency:     price?.currency || (symbol.endsWith('.NS') ? 'INR' : 'USD'),
      market:       symbol.endsWith('.NS') ? 'in' : 'global',
      upcomingDate: upcomingTs ? new Date(upcomingTs * 1000).toISOString().split('T')[0] : null,
      epsEstimate:  ce?.earningsAverage?.raw ?? null,
      epsLow:       ce?.earningsLow?.raw ?? null,
      epsHigh:      ce?.earningsHigh?.raw ?? null,
      history: history.slice(-4).reverse().map(h => ({
        quarter:     h.quarter?.fmt || h.period || '',
        epsEstimate: h.epsEstimate?.raw ?? null,
        epsActual:   h.epsActual?.raw ?? null,
        surprisePct: h.surprisePercent?.raw != null ? +(h.surprisePercent.raw * 100).toFixed(1) : null,
      })),
    };
  } catch { return null; }
}

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const ua = req.headers.get('user-agent') || '';
  if (!ua.includes('Mozilla') && !ua.includes('AppleWebKit'))
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: cors });

  const p       = new URL(req.url).searchParams;
  const symbols = (p.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);
  if (!symbols.length)
    return new Response(JSON.stringify({ error: 'No symbols' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  const results = await Promise.all(symbols.map(fetchEarnings));

  return new Response(JSON.stringify({ earnings: results.filter(Boolean) }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
