"""
BazaarLens Multi-Agent Test System
====================================
Graph topology:
  START → coordinator → [ui_agent, api_agent, financial_agent] (parallel)
        → aggregator → developer_agent → END

Run with:
  ANTHROPIC_API_KEY=sk-... python graph.py
"""

import os
import json
from datetime import datetime
from pathlib import Path

from langgraph.graph import StateGraph, START, END
from langgraph.types import Send

from state import AgentState
from agents.ui_agent        import ui_agent
from agents.api_agent       import api_agent
from agents.financial_agent import financial_agent
from agents.developer_agent import developer_agent


# ── Coordinator node: just logs and returns {} ────────────────────────────────

def coordinator(state: AgentState) -> dict:
    """
    Regular node — must return a dict.
    The actual fan-out happens in fan_out() below, which is the
    conditional edge function (returns Send objects, not state).
    """
    print("\n[coordinator] Fanning out to ui_agent, api_agent, financial_agent in parallel...\n")
    return {}


# ── Fan-out edge function: returns Send objects ───────────────────────────────

def fan_out(state: AgentState) -> list[Send]:
    """
    Conditional edge function — called by add_conditional_edges.
    Returns a list of Send() to spawn all three agents in parallel.
    This is separate from the coordinator node because in LangGraph v1.0
    nodes must return dicts; only edge functions can return Send objects.
    """
    return [
        Send("ui_agent",       state),
        Send("api_agent",      state),
        Send("financial_agent", state),
    ]


# ── Aggregator: called after all three agents complete ───────────────────────

def aggregator(state: AgentState) -> dict:
    ui_total  = len(state.get("ui_results", []))
    api_total = len(state.get("api_results", []))
    fin_total = len(state.get("financial_results", []))
    print(f"[aggregator] Collected: {ui_total} UI, {api_total} API, {fin_total} Financial results.")
    print("[aggregator] Handing off to developer_agent...\n")
    return {}


# ── Build the graph ───────────────────────────────────────────────────────────

def build_graph():
    g = StateGraph(AgentState)

    g.add_node("coordinator",     coordinator)
    g.add_node("ui_agent",        ui_agent)
    g.add_node("api_agent",       api_agent)
    g.add_node("financial_agent", financial_agent)
    g.add_node("aggregator",      aggregator)
    g.add_node("developer_agent", developer_agent)

    g.add_edge(START, "coordinator")

    # fan_out is the EDGE function (returns Sends); coordinator is the NODE (returns {})
    g.add_conditional_edges(
        "coordinator",
        fan_out,
        ["ui_agent", "api_agent", "financial_agent"]   # explicit destination list
    )

    g.add_edge("ui_agent",        "aggregator")
    g.add_edge("api_agent",       "aggregator")
    g.add_edge("financial_agent", "aggregator")
    g.add_edge("aggregator",      "developer_agent")
    g.add_edge("developer_agent", END)

    return g.compile()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    base_url = os.environ.get("BASE_URL",  "https://www.bazaarlens.in")
    api_url  = os.environ.get("API_URL",   "")
    symbols  = os.environ.get("SYMBOLS",   "RELIANCE,INFY,TCS").split(",")

    if not api_url:
        print("ERROR: API_URL env var not set.")
        print("Set it to your Vercel URL, e.g.:")
        print("  export API_URL=https://your-app.vercel.app/api/analyze")
        raise SystemExit(1)

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY env var not set.")
        raise SystemExit(1)

    print("=" * 60)
    print("  BazaarLens Multi-Agent Test System")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"  Frontend : {base_url}")
    print(f"  API      : {api_url}")
    print(f"  Symbols  : {symbols}")
    print("=" * 60 + "\n")

    initial_state: AgentState = {
        "base_url":          base_url,
        "api_url":           api_url,
        "test_symbols":      symbols,
        "ui_results":        [],
        "api_results":       [],
        "financial_results": [],
        "issues":            [],
        "report":            "",
        "summary":           "",
    }

    graph  = build_graph()
    result = graph.invoke(initial_state)

    ts          = datetime.now().strftime("%Y%m%d_%H%M")
    report_path = Path(f"reports/report_{ts}.md")
    report_path.parent.mkdir(exist_ok=True)
    report_path.write_text(result["report"])

    issues_path = Path(f"reports/issues_{ts}.json")
    issues_path.write_text(json.dumps(result["issues"], indent=2))

    print(f"\nReport saved → {report_path}")
    print(f"Issues JSON → {issues_path}")
    print(f"\nSummary: {result['summary']}")

    critical = [i for i in result["issues"] if i["severity"] in ("critical", "high")]
    if critical:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
