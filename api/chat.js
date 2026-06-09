export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: cors() });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors() });
  }

  try {
    const { messages, stockContext: ctx } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid messages' }), { status: 400, headers: cors() });
    }

    const system = buildSystem(ctx);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system,
        messages: messages.slice(-12),  // keep last 12 turns for context
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

function buildSystem(ctx) {
  const isGlobal = ctx?.market === 'global';
  const cur = isGlobal ? '$' : '₹';
  const stock = ctx ? `
## Stock being discussed: ${ctx.name} (${ctx.symbol}) — ${ctx.sector}

**AI Signal:** ${ctx.signal} | Confidence: ${ctx.confidence || 'N/A'}
**Summary:** ${ctx.summary || 'N/A'}
**Outlook:** ${ctx.outlook || 'N/A'}
**Key Risk:** ${ctx.keyRisk || 'N/A'}

**Price:** ${cur}${ctx.price?.current || 'N/A'} (${ctx.price?.changePercent != null ? (ctx.price.changePercent >= 0 ? '+' : '') + ctx.price.changePercent + '%' : 'N/A'} today)
**52W Range:** ${cur}${ctx.price?.weekLow52 || 'N/A'} – ${cur}${ctx.price?.weekHigh52 || 'N/A'}
**Support:** ${ctx.support || 'N/A'} | **Resistance:** ${ctx.resistance || 'N/A'}

**Technical Indicators:**
- RSI (14): ${ctx.indicators?.rsi || 'N/A'}
- MACD: ${ctx.indicators?.macd != null ? ctx.indicators.macd.toFixed(2) : 'N/A'} (Signal: ${ctx.indicators?.macdSignal != null ? ctx.indicators.macdSignal.toFixed(2) : 'N/A'})
- SMA 20: ${cur}${ctx.indicators?.sma20 || 'N/A'} | SMA 50: ${cur}${ctx.indicators?.sma50 || 'N/A'}
- Bollinger Band %B: ${ctx.indicators?.bbPct != null ? ctx.indicators.bbPct.toFixed(1) + '%' : 'N/A'}
- Technical Score: ${ctx.indicators?.techScore || 'N/A'}/10
- Volume vs Avg: ${ctx.indicators?.volRatio != null ? (ctx.indicators.volRatio * 100).toFixed(0) + '%' : 'N/A'}
- 30-day Return: ${ctx.indicators?.change30d != null ? (ctx.indicators.change30d >= 0 ? '+' : '') + ctx.indicators.change30d + '%' : 'N/A'}
${(ctx.technicalPoints || []).map(p => `- ${p}`).join('\n')}

**Fundamentals:**
- P/E: ${ctx.fundamentals?.pe != null ? ctx.fundamentals.pe.toFixed(1) + 'x' : 'N/A'} (Fwd: ${ctx.fundamentals?.forwardPE != null ? ctx.fundamentals.forwardPE.toFixed(1) + 'x' : 'N/A'})
- P/B: ${ctx.fundamentals?.pbRatio != null ? ctx.fundamentals.pbRatio.toFixed(2) + 'x' : 'N/A'}
- ROE: ${ctx.fundamentals?.roe != null ? ctx.fundamentals.roe.toFixed(1) + '%' : 'N/A'} | ROCE: ${ctx.fundamentals?.roce != null ? ctx.fundamentals.roce.toFixed(1) + '%' : 'N/A'}
- EPS: ${cur}${ctx.fundamentals?.eps != null ? ctx.fundamentals.eps.toFixed(2) : 'N/A'}
- Revenue Growth: ${ctx.fundamentals?.revenueGrowth != null ? (ctx.fundamentals.revenueGrowth >= 0 ? '+' : '') + ctx.fundamentals.revenueGrowth.toFixed(1) + '%' : 'N/A'} YoY
- Earnings Growth: ${ctx.fundamentals?.earningsGrowth != null ? (ctx.fundamentals.earningsGrowth >= 0 ? '+' : '') + ctx.fundamentals.earningsGrowth.toFixed(1) + '%' : 'N/A'} YoY
- D/E Ratio: ${ctx.fundamentals?.debtToEquity != null ? ctx.fundamentals.debtToEquity.toFixed(2) + 'x' : 'N/A'}
- Operating Margin: ${ctx.fundamentals?.operatingMargin != null ? ctx.fundamentals.operatingMargin.toFixed(1) + '%' : 'N/A'}
- Market Cap: ${ctx.fundamentals?.marketCapCr != null ? (isGlobal ? '$' + (ctx.fundamentals.marketCapCr >= 1000 ? (ctx.fundamentals.marketCapCr / 1000).toFixed(2) + 'T' : ctx.fundamentals.marketCapCr.toFixed(1) + 'B') : '₹' + (ctx.fundamentals.marketCapCr >= 100000 ? (ctx.fundamentals.marketCapCr / 100000).toFixed(1) + 'L Cr' : ctx.fundamentals.marketCapCr >= 1000 ? (ctx.fundamentals.marketCapCr / 1000).toFixed(1) + 'K Cr' : ctx.fundamentals.marketCapCr.toFixed(0) + ' Cr')) : 'N/A'}
- Analyst Target: ${isGlobal ? '$' : '₹'}${ctx.fundamentals?.targetPrice || 'N/A'} (${ctx.fundamentals?.recommendation?.toUpperCase().replace(/_/g, ' ') || 'N/A'})

Analysis last updated: ${ctx.lastUpdated ? new Date(ctx.lastUpdated).toLocaleString('en-IN') : 'N/A'}
` : 'No specific stock context provided.';

  return `You are an expert financial analyst specialising in ${isGlobal ? 'US-listed equities (NASDAQ/NYSE)' : 'Indian equities listed on NSE/BSE'}. You have deep knowledge of technical analysis, fundamental analysis, and the nuances of the ${isGlobal ? 'US' : 'Indian'} stock market including sector dynamics, regulatory environment, and macroeconomic factors.

${stock}

## Response style
- Be direct and specific — reference actual numbers from the context above
- Lead with the key insight, then support it with data  
- Use ${isGlobal ? '$' : '₹'} for all price references
- Keep responses concise and scannable (2–4 paragraphs max, or a short bulleted list where it helps)
- If asked something outside the available data, acknowledge the gap honestly
- Use **bold** for emphasis on key figures or conclusions

## Disclaimer
End each response with a single brief line: *For informational purposes only — not ${isGlobal ? 'SEC' : 'SEBI'}-registered investment advice.*`;
}

function cors() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
