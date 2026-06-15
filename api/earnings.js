export const config = { runtime: 'edge' };

const DB_URL = process.env.FIREBASE_DATABASE_URL || 'https://bazaarlens-f22ab-default-rtdb.firebaseio.com';

// ── Yahoo Finance (US stocks only) ───────────────────────────────────────────
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

async function fetchYF(path, timeout = 7000) {
  try {
    return await Promise.any([
      fetch(`https://query1.finance.yahoo.com${path}`, { headers: YF_HEADERS, signal: AbortSignal.timeout(timeout) })
        .then(r => { if (!r.ok) throw new Error(r.status); return r; }),
      fetch(`https://query2.finance.yahoo.com${path}`, { headers: YF_HEADERS, signal: AbortSignal.timeout(timeout) })
        .then(r => { if (!r.ok) throw new Error(r.status); return r; }),
    ]);
  } catch { return null; }
}

// ── Fetch NSE calendar from Firebase (cached nightly) ────────────────────────
let _nseCache = null;
let _nseCachedAt = 0;
const NSE_CACHE_MS = 60 * 60 * 1000; // re-use for 1 hour within same Edge instance

async function getNseCalendar() {
  if (_nseCache && Date.now() - _nseCachedAt < NSE_CACHE_MS) return _nseCache;
  try {
    const r = await fetch(`${DB_URL}/nseCalendar.json`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return {};
    const data = await r.json();
    _nseCache = data?.events || {};
    _nseCachedAt = Date.now();
    return _nseCache;
  } catch { return {}; }
}

// ── Per-symbol fetchers ───────────────────────────────────────────────────────
async function fetchIndianEarnings(symbol, nseCalendar) {
  const sym = symbol.replace('.NS', '').toUpperCase();
  const nse = nseCalendar[sym] || null;

  // Try Yahoo Finance for name + earnings history
  let name = sym, currency = 'INR', history = [];
  try {
    const r = await fetchYF(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=earningsHistory,price`);
    if (r) {
      const res = (await r.json())?.quoteSummary?.result?.[0];
      if (res) {
        name     = res.price?.longName || res.price?.shortName || sym;
        currency = res.price?.currency || 'INR';
        history  = (res.earningsHistory?.history || []).slice(-4).reverse().map(h => ({
          quarter:     h.quarter?.fmt || h.period || '',
          epsEstimate: h.epsEstimate?.raw ?? null,
          epsActual:   h.epsActual?.raw ?? null,
          surprisePct: h.surprisePercent?.raw != null ? +(h.surprisePercent.raw * 100).toFixed(1) : null,
        }));
      }
    }
  } catch { /* silent — name stays as sym */ }

  return {
    symbol, name, currency, market: 'in',
    upcomingDate:  nse?.date    || null,
    upcomingLabel: nse?.purpose || null,
    epsEstimate: null, epsLow: null, epsHigh: null,
    history,
    _source: nse ? 'nse' : 'stub',
  };
}

async function fetchUsEarnings(symbol) {
  const entry = {
    symbol, name: symbol, currency: 'USD', market: 'global',
    upcomingDate: null, upcomingLabel: null,
    epsEstimate: null, epsLow: null, epsHigh: null,
    history: [], _source: 'stub',
  };
  try {
    const r = await fetchYF(
      `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents,earningsHistory,price`
    );
    if (!r) return entry;
    const res = (await r.json())?.quoteSummary?.result?.[0];
    if (!res) return entry;

    const ce      = res.calendarEvents?.earnings;
    const price   = res.price;
    const history = res.earningsHistory?.history || [];
    const now     = Date.now();
    const upcomingTs = ce?.earningsDate?.find(d => d.raw * 1000 >= now - 86400000)?.raw ?? null;

    return {
      ...entry,
      name:         price?.longName || price?.shortName || symbol,
      currency:     price?.currency || 'USD',
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
      _source: 'yahoo',
    };
  } catch { return entry; }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const p       = new URL(req.url).searchParams;
  const symbols = (p.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);
  if (!symbols.length)
    return new Response(JSON.stringify({ error: 'No symbols' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  const indianSyms = symbols.filter(s => s.endsWith('.NS'));
  const usSyms     = symbols.filter(s => !s.endsWith('.NS'));

  // Fetch NSE calendar once for all Indian symbols
  const nseCalendar = indianSyms.length ? await getNseCalendar() : {};

  const results = await Promise.all([
    ...indianSyms.map(s => fetchIndianEarnings(s, nseCalendar)),
    ...usSyms.map(s => fetchUsEarnings(s)),
  ]);

  return new Response(JSON.stringify({
    earnings: results,
    meta: { nseLastUpdated: _nseCache ? (await fetch(`${DB_URL}/nseCalendar/lastUpdated.json`).then(r=>r.json()).catch(()=>null)) : null }
  }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
