export const config = { runtime: 'edge' };

// ── NSE cookie dance helpers ──────────────────────────────────────────────────
const NSE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function parseCookies(setCookieHeader) {
  // Edge runtimes may return multiple Set-Cookie values joined; extract name=value pairs
  return (setCookieHeader || '')
    .split(/,(?=[^ ]+=)/)          // split on commas that precede a new cookie name
    .map(c => c.trim().split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function getNseCookies() {
  const r = await fetch('https://www.nseindia.com', {
    headers: {
      'User-Agent': NSE_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  return parseCookies(r.headers.get('set-cookie'));
}

// ── Date helpers ─────────────────────────────────────────────────────────────
const MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

function nseToIso(dateStr) {
  // "27-Apr-2024" → "2024-04-27"
  const [d, m, y] = dateStr.split('-');
  if (!d || MON[m] === undefined || !y) return null;
  return `${y}-${String(MON[m] + 1).padStart(2,'0')}-${d.padStart(2,'0')}`;
}

const RESULTS_KEYWORDS = ['quarterly result', 'financial result', 'annual result',
                          'half yearly result', 'audited result', 'unaudited result'];

function isResultsEvent(purpose) {
  const p = (purpose || '').toLowerCase();
  return RESULTS_KEYWORDS.some(k => p.includes(k));
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  // Allow manual trigger with ?force=1; Vercel crons use GET with no body
  const url  = new URL(req.url);
  const auth = req.headers.get('authorization') || '';
  const CRON_SECRET = process.env.CRON_SECRET || '';
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}` && url.searchParams.get('secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
  }

  const DB_URL    = process.env.FIREBASE_DATABASE_URL   || 'https://bazaarlens-f22ab-default-rtdb.firebaseio.com';
  const DB_SECRET = process.env.FIREBASE_DATABASE_SECRET || '';
  if (!DB_SECRET) return new Response(JSON.stringify({ error: 'Missing FIREBASE_DATABASE_SECRET' }), { status: 500, headers: cors });

  // ── Step 1: get NSE session cookies ─────────────────────────────────────
  let cookies;
  try { cookies = await getNseCookies(); }
  catch (e) { return new Response(JSON.stringify({ error: 'NSE session failed', detail: String(e) }), { status: 502, headers: cors }); }

  // ── Step 2: fetch event calendar ─────────────────────────────────────────
  let events;
  try {
    const r = await fetch('https://www.nseindia.com/api/event-calendar?index=equities', {
      headers: {
        'User-Agent': NSE_UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-event-calendar',
        'Cookie': cookies,
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    events = await r.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'NSE event-calendar fetch failed', detail: String(e) }), { status: 502, headers: cors });
  }

  if (!Array.isArray(events)) {
    return new Response(JSON.stringify({ error: 'Unexpected NSE response', sample: JSON.stringify(events).slice(0,200) }), { status: 502, headers: cors });
  }

  // ── Step 3: build { SYMBOL: { date, purpose } } map ─────────────────────
  const today  = new Date(); today.setHours(0,0,0,0);
  const cutoff = new Date(today.getTime() - 7 * 86400000); // keep up to 7 days past

  const calendar = {};
  for (const ev of events) {
    const sym  = (ev.symbol || '').toUpperCase();
    const date = nseToIso(ev.bm_date || ev.date || '');
    if (!sym || !date || !isResultsEvent(ev.purpose)) continue;
    const dt = new Date(date + 'T00:00:00');
    if (dt < cutoff) continue; // skip old events

    // Keep the soonest upcoming date per symbol
    if (!calendar[sym] || date < calendar[sym].date) {
      calendar[sym] = { date, purpose: ev.purpose, company: ev.company || sym };
    }
  }

  const count = Object.keys(calendar).length;

  // ── Step 4: write to Firebase RT DB ──────────────────────────────────────
  const payload = { lastUpdated: new Date().toISOString(), events: calendar };
  const fbRes = await fetch(`${DB_URL}/nseCalendar.json?auth=${DB_SECRET}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!fbRes.ok) {
    const fbErr = await fbRes.text();
    return new Response(JSON.stringify({ error: 'Firebase write failed', detail: fbErr }), { status: 500, headers: cors });
  }

  return new Response(JSON.stringify({ ok: true, eventsWritten: count, lastUpdated: payload.lastUpdated }), { status: 200, headers: cors });
}
