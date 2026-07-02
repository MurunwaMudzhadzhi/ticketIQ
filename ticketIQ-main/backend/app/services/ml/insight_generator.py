"""
TicketIQ — Forecast Insight Generator (Sprint 3)
==================================================
Converts the raw 7-day forecast dict from forecast_service.get_forecast()
into a plain-English management summary.

Follows the exact same Groq-first / template-fallback pattern as
services/analytics/weekly_insights.py so behaviour is consistent
throughout the app:

  1. If GROQ_API_KEY is configured → call the LLM for fluent prose.
  2. Otherwise → build an honest, number-grounded narrative from
     simple sentence templates.

The generated text is suitable for a weekly ops report: non-technical,
concise, and actionable.
"""
from __future__ import annotations

import json
from datetime import datetime

from app.core.config import settings


# ── LLM system prompt ──────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are a senior operations analyst at TicketIQ, an enterprise
helpdesk platform. You write brief, confident forecast summaries for department
managers — people who care about staffing and workload, not machine learning.

Given a 7-day ticket volume forecast, write exactly 3 short paragraphs:
  1. Overall outlook — is next week expected to be busier or quieter than usual?
  2. Specific days to watch — which day(s) peak, which are light?
  3. One concrete staffing recommendation (e.g. "schedule an extra agent on Thursday").

Rules:
  - Under 160 words total.
  - No markdown, no headers, no bullet points — flowing prose only.
  - Never invent numbers not in the data.
  - If MAE is provided, mention the model's accuracy (e.g. "accurate to within
    X tickets/day") to give the manager confidence in the numbers.
"""


# ── Template fallback ──────────────────────────────────────────────────────────

def _template_narrative(forecast_payload: dict) -> str:
    """
    Builds a plain-English summary from the forecast data without any
    LLM call. Every sentence is grounded in the actual numbers.
    """
    data   = forecast_payload["data"]
    mae    = forecast_payload.get("mae")
    model  = forecast_payload.get("model", "model")

    volumes    = [d["predicted_ticket_volume"] for d in data]
    total      = sum(volumes)
    avg_daily  = round(total / len(volumes), 1)
    peak_val   = max(volumes)
    peak_day   = data[volumes.index(peak_val)]
    low_val    = min(volumes)
    low_day    = data[volumes.index(low_val)]

    # Try to name the peak/low day in a friendly way
    def friendly_date(iso: str) -> str:
        try:
            return datetime.fromisoformat(iso).strftime("%A %-d %b")
        except Exception:
            return iso

    accuracy_note = (
        f" The model's forecasts are accurate to within {mae:.1f} tickets per day on average."
        if mae is not None
        else ""
    )

    outlook = (
        f"Over the next seven days, TicketIQ is expected to receive {total} tickets in total, "
        f"averaging {avg_daily} per day.{accuracy_note}"
    )

    peak_note = (
        f"The busiest day is forecast to be {friendly_date(peak_day['date'])} with {peak_val} tickets, "
        f"while {friendly_date(low_day['date'])} should be the quietest with only {low_val} tickets expected."
    )

    if peak_val > avg_daily * 1.3:
        recommendation = (
            f"Given the spike forecast for {friendly_date(peak_day['date'])}, "
            f"it is advisable to schedule additional agent cover that day. "
            f"Lighter days can absorb any overflow from the peak."
        )
    elif any(d["confidence_level"] == "low" for d in data):
        recommendation = (
            "Confidence in the longer-range days is lower due to limited historical data. "
            "Keep an eye on actual incoming volume mid-week and adjust agent rosters if "
            "the real figures diverge significantly from these projections."
        )
    else:
        recommendation = (
            "Volume looks evenly distributed across the week. "
            "Standard staffing should be sufficient; no extraordinary cover is needed."
        )

    return f"{outlook}\n\n{peak_note}\n\n{recommendation}"


# ── Main entry point ───────────────────────────────────────────────────────────

async def generate_forecast_insights(forecast_payload: dict) -> str:
    """
    Generates a plain-English management summary from the forecast payload.
    Tries Groq first; falls back to the template narrative on any failure.
    """
    if settings.GROQ_API_KEY and not settings.GROQ_API_KEY.startswith("gsk_your"):
        try:
            from groq import AsyncGroq
            client = AsyncGroq(api_key=settings.GROQ_API_KEY)

            # Summarise just the numbers for the LLM — no raw JSON dump
            data    = forecast_payload["data"]
            mae     = forecast_payload.get("mae")
            lines   = [
                f"  {d['date']} ({datetime.fromisoformat(d['date']).strftime('%A')}): "
                f"{d['predicted_ticket_volume']} tickets [{d['confidence_level']} confidence]"
                for d in data
            ]
            summary = "7-day ticket forecast:\n" + "\n".join(lines)
            if mae:
                summary += f"\nModel MAE (accuracy): ±{mae:.1f} tickets/day"

            response = await client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user",   "content": summary},
                ],
                temperature=0.35,
                max_tokens=280,
            )
            return response.choices[0].message.content.strip()

        except Exception as exc:
            print(f"[InsightGenerator] Groq failed: {exc} — using template fallback")

    return _template_narrative(forecast_payload)
