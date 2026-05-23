"""
Developer Agent
Receives all test results from the three specialist agents, uses Claude
to synthesise findings, prioritise issues, suggest root causes and fixes,
then produces a structured report.
"""
import json
import os
import httpx
from datetime import datetime
from state import AgentState, Issue, TestResult

ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL  = "claude-sonnet-4-20250514"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _format_results_for_prompt(results: list[TestResult]) -> str:
    lines = []
    for r in results:
        lines.append(
            f"[{r['status'].upper()}] [{r['severity']}] {r['test_name']}\n"
            f"  Detail: {r['detail']}\n"
            f"  Actual: {r['actual']}\n"
            f"  Expected: {r['expected']}"
        )
    return "\n\n".join(lines)


def _call_claude(prompt: str, api_key: str, max_tokens: int = 2000) -> str:
    r = httpx.post(
        ANTHROPIC_API,
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                 "Content-Type": "application/json"},
        json={"model": CLAUDE_MODEL, "max_tokens": max_tokens,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=60.0
    )
    return r.json()["content"][0]["text"].strip()


# ── Developer agent node ──────────────────────────────────────────────────────

def developer_agent(state: AgentState) -> dict:
    """
    LangGraph node — runs after all three test agents complete.
    Uses Claude to analyse all results and produce a prioritised report.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {
            "issues": [],
            "report": "ERROR: ANTHROPIC_API_KEY not set — developer agent could not run.",
            "summary": "Developer agent failed — missing API key."
        }

    ui_results        = state.get("ui_results", [])
    api_results       = state.get("api_results", [])
    financial_results = state.get("financial_results", [])

    all_failures = (
        [r for r in ui_results        if r["status"] != "pass"] +
        [r for r in api_results       if r["status"] != "pass"] +
        [r for r in financial_results if r["status"] != "pass"]
    )
    all_results  = ui_results + api_results + financial_results
    total        = len(all_results)
    passed       = sum(1 for r in all_results if r["status"] == "pass")
    failed       = total - passed

    print(f"[developer_agent] Received {total} test results: {passed} passed, {failed} failed.")
    print(f"[developer_agent] Calling Claude to synthesise findings...")

    # ── Step 1: Issue extraction ──────────────────────────────────────────────
    if all_failures:
        issue_prompt = f"""You are a senior developer reviewing automated test results for BazaarLens,
an Indian stock market analysis app with:
- Frontend: vanilla HTML/JS on GitHub Pages (index.html)
- Backend: Vercel edge function (analyze.js) calling Yahoo Finance + Claude Sonnet
- Three test agents: UI (Playwright), API (httpx), Financial (math validation)

Here are the FAILING test results grouped by agent:

=== UI AGENT FAILURES ===
{_format_results_for_prompt([r for r in ui_results if r["status"] != "pass"]) or "None"}

=== API AGENT FAILURES ===
{_format_results_for_prompt([r for r in api_results if r["status"] != "pass"]) or "None"}

=== FINANCIAL AGENT FAILURES ===
{_format_results_for_prompt([r for r in financial_results if r["status"] != "pass"]) or "None"}

For each failure, produce a JSON issue object. Return a JSON array only, no markdown:
[
  {{
    "severity": "critical|high|medium|low",
    "agent": "ui|api|financial",
    "title": "short title (max 8 words)",
    "description": "what is broken and why it matters to the user",
    "suggested_fix": "specific actionable fix — name the file, function, or line if you can",
    "file_hint": "e.g. analyze.js:calcRSI or index.html:.ai-card"
  }}
]

Severity guide:
- critical: app is broken / users see errors or blank screens
- high: important feature not working, but app loads
- medium: degraded experience
- low: cosmetic or minor

Group related failures into one issue where they share a root cause."""

        raw    = _call_claude(issue_prompt, api_key)
        clean  = raw.replace("```json", "").replace("```", "").strip()
        issues: list[Issue] = json.loads(clean)
    else:
        issues = []

    # ── Step 2: Narrative report ──────────────────────────────────────────────
    report_prompt = f"""You are a senior developer. Write a concise test report for BazaarLens.

Test run: {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}
Results: {passed}/{total} passed ({failed} failed)

Issues found:
{json.dumps(issues, indent=2) if issues else "None — all tests passed!"}

All test results summary:
- UI agent:        {sum(1 for r in ui_results if r['status']=='pass')}/{len(ui_results)} passed
- API agent:       {sum(1 for r in api_results if r['status']=='pass')}/{len(api_results)} passed
- Financial agent: {sum(1 for r in financial_results if r['status']=='pass')}/{len(financial_results)} passed

Write a report in Markdown with these sections:
## Summary
One paragraph. Overall health, most critical issue if any.

## Issues by priority
For each issue: title as ### heading, description, suggested fix, file hint.
Use ✅ for pass and ❌ for fail. Mark critical issues with 🔴, high with 🟠, medium with 🟡.

## Passed checks
Brief bullet list of what is working correctly.

## Recommended next actions
Numbered list, most urgent first. Be specific."""

    report = _call_claude(report_prompt, api_key, max_tokens=3000)

    # ── Step 3: Executive summary (one paragraph) ─────────────────────────────
    summary_prompt = f"""In exactly one sentence, summarise the BazaarLens test run:
{passed}/{total} tests passed, {failed} failed.
Critical issues: {[i['title'] for i in issues if i['severity'] == 'critical']}.
High issues: {[i['title'] for i in issues if i['severity'] == 'high']}.
Write the sentence from a developer's perspective, mentioning the most urgent fix if any."""

    summary = _call_claude(summary_prompt, api_key, max_tokens=200)

    print(f"[developer_agent] Report generated.\n")
    print("=" * 60)
    print(report)
    print("=" * 60)

    return {"issues": issues, "report": report, "summary": summary}
