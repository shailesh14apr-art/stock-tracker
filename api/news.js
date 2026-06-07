export const config = { runtime: 'edge' };

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

async function fetchYF(path, timeout = 7000) {
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

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return reply(null, 204, cors);

  const p      = new URL(req.url).searchParams;
  const symbol = p.get('symbol');
  const name   = p.get('name') || symbol;

  if (!symbol) return reply({ error: 'symbol is required' }, 400, cors);

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500, cors);

  try {
    // ── 1. Fetch news from Yahoo Finance search API ───────────────────────────
    const yahooSym = symbol.toUpperCase() + '.NS';

    const newsRes = await fetchYF(
      `/v1/finance/search?q=${encodeURIComponent(yahooSym)}&newsCount=8&quotesCount=0&enableFuzzyQuery=false&enableNavLinks=false`,
      7000
    );

    if (!newsRes) return reply({ news: [] }, 200, cors);

    const newsData = await newsRes.json();
    const rawNews  = newsData?.news || [];

    if (!rawNews.length) return reply({ news: [] }, 200, cors);

    // ── 2. Clean and format articles ─────────────────────────────────────────
    const articles = rawNews
      .slice(0, 8)
      .map(n => ({
        title:  n.title  || '',
        url:    n.link   || '',
        source: n.publisher || '',
        date:   n.providerPublishTime
          ? new Date(n.providerPublishTime * 1000).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: '2-digit',
              hour: '2-digit', minute: '2-digit',
            })
          : '',
      }))
      .filter(n => n.title.length > 0);

    if (!articles.length) return reply({ news: [] }, 200, cors);

    // ── 3. Claude Haiku — batch sentiment tagging ─────────────────────────────
    const prompt = `You are a financial news sentiment classifier for Indian equity markets.

Classify each headline below by its likely impact on ${name} (NSE: ${symbol}) as a stock.

Headlines:
${articles.map((a, i) => `${i}: ${a.title}`).join('\n')}

Rules:
- "positive" → likely to lift the stock price (earnings beat, contract win, expansion, upgrade, buyback, strong results, regulatory approval)
- "negative" → likely to hurt the stock price (earnings miss, downgrade, regulatory action, debt concern, management exit, loss, dispute)
- "neutral"  → general market news, routine disclosure, mixed/unclear impact

Reply ONLY with a valid JSON array — no markdown, no preamble:
[{"id":0,"sentiment":"positive"},{"id":1,"sentiment":"neutral"},...]`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(12000),
    });

    // ── 4. Merge sentiment back; fall back to neutral if Claude fails ─────────
    let tagMap = {};
    if (claudeRes.ok) {
      try {
        const cd  = await claudeRes.json();
        const raw = cd.content[0].text
          .trim()
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
        const tags = JSON.parse(raw);
        tags.forEach(t => { tagMap[t.id] = t.sentiment; });
      } catch (_) {
        // Sentiment parse failed — fallback neutral applied below
      }
    }

    const VALID = new Set(['positive', 'negative', 'neutral']);
    const news = articles.slice(0, 5).map((a, i) => ({
      ...a,
      sentiment: VALID.has(tagMap[i]) ? tagMap[i] : 'neutral',
    }));

    return reply({ news }, 200, cors);

  } catch (e) {
    return reply({ error: e.message }, 500, cors);
  }
}

const reply = (data, status, headers) =>
  new Response(data ? JSON.stringify(data) : '', {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
