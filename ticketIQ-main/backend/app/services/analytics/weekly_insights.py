"""
TicketIQ — Weekly Insights Service
===================================
Sprint 2 deliverable: "Generate weekly summary insights."

Where the rest of the analytics module (see analytics.py) answers
"what are the numbers right now", this service answers a different
question: "what changed this week, and what should management actually
do about it." It does two things:

  1. WEEKLY DATA AGGREGATION (_build_weekly_dataset)
     Pulls this week's and last week's ticket activity from the
     database and computes the same kind of comparison a human analyst
     would: volume change, category mix, response/resolution time,
     SLA performance, and the busiest department.

  2. NARRATIVE GENERATION (generate_weekly_narrative)
     Turns that structured data into a short, professional written
     summary — a few paragraphs a manager could read in under a
     minute, rather than another table of numbers. This uses the same
     GROQ-with-template-fallback pattern as the rest of the AI features
     in this app (see services/ai/response_service.py), so the feature
     keeps working even with no GROQ_API_KEY configured.

Both pieces are combined and returned by the /analytics/weekly-insights
endpoint, and the same narrative is reused by the
/analytics/weekly-insights/download endpoint to produce a plain-text
file the user can save.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Ticket, TicketStatus, TicketPriority, Department
from app.core.config import settings

utcnow = lambda: datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────────────────
# 1. DATA AGGREGATION
# ─────────────────────────────────────────────────────────────────────────

async def _count(db: AsyncSession, *conditions) -> int:
    """Small helper to keep the COUNT(*) queries below on one line each."""
    q = select(func.count(Ticket.id))
    for c in conditions:
        q = q.where(c)
    return (await db.execute(q)).scalar() or 0


async def _build_weekly_dataset(db: AsyncSession) -> dict:
    """
    Builds the structured numbers behind the weekly insight report:
    this week vs. the previous week, broken down by volume, category,
    SLA performance, and average resolution time.

    "This week" = the 7 days ending right now, not a calendar week —
    that way the report is always meaningful regardless of which day
    of the week it's generated on.
    """
    now = utcnow()
    week_start      = now - timedelta(days=7)
    prev_week_start = now - timedelta(days=14)

    # --- Volume: this week vs. last week ----------------------------------
    created_this_week = await _count(db, Ticket.created_at >= week_start)
    created_last_week = await _count(
        db, Ticket.created_at >= prev_week_start, Ticket.created_at < week_start
    )
    resolved_this_week = await _count(
        db, Ticket.resolved_at >= week_start, Ticket.resolved_at != None
    )
    resolved_last_week = await _count(
        db, Ticket.resolved_at >= prev_week_start, Ticket.resolved_at < week_start, Ticket.resolved_at != None
    )

    def pct_change(curr: int, prev: int) -> Optional[float]:
        """Returns percentage change, or None if there's no prior-week
        baseline to compare against (avoids a misleading divide-by-zero)."""
        if prev == 0:
            return None
        return round((curr - prev) / prev * 100, 1)

    # --- Category / department mix this week --------------------------------
    dept_rows = (await db.execute(
        select(Department.name, func.count(Ticket.id).label("count"))
        .join(Ticket, Ticket.department_id == Department.id, isouter=True)
        .where(Ticket.created_at >= week_start)
        .group_by(Department.id)
        .order_by(func.count(Ticket.id).desc())
    )).all()
    by_department = [{"name": r.name, "count": r.count} for r in dept_rows]
    busiest_department = by_department[0] if by_department and by_department[0]["count"] > 0 else None

    # --- Priority mix this week ----------------------------------------------
    priority_rows = (await db.execute(
        select(Ticket.priority, func.count(Ticket.id).label("count"))
        .where(Ticket.created_at >= week_start)
        .group_by(Ticket.priority)
    )).all()
    by_priority = {
        (r.priority.value if hasattr(r.priority, "value") else r.priority): r.count
        for r in priority_rows
    }

    # --- SLA performance this week --------------------------------------------
    sla_total_this_week = await _count(db, Ticket.created_at >= week_start)
    sla_breached_this_week = await _count(
        db, Ticket.created_at >= week_start, Ticket.sla_breached == True
    )
    sla_breach_rate = round(sla_breached_this_week / sla_total_this_week * 100, 1) if sla_total_this_week else 0

    # --- Average resolution time this week (hours) -----------------------------
    resolved_rows = (await db.execute(
        select(Ticket.created_at, Ticket.resolved_at).where(
            Ticket.resolved_at >= week_start, Ticket.resolved_at != None
        )
    )).all()
    if resolved_rows:
        total_hours = sum(
            (r.resolved_at - r.created_at).total_seconds() / 3600 for r in resolved_rows
        )
        avg_resolution_hours = round(total_hours / len(resolved_rows), 1)
    else:
        avg_resolution_hours = None

    # --- Escalations this week ------------------------------------------------
    escalated_this_week = await _count(
        db, Ticket.created_at >= week_start, Ticket.is_escalated == True
    )

    return {
        "period": {
            "start": week_start.isoformat(),
            "end":   now.isoformat(),
        },
        "volume": {
            "created_this_week":  created_this_week,
            "created_last_week":  created_last_week,
            "created_change_pct": pct_change(created_this_week, created_last_week),
            "resolved_this_week":  resolved_this_week,
            "resolved_last_week":  resolved_last_week,
            "resolved_change_pct": pct_change(resolved_this_week, resolved_last_week),
        },
        "by_department": by_department,
        "busiest_department": busiest_department,
        "by_priority": by_priority,
        "sla": {
            "total":       sla_total_this_week,
            "breached":    sla_breached_this_week,
            "breach_rate": sla_breach_rate,
        },
        "avg_resolution_hours": avg_resolution_hours,
        "escalated_this_week":  escalated_this_week,
    }


# ─────────────────────────────────────────────────────────────────────────
# 2. NARRATIVE GENERATION
# ─────────────────────────────────────────────────────────────────────────

NARRATIVE_SYSTEM_PROMPT = """You are a senior reporting analyst at TicketIQ, an
enterprise IT support platform. You write short, professional weekly summary
reports for non-technical department managers and executives.

