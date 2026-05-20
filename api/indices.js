export const config = { runtime: 'edge' };

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

async function fetchYF(path, timeout = 6000) {
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

async function fetchIndex(symbol) {
  const res = await fetchYF(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`);
  if (!res) return null;
  try {
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const change = price - prevClose;
    const changePct = (change / prevClose) * 100;
    return {
      symbol,
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
    };
  } catch (_) {
    return null;
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const [nifty, sensex] = await Promise.all([
    fetchIndex('^NSEI'),
    fetchIndex('^BSESN'),
  ]);

  return new Response(JSON.stringify({ nifty, sensex, fetchedAt: new Date().toISOString() }), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  });
}
