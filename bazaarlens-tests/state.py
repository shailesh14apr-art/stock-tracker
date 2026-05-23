"""
Shared state for the BazaarLens multi-agent test system.
All agents read from and write to this typed dict.
"""
from typing import TypedDict, Annotated, Literal
from operator import add


Severity = Literal["critical", "high", "medium", "low", "pass"]


class TestResult(TypedDict):
    agent: str           # "ui" | "api" | "financial"
    test_name: str
    status: Literal["pass", "fail", "error"]
    severity: Severity
    detail: str          # What was checked
    actual: str          # What actually happened
    expected: str        # What was expected


class Issue(TypedDict):
    severity: Severity
    agent: str
    title: str
    description: str
    suggested_fix: str
    file_hint: str       # e.g. "analyze.js:calcRSI" or "index.html:AI card"


class AgentState(TypedDict):
    # Config — set once at start, read by all agents
    base_url: str        # e.g. "https://www.bazaarlens.in"
    api_url: str         # e.g. "https://your-vercel.vercel.app/api/analyze"
    test_symbols: list[str]  # e.g. ["RELIANCE", "INFY", "TCS"]

    # Results — each agent appends to these lists (Annotated[list, add] = reducer)
    ui_results:        Annotated[list[TestResult], add]
    api_results:       Annotated[list[TestResult], add]
    financial_results: Annotated[list[TestResult], add]

    # Developer agent output
    issues:  list[Issue]
    report:  str         # Final markdown report
    summary: str         # One-paragraph executive summary
