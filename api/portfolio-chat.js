export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: cors() });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors() });
  }

  try {
    const { messages, portfolioContext, market } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid messages' }), { status: 400, headers: cors() });
    }

    const system = buildPortfolioSystem(portfolioContext, market);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system,
        messages: messages.slice(-12),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `API error: ${err}` }), { status: 500, headers: cors() });
    }

    const data = await res.json();
    const content = data.content?.[0]?.text || 'No response received.';

    return new Response(JSON.stringify({ content }), { status: 200, headers: cors() });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors() });
  }
}

function buildPortfolioSystem(portfolio, market) {
  const isGlobal = market === 'global';
  const cur = isGlobal ? '$' : '₹';
  if (!portfolio || !portfolio.length) {
    return `You are an expert financial analyst specialising in ${isGlobal ? 'US-listed equities (NASDAQ/NYSE)' : 'Indian equities on NSE/BSE'}.
The user's watchlist is empty or no stocks have been analysed yet.
Politely let them know they need to add stocks and run AI analysis first before you can answer portfolio questions.`;
  }

  const analysed = portfolio.filter(s => s.signal);
  const unanalysed = portfolio.filter(s => !s.signal).map(s => s.symbol);

  const stockSummaries = analysed.map(s => {
    const ind = s.indicators || {};
    const fun = s.fundamentals || {};
    const a   = s.aiAnalysis  || {};
    const pct30 = ind.change30d != null ? ((ind.change30d >= 0 ? '+' : '') + ind.change30d + '%') : 'N/A';
    const todayPct = s.price?.changePercent != null ? ((s.price.changePercent >= 0 ? '+' : '') + s.price.changePercent + '%') : 'N/A';
    return `
### ${s.name} (${s.symbol})${s.sector ? ' — ' + s.sector : ''}
Signal: **${s.signal || 'N/A'}** | Confidence: ${a.confidence || 'N/A'} | Tech Score: ${ind.techScore != null ? ind.techScore + '/10' : 'N/A'}
Price: ${cur}${s.price?.current || 'N/A'} (${todayPct} today, ${pct30} 30d)
RSI: ${ind.rsi || 'N/A'} | MACD: ${ind.macd != null ? ind.macd.toFixed(2) : 'N/A'} | BB%B: ${ind.bbPct != null ? ind.bbPct.toFixed(1) + '%' : 'N/A'}
SMA20: ${cur}${ind.sma20 || 'N/A'} | SMA50: ${cur}${ind.sma50 || 'N/A'}
P/E: ${fun.pe != null ? fun.pe.toFixed(1) + 'x' : 'N/A'} | Fwd P/E: ${fun.forwardPE != null ? fun.forwardPE.toFixed(1) + 'x' : 'N/A'} | P/B: ${fun.pbRatio != null ? fun.pbRatio.toFixed(2) + 'x' : 'N/A'}
ROE: ${fun.roe != null ? fun.roe.toFixed(1) + '%' : 'N/A'} | D/E: ${fun.debtToEquity != null ? fun.debtToEquity.toFixed(2) + 'x' : 'N/A'} | Op Margin: ${fun.operatingMargin != null ? fun.operatingMargin.toFixed(1) + '%' : 'N/A'}
Summary: ${a.summary || 'No analysis available'}
Key Risk: ${a.keyRisk || 'N/A'}
Outlook: ${a.outlook || 'N/A'}`.trim();
  }).join('\n\n');

  const buyCount    = analysed.filter(s => s.signal === 'BUY_MORE').length;
  const holdCount   = analysed.filter(s => s.signal === 'HOLD').length;
  const reviewCount = analysed.filter(s => s.signal === 'REVIEW').length;
  const sectors     = [...new Set(analysed.map(s => s.sector).filter(Boolean))];

  const topScore = [...analysed].sort((a,b) => (b.indicators?.techScore||0) - (a.indicators?.techScore||0));
  const strongest = topScore.slice(0,3).map(s => `${s.symbol} (${s.indicators?.techScore}/10)`).join(', ');
  const weakest   = topScore.slice(-3).reverse().map(s => `${s.symbol} (${s.indicators?.techScore}/10)`).join(', ');

  return `You are an expert financial analyst specialising in ${isGlobal ? 'US-listed equities (NASDAQ/NYSE)' : 'Indian equities on NSE/BSE'}. You are analysing the user's personal watchlist — stocks they follow or own.

## Watchlist Snapshot
- Stocks tracked: ${portfolio.length} total (${analysed.length} analysed${unanalysed.length ? ', ' + unanalysed.length + ' pending: ' + unanalysed.join(', ') : ''})
- Signals: **${buyCount} BUY MORE** · **${holdCount} HOLD** · **${reviewCount} REVIEW**
- Sectors: ${sectors.join(', ') || 'Mixed / unclassified'}
- Strongest tech scores: ${strongest || 'N/A'}
- Weakest tech scores: ${weakest || 'N/A'}

## Individual Stock Data
${stockSummaries}

## Your role
Answer questions about the watchlist as a whole or compare specific stocks within it.
You can:
- Identify the strongest / weakest stocks by technical or fundamental criteria
- Compare two or more stocks directly using the data above
- Highlight sector concentration risks or diversification gaps
- Flag stocks with warning signs (RSI > 70 overbought, bearish MACD crossover, high debt, negative momentum)
- Summarise the overall health and risk profile of the watchlist
- Suggest which stocks warrant closer attention right now

## Response style
- Be direct and specific — reference actual numbers from the data
- Use **bold** for stock names, key figures, and conclusions
- Use ${cur} for all price references
- Keep responses concise and scannable (prefer bullet lists for comparisons)
- If data is missing for a stock, note it honestly rather than guessing
- Avoid generic financial advice; anchor every point to the actual watchlist data

## Disclaimer
End every response with a single brief line: *For informational purposes only — not ${isGlobal ? 'SEC' : 'SEBI'}-registered investment advice.*`;
}

function cors() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
