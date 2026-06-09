export const config = { runtime: 'edge' };

const FEED_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
};

// Google News RSS has solid coverage of Indian listed companies and needs no auth —
// far more reliable for NSE small/mid-caps than Yahoo Finance's news search index.
async function fetchGoogleNews(query, timeout = 7000) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const res = await fetch(url, { headers: FEED_HEADERS, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml);
  } catch (_) {
    return [];
  }
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`).exec(block);
      if (!r) return '';
      return decodeEntities((r[1] ?? r[2] ?? '').trim());
    };
    let title  = get('title');
    const link = get('link');
    const pubDate = get('pubDate');
    const sourceTag = /<source[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/source>/.exec(block);
    let source = sourceTag ? decodeEntities((sourceTag[1] ?? sourceTag[2] ?? '').trim()) : '';

    // Google News titles are formatted as "Headline - Publisher"; strip that
    // suffix whether or not a separate <source> tag was present.
    const dash = title.lastIndexOf(' - ');
    if (dash > 0) {
      const suffix = title.slice(dash + 3).trim();
      if (!source || suffix.toLowerCase() === source.toLowerCase()) {
        if (!source) source = suffix;
        title = title.slice(0, dash).trim();
      }
    }

    if (title && link) items.push({ title, link, source, pubDate });
  }
  return items;
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
  const market = p.get('market') === 'global' ? 'global' : 'in';
  const exch   = market === 'global' ? 'NASDAQ' : 'NSE';

  if (!symbol) return reply({ error: 'symbol is required' }, 400, cors);

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500, cors);

  try {
    // ── 1. Fetch news from Google News RSS — try a couple of query variants ───
    const queries = market === 'global'
      ? [`${name} stock`, `${name} ${symbol} stock news`]
      : [`${name} share price`, `${name} NSE ${symbol}`];
    const seen = new Map();
    for (const q of queries) {
      const items = await fetchGoogleNews(q);
      for (const it of items) {
        if (!seen.has(it.link)) seen.set(it.link, it);
      }
      if (seen.size >= 10) break;
    }

    const rawNews = [...seen.values()];
    if (!rawNews.length) return reply({ news: [] }, 200, cors);

    // ── 2. Clean, format and filter to articles that actually mention the company ──
    const nameTokens = name
      .toLowerCase()
      .replace(/\b(ltd|limited|inc|corp|company|co|plc)\b/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2);
    const symbolLower = symbol.toLowerCase();

    const isRelevant = (title) => {
      const t = title.toLowerCase();
      if (t.includes(symbolLower)) return true;
      return nameTokens.some(tok => t.includes(tok));
    };

    const articles = rawNews
      .map(n => {
        const ts = n.pubDate ? new Date(n.pubDate).getTime() : 0;
        return {
          title: n.title,
          url: n.link,
          source: n.source,
          date: ts
            ? new Date(ts).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })
            : '',
          publishedAt: ts,
        };
      })
      .filter(n => n.title.length > 0 && isRelevant(n.title))
      .sort((a, b) => b.publishedAt - a.publishedAt);

    if (!articles.length) return reply({ news: [] }, 200, cors);

    // ── 3. Claude Haiku — batch sentiment tagging ─────────────────────────────
    const prompt = `You are a financial news sentiment classifier for ${market === 'global' ? 'US' : 'Indian'} equity markets.

Classify each headline below by its likely impact on ${name} (${exch}: ${symbol}) as a stock.

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
    const news = articles.slice(0, 5).map(({ publishedAt, ...a }, i) => ({
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
