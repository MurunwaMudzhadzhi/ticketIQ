"""
TicketIQ — Ticket Endpoints
==============================
The largest and most central route group in the app — everything to do
with creating, viewing, updating, and discussing support tickets:

  GET    /tickets/                          — list tickets (filtered by who's asking)
  POST   /tickets/                          — submit a new ticket (employees only)
  GET    /tickets/{id}                      — full ticket detail + comments
  PATCH  /tickets/{id}/status               — change status (open/in_progress/resolved/etc)
  PATCH  /tickets/{id}/assign                — (re)assign a ticket to a specific agent
  POST   /tickets/{id}/escalate              — flag a ticket as escalated
  POST   /tickets/{id}/comments              — add a reply/note to a ticket
  GET    /tickets/{id}/ai-reply              — generate a free-text AI draft reply
  POST   /tickets/{id}/auto-response         — generate one templated/AI auto-response
  GET    /tickets/{id}/auto-response/all-tones — generate all 3 tone variants at once
  GET    /tickets/{id}/self-help             — generate self-help steps for the employee

The actual AI classification + routing logic does NOT live here — see
services/tickets/ticket_service.py (the routing pipeline) and
services/ai/groq_service.py / services/ai/response_service.py (the AI
calls themselves). This file is the HTTP layer on top of those.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import uuid

from app.db.session import get_db
from app.core.deps import get_current_user, is_admin, is_agent
from app.models.models import Ticket, TicketStatus, User, TicketComment, AuditLog
from app.services.tickets.ticket_service import create_ticket, get_tickets_for_user, AGENT_ROLES
from app.services.ai.groq_service import generate_ai_reply

router = APIRouter(prefix="/tickets", tags=["tickets"])


def _ticket_to_dict(t: Ticket) -> dict:
    """
    Converts a Ticket database row (with its relationships already
    loaded — see the `selectinload(...)` calls throughout this file)
    into the plain dict shape sent to the frontend. Centralizing this in
    one function means every endpoint that returns ticket data uses the
    exact same shape, so the frontend only has to know one "ticket
    object" format.

    The nested "ai" block exposes the full routing/classification
    record stored on the ticket (see Ticket.ai_classification in
    models.py and ticket_service.py for how it's built) — this is what
    lets the frontend show "why" a ticket was routed where it was, not
    just where it ended up.

    `has_ai_reply` is a cheap boolean (rather than the full comment
    list) indicating whether an AI-generated comment exists yet — used
    by dashboard pages that need to know "has this been auto-replied
    to" without needing every comment's full text. Only get_ticket()
    (the single-ticket detail endpoint) includes the full comments
    array separately; list responses rely on this flag instead.
    """
    ai = t.ai_classification or {}
    has_ai_reply = any(c.is_ai for c in (t.comments or []))
    return {
        "id":              t.id,
        "ticket_number":   t.ticket_number,
        "title":           t.title,
        "description":     t.description,
        "status":          t.status.value if hasattr(t.status, "value") else str(t.status),
        "priority":        t.priority.value if hasattr(t.priority, "value") else str(t.priority),
        "is_escalated":    t.is_escalated,
        "sla_deadline":    t.sla_deadline.isoformat() if t.sla_deadline else None,
        "sla_breached":    t.sla_breached,
        "has_ai_reply":    has_ai_reply,
        "resolution_note": t.resolution_note,
        "created_at":      t.created_at.isoformat() if t.created_at else None,
        "updated_at":      t.updated_at.isoformat() if t.updated_at else None,
        "resolved_at":     t.resolved_at.isoformat() if t.resolved_at else None,
        "department": {
            "id":    t.department.id,
            "name":  t.department.name,
            "slug":  t.department.slug,
            "color": t.department.color,
        } if t.department else None,
        "submitter": {
            "id":        t.submitter.id,
            "full_name": t.submitter.full_name,
            "email":     t.submitter.email,
        } if t.submitter else None,
        "assigned_agent": {
            "id":             t.assigned_agent.id,
            "full_name":      t.assigned_agent.full_name,
            "agent_role_key": t.assigned_agent.agent_role_key,
        } if t.assigned_agent else None,
        # Full AI routing intelligence exposed to the frontend
        "ai": {
            "department_slug":      ai.get("department_slug"),
            "category":             ai.get("category"),
            "sentiment":            ai.get("sentiment"),
            "confidence":           ai.get("selection_confidence"),
            "summary":              ai.get("summary"),
            "priority_reason":      ai.get("priority_reason"),
            # Tokenization data
            "skill_tokens":         ai.get("skill_tokens", []),
            "token_weights":        ai.get("token_weights", {}),
            "token_match_score":    ai.get("token_match_score"),
            # Routing decision
            "routed_to_role":       ai.get("routed_to_role"),
            "routed_to_agent_name": ai.get("routed_to_agent_name"),
            "routing_rationale":    ai.get("routing_rationale"),
            "selected_by":          ai.get("selected_by"),
            "classified_by":        ai.get("classified_by"),
        },
    }


# ─── Request bodies ───────────────────────────────────────────────────────────

class CreateTicketRequest(BaseModel):
    title: str
    description: str


class UpdateStatusRequest(BaseModel):
    status: str
    resolution_note: Optional[str] = None


class AssignRequest(BaseModel):
    agent_id: str


class EscalateRequest(BaseModel):
    reason: str


class CommentRequest(BaseModel):
    content: str
    is_internal: bool = False


@router.get("/")
async def list_tickets(
    status:       Optional[str] = Query(None),
    priority:     Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """
    Lists tickets visible to the current user — what "visible" means
    depends on their role (see get_tickets_for_user() in
    ticket_service.py: employees see only their own, agents see only
    what's assigned to them, admins see everything). Optional
    status/priority query params narrow the results further.
    """
    params = {}
    if status:   params["status"]   = status
    if priority: params["priority"] = priority
    tickets = await get_tickets_for_user(db, current_user, params)
    return {"tickets": [_ticket_to_dict(t) for t in tickets], "total": len(tickets)}


@router.post("/")
async def create_new_ticket(
    req:          CreateTicketRequest,
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """
    Submits a new support ticket. Only employees (and admins, who can
    submit on anyone's behalf) are allowed — support agents don't file
    tickets through this same flow. The actual classification/routing
    work is entirely delegated to create_ticket() in ticket_service.py;
    this handler's only extra responsibility is logging an audit trail
    entry recording how the AI routed it.
    """
    role_val = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    if role_val not in ("employee", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Only employees can submit tickets")

    ticket = await create_ticket(db, req.title, req.description, current_user.id)

    db.add(AuditLog(
        id=str(uuid.uuid4()),
        ticket_id=ticket.id,
        user_id=current_user.id,
        action="ticket_created",
        details={
            "title":            req.title,
            "ai_dept":          (ticket.ai_classification or {}).get("department_slug"),
            "ai_agent":         (ticket.ai_classification or {}).get("routed_to_agent_name"),
            "token_match_score":(ticket.ai_classification or {}).get("token_match_score"),
        },
    ))

    return _ticket_to_dict(ticket)


@router.get("/{ticket_id}")
async def get_ticket(
    ticket_id:    str,
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """
    Returns full detail for a single ticket, including its comment
    thread (sorted oldest-first, so it reads top-to-bottom like a
    conversation). Note this endpoint does NOT currently check whether
    current_user is actually allowed to view this specific ticket (e.g.
    an employee could view another employee's ticket by guessing/
    obtaining its ID) — list_tickets() above filters correctly, but
    direct-by-ID access has no equivalent ownership check.
    """
    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.department),
            selectinload(Ticket.submitter),
            selectinload(Ticket.assigned_agent),
            selectinload(Ticket.comments).selectinload(TicketComment.author),
        )
        .where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    data = _ticket_to_dict(ticket)
    data["comments"] = [
        {
            "id":          c.id,
            "content":     c.content,
            "is_internal": c.is_internal,
            "is_ai":       c.is_ai,
            "created_at":  c.created_at.isoformat(),
            "author": {
                "full_name": c.author.full_name,
                "role":      c.author.role.value if c.author else "unknown",
            } if c.author else None,
        }
        for c in sorted(ticket.comments, key=lambda x: x.created_at)
    ]
    return data


@router.patch("/{ticket_id}/status")
async def update_status(
    ticket_id:    str,
    req:          UpdateStatusRequest,
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """
    Updates a ticket's status (e.g. open -> in_progress -> resolved).
    Automatically stamps `resolved_at` the moment a ticket reaches
    "resolved" or "closed" — this timestamp is what the weekly insights
    report (services/analytics/weekly_insights.py) uses to calculate
    average resolution time, so keeping it accurate here matters beyond
    just this one endpoint.
    """
    result = await db.execute(
        select(Ticket).options(
            selectinload(Ticket.department),
            selectinload(Ticket.submitter),
            selectinload(Ticket.assigned_agent),
            selectinload(Ticket.comments),  # needed for _ticket_to_dict()'s has_ai_reply check
        ).where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    try:
        ticket.status = TicketStatus(req.status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid status: {req.status}")

    if req.resolution_note:
        ticket.resolution_note = req.resolution_note
    if req.status in ("resolved", "closed"):
        ticket.resolved_at = datetime.now(timezone.utc)

    db.add(AuditLog(
        id=str(uuid.uuid4()),
        ticket_id=ticket.id,
        user_id=current_user.id,
        action="status_changed",
        details={"new_status": req.status},
    ))
    return _ticket_to_dict(ticket)


@router.patch("/{ticket_id}/assign")
async def assign_ticket(
    ticket_id:    str,
    req:          AssignRequest,
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """
    Manually (re)assigns a ticket to a specific agent — used when an
    admin wants to override the AI's automatic routing decision.

    IMPORTANT VALIDATION: `agent_id` is checked against the database
    before being saved — it must belong to a real, active user who
    actually holds one of the three agent roles (AGENT_ROLES, see
    ticket_service.py). Without this check, the endpoint would happily
    write any string at all into assigned_agent_id, silently producing
    a ticket "assigned" to a non-existent or non-agent user that would
    then never show up in anyone's ticket queue — an easy way for a
    ticket to quietly fall through the cracks.
    """
    if not (is_agent(current_user) or is_admin(current_user)):
        raise HTTPException(status_code=403, detail="Only agents/admins can assign tickets")

    result = await db.execute(
        select(Ticket).options(
            selectinload(Ticket.department),
            selectinload(Ticket.submitter),
            selectinload(Ticket.assigned_agent),
            selectinload(Ticket.comments),  # needed for _ticket_to_dict()'s has_ai_reply check
        ).where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Validate the target agent actually exists, is active, and holds
    # one of the recognised agent roles before assigning — see the
    # docstring above for why this matters.
    agent_result = await db.execute(
        select(User).where(
            User.id == req.agent_id,
            User.is_active == True,
            User.agent_role_key.in_(AGENT_ROLES),
        )
    )
    target_agent = agent_result.scalar_one_or_none()
    if not target_agent:
        raise HTTPException(
            status_code=400,
            detail="agent_id must belong to an active support agent.",
        )

    ticket.assigned_agent_id = target_agent.id
    ticket.status = TicketStatus.assigned

    # Update the stored classification record to reflect that a human
    # admin/agent just overrode the routing decision — without this,
    # ai.selected_by would keep showing whatever the ORIGINAL AI
    # decision was (e.g. "groq_agent_selection") even after a manual
    # reassignment, making the frontend's "AI Assigned" badge (see
    # tickets/[id]/page.tsx) misleadingly claim AI credit for an
    # assignment a human actually made.
    updated_classification = dict(ticket.ai_classification or {})
    updated_classification["routed_to_agent_id"]   = target_agent.id
    updated_classification["routed_to_agent_name"] = target_agent.full_name
    updated_classification["routed_to_role"]       = target_agent.agent_role_key
    updated_classification["selected_by"]          = "manual_override"
    updated_classification["routing_rationale"]    = f"Manually reassigned by {current_user.full_name}."
    ticket.ai_classification = updated_classification

    await db.flush()
    await db.refresh(ticket, attribute_names=["assigned_agent"])
    return _ticket_to_dict(ticket)


@router.post("/{ticket_id}/escalate")
async def escalate_ticket(
    ticket_id:    str,
    req:          EscalateRequest,
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """
    Marks a ticket as escalated (typically because it's overdue,
    high-impact, or the assigned agent needs senior help). Records the
    reason in the audit log so there's a traceable history of why and
    when escalations happened, separate from the ticket's own
    resolution_note field.
    """
    result = await db.execute(
        select(Ticket).options(
            selectinload(Ticket.department),
            selectinload(Ticket.submitter),
            selectinload(Ticket.assigned_agent),
            selectinload(Ticket.comments),  # needed for _ticket_to_dict()'s has_ai_reply check
        ).where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ticket.is_escalated = True
    ticket.status = TicketStatus.escalated
    db.add(AuditLog(
        id=str(uuid.uuid4()),
        ticket_id=ticket.id,
        user_id=current_user.id,
        action="ticket_escalated",
        details={"reason": req.reason},
    ))
    return _ticket_to_dict(ticket)


@router.post("/{ticket_id}/comments")
async def add_comment(
    ticket_id:    str,
    req:          CommentRequest,
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """
    Adds a comment/reply to a ticket's thread. `is_internal` marks a
    note meant only for agents/admins, never shown to the employee who
    submitted the ticket — used for things like "checking with vendor,
    will update employee once confirmed" that shouldn't be visible to
    the person waiting on the ticket.
    """
    comment = TicketComment(
        id=str(uuid.uuid4()),
        ticket_id=ticket_id,
        author_id=current_user.id,
        content=req.content,
        is_internal=req.is_internal,
    )
    db.add(comment)
    await db.flush()
    return {
        "id":          comment.id,
        "content":     comment.content,
        "is_internal": comment.is_internal,
        "created_at":  comment.created_at.isoformat(),
    }


@router.get("/{ticket_id}/ai-reply")
async def get_ai_reply(
    ticket_id:    str,
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """
    Generates a free-text AI-drafted reply an agent could send,
    using generate_ai_reply() from groq_service.py. This is distinct
    from the structured auto-response endpoints below — this one
    produces a fuller, more conversational draft rather than a short
    templated acknowledgement.
    """
    result = await db.execute(
        select(Ticket).options(selectinload(Ticket.department)).where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    dept_name = ticket.department.name if ticket.department else "Support"
    category  = (ticket.ai_classification or {}).get("category", "General")
    reply = await generate_ai_reply(ticket.title, ticket.description, dept_name, category)
    return {"reply": reply}


# ─── Automated Response Endpoints ─────────────────────────────────────────────
# These three endpoints all wrap services/ai/response_service.py's
# template/AI hybrid response generation, exposing it for: a single
# response in a chosen tone, all three tones at once (for the frontend's
# tone-picker UI), and self-help steps for the employee.

from app.services.ai.response_service import generate_auto_response, generate_all_tones

class AutoResponseRequest(BaseModel):
    tone:    str = "formal"   # formal | friendly | urgent
    trigger: str = "agent_reply"


@router.post("/{ticket_id}/auto-response")
async def auto_response(
    ticket_id:    str,
    req:          AutoResponseRequest,
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """Generate a single auto-response in the requested tone."""
    result = await db.execute(
        select(Ticket).options(selectinload(Ticket.department)).where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ai    = ticket.ai_classification or {}
    role  = current_user.agent_role_key if hasattr(current_user, "agent_role_key") else "admin"
    tone  = req.tone if req.tone in ("formal", "friendly", "urgent") else "formal"

    resp = await generate_auto_response(
        title       = ticket.title,
        description = ticket.description,
        category    = ai.get("category", "General Support"),
        department  = ticket.department.name if ticket.department else "Support",
        priority    = ticket.priority.value if hasattr(ticket.priority, "value") else str(ticket.priority),
        tone        = tone,
        agent_role  = role or "admin",
        trigger     = req.trigger,
    )
    return resp


@router.get("/{ticket_id}/auto-response/all-tones")
async def auto_response_all_tones(
    ticket_id:    str,
    trigger:      str = "agent_reply",
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """Generate responses in all 3 tones at once — for the tone-picker UI."""
    result = await db.execute(
        select(Ticket).options(selectinload(Ticket.department)).where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ai   = ticket.ai_classification or {}
    role = current_user.agent_role_key if hasattr(current_user, "agent_role_key") else "admin"

    resp = await generate_all_tones(
        title       = ticket.title,
        description = ticket.description,
        category    = ai.get("category", "General Support"),
        department  = ticket.department.name if ticket.department else "Support",
        priority    = ticket.priority.value if hasattr(ticket.priority, "value") else str(ticket.priority),
        agent_role  = role or "admin",
        trigger     = trigger,
    )
    return resp


@router.get("/{ticket_id}/self-help")
async def get_self_help(
    ticket_id:    str,
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """Return AI-generated self-help steps for the employee to try while waiting."""
    result = await db.execute(
        select(Ticket).options(selectinload(Ticket.department)).where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ai       = ticket.ai_classification or {}
    dept     = ticket.department.name if ticket.department else "Support"
    category = ai.get("category", "General Support")
    priority = ticket.priority.value if hasattr(ticket.priority, "value") else str(ticket.priority)

    if ai.get("is_on_topic") is False:
        # Same defense-in-depth backstop as the auto-response comment —
        # don't hand off-topic content to the LLM at all.
        return {
            "can_self_resolve": False,
            "confidence": 1.0,
            "summary": "This system only provides self-help steps for internal workplace (HR/IT/Finance/Operations) support tickets.",
            "steps": [],
            "escalate_if": "N/A — please submit a genuine workplace support ticket.",
            "useful_links": [],
            "generated_by": "policy",
        }

    from app.services.ai.response_service import generate_self_help
    return await generate_self_help(
        title       = ticket.title,
        description = ticket.description,
        category    = category,
        department  = dept,
        priority    = priority,
    )
