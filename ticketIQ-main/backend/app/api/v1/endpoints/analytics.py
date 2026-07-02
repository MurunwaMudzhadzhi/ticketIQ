"""
TicketIQ — Analytics Endpoints
=================================
Powers the admin analytics dashboard: every endpoint here answers a
"what does the data currently look like" question by running
aggregate queries (COUNT, GROUP BY) against the tickets table — none of
these endpoints create or modify any data, they're read-only reporting.

  GET /analytics/overview          — top-line KPI numbers for the dashboard header
  GET /analytics/by-department     — ticket volume per department
  GET /analytics/by-priority       — ticket volume per priority level
  GET /analytics/by-status         — ticket volume per status
  GET /analytics/agent-performance — per-agent ticket load + resolution rate
  GET /analytics/sla               — SLA breach/at-risk/on-track breakdown
  GET /analytics/trends            — daily ticket volume for the last 7 days
  GET /analytics/recent-activity   — latest audit log entries, for the activity feed
  GET /analytics/weekly-insights(/download) — Sprint 2's written weekly summary report

All of these require a logged-in user (via get_current_user) but,
unlike the ticket endpoints, don't currently restrict by role — any
logged-in user could technically call these, even though in practice
only the admin-only frontend page links to them. If stricter access
control is ever needed here, see require_roles() in core/deps.py.
"""
from typing import Optional
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.models import Ticket, TicketStatus, TicketPriority, User, Department, AuditLog
from app.services.analytics.weekly_insights import build_weekly_insights
from datetime import datetime, timedelta, timezone

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
async def overview(
    department_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    The headline numbers shown across the top of the analytics
    dashboard: total tickets, a count for every status, critical-priority
    count, SLA breaches, escalations, and an overall resolution rate.
    Each count below is its own small query — straightforward to read,
    though it does mean this endpoint makes quite a few round-trips to
    the database; fine at this app's scale, but worth knowing if ticket
    volume ever grows large enough that this needs combining into fewer
    queries.
    """
    dept_filter = (Ticket.department_id == department_id) if department_id else True
    total       = (await db.execute(select(func.count(Ticket.id)).where(dept_filter))).scalar() or 0
    open_c      = (await db.execute(select(func.count(Ticket.id)).where(Ticket.status == TicketStatus.open, dept_filter))).scalar() or 0
    pending     = (await db.execute(select(func.count(Ticket.id)).where(Ticket.status == TicketStatus.pending, dept_filter))).scalar() or 0
    assigned    = (await db.execute(select(func.count(Ticket.id)).where(Ticket.status == TicketStatus.assigned, dept_filter))).scalar() or 0
    in_progress = (await db.execute(select(func.count(Ticket.id)).where(Ticket.status == TicketStatus.in_progress, dept_filter))).scalar() or 0
    escalated_c = (await db.execute(select(func.count(Ticket.id)).where(Ticket.status == TicketStatus.escalated, dept_filter))).scalar() or 0
    resolved    = (await db.execute(select(func.count(Ticket.id)).where(Ticket.status == TicketStatus.resolved, dept_filter))).scalar() or 0
    closed      = (await db.execute(select(func.count(Ticket.id)).where(Ticket.status == TicketStatus.closed, dept_filter))).scalar() or 0
    critical    = (await db.execute(select(func.count(Ticket.id)).where(Ticket.priority == TicketPriority.critical, dept_filter))).scalar() or 0
    sla_breached= (await db.execute(select(func.count(Ticket.id)).where(Ticket.sla_breached == True, dept_filter))).scalar() or 0
    escalated_f = (await db.execute(select(func.count(Ticket.id)).where(Ticket.is_escalated == True, dept_filter))).scalar() or 0
    total_users = (await db.execute(select(func.count(User.id)).where(User.is_active == True))).scalar() or 0

    resolution_rate = round((resolved + closed) / total * 100, 1) if total else 0

    return {
        "total":           total,
        "open":            open_c,
        "pending":         pending,
        "assigned":        assigned,
        "in_progress":     in_progress,
        "escalated":       escalated_f,
        "escalated_status":escalated_c,
        "resolved":        resolved,
        "closed":          closed,
        "critical":        critical,
        "sla_breached":    sla_breached,
        "resolution_rate": resolution_rate,
        "total_users":     total_users,
    }


@router.get("/by-department")
async def by_department(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Ticket count (and resolved count) per department — feeds the bar
    chart on the dashboard showing which business unit generates the
    most support load. `isouter=True` on the join means a department
    with zero tickets still appears in the results with count=0, rather
    than being silently dropped by a normal inner join.
    """
    result = await db.execute(
        select(Department.name, Department.color,
               func.count(Ticket.id).label("count"))
        .join(Ticket, Ticket.department_id == Department.id, isouter=True)
        .group_by(Department.id)
        .order_by(func.count(Ticket.id).desc())
    )
    rows = result.all()

    # also get resolved per dept
    resolved_rows = await db.execute(
        select(Department.name, func.count(Ticket.id).label("resolved"))
        .join(Ticket, Ticket.department_id == Department.id, isouter=True)
        .where(Ticket.status.in_([TicketStatus.resolved, TicketStatus.closed]))
        .group_by(Department.id)
    )
    resolved_map = {r.name: r.resolved for r in resolved_rows}

    return [
        {
            "name":     r.name,
            "color":    r.color,
            "count":    r.count,
            "resolved": resolved_map.get(r.name, 0),
        }
        for r in rows
    ]


@router.get("/by-priority")
async def by_priority(
    department_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ticket count per priority level (critical/high/medium/low) — feeds the priority breakdown chart."""
    result = await db.execute(
        select(Ticket.priority, func.count(Ticket.id).label("count"))
        .group_by(Ticket.priority)
    )
    return [
        {"priority": r.priority.value if hasattr(r.priority, "value") else r.priority, "count": r.count}
        for r in result
    ]


@router.get("/by-status")
async def by_status(
    department_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ticket count per status (open/assigned/in_progress/etc) — feeds the status breakdown chart."""
    dept_filter = (Ticket.department_id == department_id) if department_id else True
    result = await db.execute(
        select(Ticket.status, func.count(Ticket.id).label("count"))
        .where(dept_filter)
        .group_by(Ticket.status)
    )
    return [
        {"status": r.status.value if hasattr(r.status, "value") else r.status, "count": r.count}
        for r in result
    ]


@router.get("/agent-performance")
async def agent_performance(
    department_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Per-agent breakdown: how many tickets each support agent has in
    total, how many they've resolved, how many are still in progress
    or escalated, and their overall resolution rate. Powers the agent
    leaderboard table on the dashboard, sorted by total ticket volume
    (busiest agent first).
    """
    agent_roles = ["ai_intern", "it_support_technician", "junior_operations"]
    agents = (await db.execute(
        select(User).where(User.agent_role_key.in_(agent_roles), User.is_active == True)
    )).scalars().all()

    result = []
    for agent in agents:
        dept_filter = (Ticket.department_id == department_id) if department_id else True
        total_a   = (await db.execute(select(func.count(Ticket.id)).where(Ticket.assigned_agent_id == agent.id, dept_filter))).scalar() or 0
        resolved_a= (await db.execute(select(func.count(Ticket.id)).where(
            Ticket.assigned_agent_id == agent.id,
            Ticket.status.in_([TicketStatus.resolved, TicketStatus.closed]),
            dept_filter
        ))).scalar() or 0
        in_prog_a = (await db.execute(select(func.count(Ticket.id)).where(
            Ticket.assigned_agent_id == agent.id,
            Ticket.status == TicketStatus.in_progress,
            dept_filter
        ))).scalar() or 0
        escalated_a=(await db.execute(select(func.count(Ticket.id)).where(
            Ticket.assigned_agent_id == agent.id,
            Ticket.is_escalated == True,
            dept_filter
        ))).scalar() or 0
        resolved_rows_a = (await db.execute(select(Ticket.created_at, Ticket.resolved_at).where(
            Ticket.assigned_agent_id == agent.id, Ticket.resolved_at.isnot(None), dept_filter
        ))).all()
        if resolved_rows_a:
            total_hours_a = sum((r.resolved_at - r.created_at).total_seconds() / 3600 for r in resolved_rows_a)
            avg_resolution_hours_a = round(total_hours_a / len(resolved_rows_a), 1)
        else:
            avg_resolution_hours_a = None

        resolution_rate = round(resolved_a / total_a * 100, 1) if total_a else 0

        result.append({
            "id":                   str(agent.id),
            "name":                 agent.full_name,
            "role":                 agent.agent_role_key,
            "total":                total_a,
            "resolved":             resolved_a,
            "in_progress":          in_prog_a,
            "escalated":            escalated_a,
            "resolution_rate":      resolution_rate,
            "avg_resolution_hours": avg_resolution_hours_a,
        })

    return sorted(result, key=lambda x: x["total"], reverse=True)


@router.get("/sla")
async def sla_stats(
    department_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    SLA performance breakdown across three buckets:
      breached  — sla_breached flag is already True
      at_risk   — not yet breached, but the deadline is within 4 hours
                  and the ticket is still unresolved (an early-warning
                  bucket, distinct from actually breached)
      on_track  — everything else (computed as a remainder, not a
                  separate query, since it's just total minus the other two)
    Also breaks the same breach rate down per priority level, since a
    breach on a critical ticket is a very different signal than a
    breach on a low-priority one.
    """
    now = datetime.now(timezone.utc)
    dept_filter = (Ticket.department_id == department_id) if department_id else True
    total       = (await db.execute(select(func.count(Ticket.id)).where(dept_filter))).scalar() or 0
    breached    = (await db.execute(select(func.count(Ticket.id)).where(Ticket.sla_breached == True, dept_filter))).scalar() or 0
    at_risk     = (await db.execute(select(func.count(Ticket.id)).where(
        Ticket.sla_deadline != None,
        Ticket.sla_breached == False,
        Ticket.status.notin_([TicketStatus.resolved, TicketStatus.closed]),
        Ticket.sla_deadline <= datetime.now(timezone.utc) + timedelta(hours=4),
    ))).scalar() or 0
    on_track    = total - breached - at_risk

    resolved_rows = (await db.execute(select(Ticket.created_at, Ticket.resolved_at).where(
        Ticket.resolved_at.isnot(None), dept_filter
    ))).all()
    if resolved_rows:
        total_hours = sum((r.resolved_at - r.created_at).total_seconds() / 3600 for r in resolved_rows)
        avg_resolution_hours = round(total_hours / len(resolved_rows), 1)
    else:
        avg_resolution_hours = None

    by_priority = []
    for prio in [TicketPriority.critical, TicketPriority.high, TicketPriority.medium, TicketPriority.low]:
        t = (await db.execute(select(func.count(Ticket.id)).where(Ticket.priority == prio))).scalar() or 0
        b = (await db.execute(select(func.count(Ticket.id)).where(
            Ticket.priority == prio, Ticket.sla_breached == True
        ))).scalar() or 0
        by_priority.append({
            "priority": prio.value,
            "total":    t,
            "breached": b,
            "rate":     round(b / t * 100, 1) if t else 0,
        })

    return {
        "total":    total,
        "breached": breached,
        "at_risk":  at_risk,
        "on_track": max(on_track, 0),
        "breach_rate": round(breached / total * 100, 1) if total else 0,
        "avg_resolution_hours": avg_resolution_hours,
        "by_priority": by_priority,
    }


@router.get("/trends")
async def trends(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Last 7 days ticket volume by day."""
    days = []
    for i in range(6, -1, -1):
        day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=i)
        day_end   = day_start + timedelta(days=1)
        created   = (await db.execute(select(func.count(Ticket.id)).where(
            Ticket.created_at >= day_start, Ticket.created_at < day_end
        ))).scalar() or 0
        resolved  = (await db.execute(select(func.count(Ticket.id)).where(
            Ticket.resolved_at >= day_start, Ticket.resolved_at < day_end
        ))).scalar() or 0
        days.append({
            "date":     day_start.strftime("%a"),
            "created":  created,
            "resolved": resolved,
        })
    return days


@router.get("/recent-activity")
async def recent_activity(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    The 15 most recent audit log entries (ticket created, status
    changed, escalated, etc), joined with who performed the action and
    which ticket it relates to — powers the live activity feed on the
    dashboard. `isouter=True` on both joins means an entry still shows
    up even if its user or ticket has since been deleted, falling back
    to "System" / null rather than disappearing from the feed entirely.
    """
    result = await db.execute(
        select(AuditLog, User, Ticket)
        .join(User, AuditLog.user_id == User.id, isouter=True)
        .join(Ticket, AuditLog.ticket_id == Ticket.id, isouter=True)
        .order_by(AuditLog.created_at.desc())
        .limit(15)
    )
    rows = result.all()
    return [
        {
            "action":      r.AuditLog.action,
            "details":     r.AuditLog.details,
            "created_at":  r.AuditLog.created_at.isoformat() if r.AuditLog.created_at else None,
            "user":        r.User.full_name if r.User else "System",
            "ticket":      r.Ticket.ticket_number if r.Ticket else None,
            "ticket_title":r.Ticket.title if r.Ticket else None,
        }
        for r in rows
    ]


# ─────────────────────────────────────────────────────────────────────────
# WEEKLY INSIGHTS — Sprint 2 deliverable: "Generate weekly summary insights"
# All the heavy lifting (data aggregation + narrative generation) lives in
# services/analytics/weekly_insights.py; these two endpoints just expose
# it over HTTP — one as JSON for the dashboard widget, one as a downloadable
# plain-text file for the "Download report" button.
# ─────────────────────────────────────────────────────────────────────────

@router.get("/weekly-insights")
async def weekly_insights(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns this week's structured stats (volume, busiest department,
    SLA performance, average resolution time) together with a short
    AI-generated (or template-generated, if no AI key is configured)
    written narrative summarizing them — the data the dashboard's
    'Weekly Insights' panel renders.
    """
    return await build_weekly_insights(db)


def _format_report_as_text(insights: dict) -> str:
    """
    Renders the weekly insights payload as a clean plain-text report,
    used by the download endpoint below. Kept separate from the dashboard
    JSON shape so the downloaded file reads like an actual report a
    human would write, not a dump of a JSON object.
    """
    period_start = datetime.fromisoformat(insights["period"]["start"]).strftime("%d %b %Y")
    period_end   = datetime.fromisoformat(insights["period"]["end"]).strftime("%d %b %Y")
    v   = insights["volume"]
    sla = insights["sla"]

    lines = [
        "TICKETIQ — WEEKLY INSIGHTS REPORT",
        f"Reporting period: {period_start} – {period_end}",
        f"Generated: {datetime.fromisoformat(insights['generated_at']).strftime('%d %b %Y, %H:%M UTC')}",
        "=" * 60,
        "",
        "SUMMARY",
        "-" * 60,
        insights["narrative"],
        "",
        "KEY FIGURES",
        "-" * 60,
        f"Tickets created this week:   {v['created_this_week']}  (last week: {v['created_last_week']})",
        f"Tickets resolved this week:  {v['resolved_this_week']}  (last week: {v['resolved_last_week']})",
        f"SLA breach rate this week:   {sla['breach_rate']}%  ({sla['breached']} of {sla['total']} tickets)",
        f"Average resolution time:     {insights['avg_resolution_hours']} hours" if insights["avg_resolution_hours"] is not None else "Average resolution time:     n/a (no tickets resolved this week)",
        f"Tickets escalated this week: {insights['escalated_this_week']}",
        "",
        "TICKETS BY DEPARTMENT (this week)",
        "-" * 60,
    ]
    if insights["by_department"]:
        for dept in insights["by_department"]:
            lines.append(f"  {dept['name']:<28} {dept['count']}")
    else:
        lines.append("  No tickets logged this week.")

    lines += [
        "",
        "TICKETS BY PRIORITY (this week)",
        "-" * 60,
    ]
    if insights["by_priority"]:
        for prio, count in insights["by_priority"].items():
            lines.append(f"  {prio.capitalize():<28} {count}")
    else:
        lines.append("  No tickets logged this week.")

    lines += [
        "",
        "=" * 60,
        f"Report generated by TicketIQ ({insights['generated_by']} narrative engine).",
    ]
    return "\n".join(lines)


def _escape_pdf_string(value: str) -> str:
    return value.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def _render_report_as_pdf_bytes(insights: dict) -> bytes:
    report_text = _format_report_as_text(insights)
    lines = report_text.splitlines()
    content_lines = [
        b"BT\n/F1 10 Tf\n72 760 Td\n14 TL\n",
    ]
    for line in lines:
        escaped = _escape_pdf_string(line)
        content_lines.append(f"({escaped}) Tj\nT*\n".encode("latin-1", "replace"))
    content_lines.append(b"ET")
    content = b"".join(content_lines)

    def pdf_object(obj_num: int, body: bytes) -> bytes:
        return f"{obj_num} 0 obj\n".encode("ascii") + body + b"\nendobj\n"

    objects = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objects.append(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
    )
    objects.append(
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream"
    )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")

    pdf = b"%PDF-1.3\n%\xE2\xE3\xCF\xD3\n"
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += pdf_object(i, obj)

    xref_start = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    pdf += b"0000000000 65535 f \n"
    for offset in offsets:
        pdf += f"{offset:010d} 00000 n \n".encode("ascii")
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n".encode("ascii")

    return pdf


@router.get("/weekly-insights/download")
async def download_weekly_insights(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Same data as GET /analytics/weekly-insights, rendered as a downloadable
    .pdf file. Returning Response with a Content-Disposition header
    (rather than JSON) is what makes the browser treat this as a download
    instead of just displaying it.
    """
    insights = await build_weekly_insights(db)
    pdf_bytes = _render_report_as_pdf_bytes(insights)
    filename = f"ticketiq-weekly-insights-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