Write in plain, confident business English. No jargon, no bullet-point dumps
of raw numbers — synthesize the numbers into 3 short paragraphs:
  1. Overall volume and trend (busier or quieter than last week, and by how much)
  2. Where the load is concentrated (which department/category, and any SLA or
     escalation concerns worth flagging)
  3. A brief, constructive closing note — either reassurance that things are
     on track, or a specific, actionable suggestion if something needs attention

Keep the entire report under 180 words. Do not invent numbers that were not
given to you. Do not use markdown formatting, headers, or bullet points —
write flowing prose paragraphs only, since this needs to read like something
a human analyst wrote, not a generated report."""


def _build_narrative_prompt(data: dict) -> str:
    """Turns the structured weekly dataset into a plain-language prompt
    the AI model can summarize, so the model never has to interpret raw
    JSON or invent figures on its own."""
    v = data["volume"]
    change_line = (
        f"{v['created_change_pct']:+.1f}% versus last week"
        if v["created_change_pct"] is not None
        else "no prior-week data to compare against"
    )
    busiest = data["busiest_department"]
    busiest_line = (
        f"{busiest['name']} ({busiest['count']} tickets)" if busiest else "no single department standing out"
    )
    resolution_line = (
        f"{data['avg_resolution_hours']} hours" if data["avg_resolution_hours"] is not None else "not enough resolved tickets yet to calculate"
    )

    return (
        f"Tickets created this week: {v['created_this_week']} ({change_line}).\n"
        f"Tickets resolved this week: {v['resolved_this_week']} (was {v['resolved_last_week']} last week).\n"
        f"Busiest department: {busiest_line}.\n"
        f"Priority mix this week: {data['by_priority']}.\n"
        f"SLA breach rate this week: {data['sla']['breach_rate']}% "
        f"({data['sla']['breached']} of {data['sla']['total']} tickets).\n"
        f"Average resolution time this week: {resolution_line}.\n"
        f"Tickets escalated this week: {data['escalated_this_week']}.\n\n"
        f"Write the 3-paragraph weekly summary report now."
    )


def _template_narrative(data: dict) -> str:
    """
    Fallback narrative used when no GROQ_API_KEY is configured. Built
    from simple sentence templates rather than an LLM call, but still
    grounded entirely in the real numbers passed in — never placeholder
    or invented figures — so the report is honest even without AI text
    generation available.
    """
    v = data["volume"]
    busiest = data["busiest_department"]

    if v["created_change_pct"] is None:
        trend_sentence = (
            f"The platform received {v['created_this_week']} new tickets this week. "
            f"This is the first full week of data, so there is no prior week to compare against yet."
        )
    elif v["created_change_pct"] > 0:
        trend_sentence = (
            f"Ticket volume rose this week, with {v['created_this_week']} new tickets received "
            f"compared to {v['created_last_week']} the week before — an increase of {v['created_change_pct']}%."
        )
    elif v["created_change_pct"] < 0:
        trend_sentence = (
            f"Ticket volume eased this week, with {v['created_this_week']} new tickets received "
            f"compared to {v['created_last_week']} the week before — a decrease of {abs(v['created_change_pct'])}%."
        )
    else:
        trend_sentence = (
            f"Ticket volume held steady this week at {v['created_this_week']} new tickets, "
            f"unchanged from the previous week."
        )

    if busiest:
        focus_sentence = (
            f"{busiest['name']} generated the most activity this week with {busiest['count']} tickets logged."
        )
    else:
        focus_sentence = "Activity was spread fairly evenly across departments this week, with no single area standing out."

    sla = data["sla"]
    if sla["total"] == 0:
        sla_sentence = "No new tickets were logged against an SLA deadline this week."
    elif sla["breach_rate"] == 0:
        sla_sentence = "Every ticket created this week is currently tracking within its SLA window."
    elif sla["breach_rate"] < 10:
        sla_sentence = f"SLA performance remained strong, with only {sla['breach_rate']}% of this week's tickets breaching their deadline."
    else:
        sla_sentence = (
            f"SLA performance needs attention: {sla['breach_rate']}% of this week's tickets "
            f"({sla['breached']} of {sla['total']}) breached their deadline."
        )

    if data["escalated_this_week"] > 0:
        closing_sentence = (
            f"{data['escalated_this_week']} ticket(s) were escalated this week and may warrant a follow-up review "
            f"to confirm they are progressing."
        )
    else:
        closing_sentence = "No tickets were escalated this week, which is a positive sign for overall service stability."

    return (
        f"{trend_sentence} {focus_sentence}\n\n"
        f"{sla_sentence} "
        + (
            f"The average resolution time across tickets closed this week was {data['avg_resolution_hours']} hours."
            if data["avg_resolution_hours"] is not None
            else "No tickets were resolved this week, so an average resolution time cannot yet be calculated."
        )
        + f"\n\n{closing_sentence} Overall, the team should continue monitoring "
        f"{busiest['name'] if busiest else 'all departments'} closely heading into next week."
    )


async def generate_weekly_narrative(data: dict) -> dict:
    """
    Generates the written weekly summary paragraph(s) from the structured
    dataset. Tries GROQ first (for genuinely fluent, varied prose); falls
    back to the deterministic template above if no API key is configured
    or the call fails for any reason — mirroring the exact fallback
    pattern used by generate_auto_response() in response_service.py, so
    this feature degrades the same way the rest of the app's AI features do.
    """
    if settings.GROQ_API_KEY and not settings.GROQ_API_KEY.startswith("gsk_your"):
        try:
            from groq import AsyncGroq
            groq = AsyncGroq(api_key=settings.GROQ_API_KEY)
            response = await groq.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[
                    {"role": "system", "content": NARRATIVE_SYSTEM_PROMPT},
                    {"role": "user", "content": _build_narrative_prompt(data)},
                ],
                temperature=0.4,
                max_tokens=350,
            )
            text = response.choices[0].message.content.strip()
            return {"narrative": text, "generated_by": "groq"}
        except Exception as e:
            print(f"[WeeklyInsights] GROQ failed: {e} — using template")

    return {"narrative": _template_narrative(data), "generated_by": "template"}


async def build_weekly_insights(db: AsyncSession) -> dict:
    """Main entry point used by the API layer: builds the dataset, then
    generates the narrative on top of it, and returns both together."""
    data = await _build_weekly_dataset(db)
    narrative_result = await generate_weekly_narrative(data)
    return {
        **data,
        "narrative":     narrative_result["narrative"],
        "generated_by":  narrative_result["generated_by"],
        "generated_at":  utcnow().isoformat(),
    }
