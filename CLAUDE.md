# Stock Tracker — Claude Code Context

## What this is
AI-powered NSE stock analysis dashboard. GitHub Pages (index.html) + Vercel Edge Functions (api/).

## Stack
- Frontend: Single-file HTML/JS on GitHub Pages (`index.html`) — no build step
- Backend: Vercel Edge Runtime (`api/analyze.js`, `api/weekly-update.js`) — no npm packages allowed
- Data: Yahoo Finance v8 chart API + v10 quoteSummary API
- AI: Claude Sonnet via Anthropic API (key in Vercel env vars as ANTHROPIC_API_KEY)

## Key files
- `index.html` — entire frontend: sidebar, watchlist, AI card renderer, modal
- `api/analyze.js` — Edge function: Yahoo Finance → indicators → Claude → JSON response
- `api/weekly-update.js` — Vercel cron (Monday 8am): re-analyses all WATCHLIST stocks
- `vercel.json` — cron schedule + CORS headers
- `package.json` — devDependencies only (vercel CLI), no runtime deps

## Critical constraints
- Edge Runtime only: no `require()`, no npm packages at runtime, no Node built-ins
- Always commit directly to `main` branch (not patch-1, patch-2 etc.)
- Keep `api/analyze.js` under 300 lines
- Yahoo Finance works from Vercel server IPs — do not switch to other data sources
- `index.html` is a single file — all CSS, JS, HTML inline

## Response format from /api/analyze
```json
{
  "symbol": "HDFCBANK",
  "name": "HDFC Bank Ltd",
  "indicators": { "price", "changePct", "sma20", "sma50", "rsi", "macd", "macdSignal", "bbUpper", "bbLower", "bbPct", "change30d", "high52w", "low52w", "volRatio", "techScore", "scores" },
  "fundamentals": { "pe", "forwardPE", "eps", "pbRatio", "roe", "roce", "revenueGrowth", "earningsGrowth", "debtToEquity", "operatingMargin", "dividendYield", "marketCap", "bookValue", "targetPrice", "analystCount", "recommendation" },
  "analysis": { "signal", "confidence", "summary", "technicalPoints", "support", "resistance", "outlook", "keyRisk" },
  "fetchedAt": "ISO string"
}
```

## Sectors supported
railways | banking | it | fmcg | pharma | capital_markets | real_estate | auto | metals | energy

## Deployment
Push to main → Vercel auto-deploys. GitHub Pages serves index.html at stock-tracker-one-delta.vercel.app
