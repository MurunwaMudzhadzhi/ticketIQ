"""
Ticket Service — Universal Agent Routing via AI Tokenization
=============================================================
All agents are available for ALL departments.
Flow:
  1. GROQ tokenizes the ticket → extracts skill_tokens + token_weights
  2. All active agents are fetched from the DB (no role filter)
  3. AI scores each agent's skill profile against ticket tokens
  4. The single best-matched agent is assigned
  5. Load balancing is applied as a tiebreaker
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.models.models import Ticket, TicketStatus, TicketPriority, User, Department, TicketComment
from app.services.ai.groq_service import classify_ticket, select_agent_for_ticket
from app.services.ai.response_service import generate_auto_response

# How many hours each priority level is allowed before a ticket counts
# as having breached its SLA. Used to compute sla_deadline below.
SLA_HOURS = {"critical": 4, "high": 24, "medium": 72, "low": 168}

# The three agent_role_key values that mark a User account as a support
# agent (as opposed to an employee or admin) — see UserRole in models.py.
AGENT_ROLES = {"ai_intern", "it_support_technician", "junior_operations"}


async def generate_ticket_number(db: AsyncSession) -> str:
    """
    Generates the next human-friendly ticket number, e.g. "TIQ-1001",
    "TIQ-1002", and so on. Based on a simple count of existing tickets
    rather than a database auto-increment column, which keeps the
    numbering scheme independent of the underlying primary key (a UUID)
    used for `Ticket.id`.
    """
    result = await db.execute(select(func.count(Ticket.id)))
    count = result.scalar() or 0
    return f"TIQ-{count + 1001:04d}"


async def create_ticket(
    db: AsyncSession,
    title: str,
    description: str,
    submitter_id: str,
) -> Ticket:
    """
    Full ticket creation:
      Stage 1 — AI tokenizes ticket → department, priority, skill_tokens
      Stage 2 — AI scores all agents → picks single best-fit agent by ID

    This is the single function the /tickets POST endpoint calls — it
    owns the entire creation pipeline end to end: classify, route,
    save, and post the first automated response, so the endpoint itself
    stays a thin wrapper around this.
    """

    # ── Stage 1: Tokenize & Classify ────────────────────────────────────────
    # Hands the raw title/description to the AI classifier (or its
    # keyword fallback) — see services/ai/groq_service.py for the full
    # two-stage explanation. Returns which department this looks like,
    # how urgent it is, and a list of "skill tokens" describing the
    # expertise needed to resolve it.
    classification = await classify_ticket(title, description)

    dept_slug    = classification.get("department_slug", "it")
    priority_str = classification.get("priority", "medium")
    skill_tokens = classification.get("skill_tokens", [])
    token_weights = classification.get("token_weights", {t: 2 for t in skill_tokens})

    # ── Resolve Department ──────────────────────────────────────────────────
    dept_result = await db.execute(
        select(Department).where(Department.slug == dept_slug, Department.is_active == True)
    )
    department = dept_result.scalar_one_or_none()

    # ── Stage 2: Fetch ALL active agents + their current loads ──────────────
    # Note: this deliberately does NOT filter agents by department — any
    # of the three agent roles can be routed any ticket, with the actual
    # routing decision coming purely from skill-token matching in Stage 2.
    agents_result = await db.execute(
        select(User).where(
            User.agent_role_key.in_(AGENT_ROLES),
            User.is_active == True,
        )
    )
    all_agents = agents_result.scalars().all()

    # Build agent dicts with current load counts — "current_load" (how
    # many tickets this agent already has assigned and not yet
    # resolved) feeds into the load-balancing penalty inside
    # select_agent_for_ticket(), so routing doesn't pile every matching
    # ticket onto a single agent.
    agent_dicts = []
    for agent in all_agents:
        load_result = await db.execute(
            select(func.count(Ticket.id)).where(
                Ticket.assigned_agent_id == agent.id,
                Ticket.status.in_([TicketStatus.assigned, TicketStatus.in_progress]),
            )
        )
        agent_dicts.append({
            "id":             agent.id,
            "full_name":      agent.full_name,
            "agent_role_key": agent.agent_role_key,
            "current_load":   load_result.scalar() or 0,
        })

    # ── AI Agent Selection ──────────────────────────────────────────────────
    selection = await select_agent_for_ticket(skill_tokens, token_weights, agent_dicts)
    selected_agent_id = selection.get("selected_agent_id")

    # Merge selection details into classification result — this combined
    # dict is what gets stored as Ticket.ai_classification (see
    # models.py), so the full routing decision (which tokens matched,
    # which agent won, how confident the system was) is preserved
    # permanently alongside the ticket, not just used transiently.
    classification["routed_to_agent_id"]  = selected_agent_id
    classification["routing_rationale"]   = selection.get("routing_rationale", "")
    classification["selection_confidence"]= selection.get("selection_confidence", 0)
    classification["token_match_score"]   = selection.get("token_match_score", 0)
    classification["selected_by"]         = selection.get("selected_by", "unknown")

    # Resolve agent name for display — stored directly in the
    # classification JSON so the frontend can show "Routed to Leslie
    # Kekana" without an extra database join just to get a name.
    selected_agent = next((a for a in all_agents if a.id == selected_agent_id), None)
    if selected_agent:
        classification["routed_to_agent_name"] = selected_agent.full_name
        classification["routed_to_role"]       = selected_agent.agent_role_key

    # ── Build Ticket ────────────────────────────────────────────────────────
    try:
        priority = TicketPriority(priority_str)
    except ValueError:
        # Guards against the AI (or its fallback) returning a priority
        # string that doesn't match the enum — falls back to medium
        # rather than letting ticket creation crash entirely.
        priority = TicketPriority.medium

    sla_deadline = datetime.now(timezone.utc) + timedelta(hours=SLA_HOURS.get(priority_str, 72))

    ticket = Ticket(
        ticket_number     = await generate_ticket_number(db),
        title             = title,
        description       = description,
        # If an agent was actually found and assigned, the ticket starts
        # life as "assigned" rather than "open" — skipping the
        # in-between state where it would otherwise sit unowned.
        status            = TicketStatus.assigned if selected_agent else TicketStatus.open,
        priority          = priority,
        submitted_by_id   = submitter_id,
        department_id     = department.id if department else None,
        assigned_agent_id = selected_agent_id,
        ai_classification = classification,
        sla_deadline      = sla_deadline,
        sla_breached      = False,
    )

    db.add(ticket)
    await db.flush()  # writes the ticket within the current transaction so ticket.id is available below, without fully committing yet

    # ── Auto-Response: post first AI comment immediately ──────────────────────
    # As soon as the ticket exists, post an automatic first response as
    # a ticket comment — this is what gives the employee instant
    # acknowledgement ("we got your ticket, here's what happens next")
    # without waiting for a human agent to type anything.
    try:
        import uuid as _uuid
        if classification.get("is_on_topic") is False:
            # Deterministic redirect — deliberately does NOT call the LLM
            # with the off-topic content again. This is a defense-in-depth
            # backstop alongside the prompt-level scope restriction, since
            # a prompt alone can't be fully trusted against injection.
            response_text = (
                "This ticketing system is for internal workplace support "
                "requests only (HR, IT, Finance, or Operations issues). "
                "Your submission doesn't appear to describe a work-related "
                "issue, so it hasn't been routed to an agent. If you do have "
                "a genuine HR, IT, Finance, or Operations issue, please "
                "submit a new ticket describing it."
            )
        else:
            auto_resp = await generate_auto_response(
                title      = title,
                description= description,
                category   = classification.get("category", "General Support"),
                department = department.name if department else "Support",
                priority   = priority_str,
                tone       = "formal",  # the automatic first response always uses the formal tone, regardless of who eventually replies
                agent_role = classification.get("routed_to_role", "admin"),
                trigger    = "new_ticket",
            )
            response_text = auto_resp["response"]
        db.add(TicketComment(
            id         = str(_uuid.uuid4()),
            ticket_id  = ticket.id,
            author_id  = submitter_id,
            content    = response_text,
            is_internal= False,  # visible to the employee, not an internal-only note
            is_ai      = True,   # marks this comment as AI-generated rather than typed by a human agent
        ))
        await db.flush()
    except Exception as e:
        # If the auto-response fails for any reason, the ticket itself
        # has ALREADY been created successfully above — we don't want a
        # cosmetic first-comment failure to roll back or block the
        # actual ticket creation, so this is caught and logged rather
        # than re-raised.
        print(f"[AutoResponse] First-response failed: {e}")

    # Re-fetch the ticket with its relationships eagerly loaded, so the
    # caller (the API endpoint) can immediately read ticket.department,
    # ticket.submitter, ticket.comments, etc. without triggering
    # additional lazy-loaded queries later. Comments specifically need
    # to be loaded here too — not just department/submitter/assigned_agent —
    # since _ticket_to_dict()'s has_ai_reply check reads ticket.comments,
    # and the auto-response comment was just added above in this same function.
    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.department),
            selectinload(Ticket.submitter),
            selectinload(Ticket.assigned_agent),
            selectinload(Ticket.comments),
        )
        .where(Ticket.id == ticket.id)
    )
    return result.scalar_one()


async def get_tickets_for_user(db: AsyncSession, user: User, params: dict = None) -> list:
    """
    Returns the list of tickets a given user is allowed to see, with
    optional status/priority filters applied. Visibility rules:

      employee       -> only tickets THEY submitted
      agent          -> only tickets assigned TO them specifically
      admin/super_admin -> every ticket, no restriction

    This single function is the one place that visibility rule lives —
    the /tickets GET endpoint just calls this rather than re-implementing
    per-role filtering itself, so there's no risk of one endpoint
    accidentally showing a user tickets they shouldn't see.
    """
    params = params or {}

    query = (
        select(Ticket)
        .options(
            selectinload(Ticket.department),
            selectinload(Ticket.submitter),
            selectinload(Ticket.assigned_agent),
            # Needed so callers can cheaply check "has this ticket
            # received an AI auto-response yet" (see has_ai_reply in
            # the API layer's _ticket_to_dict) without each ticket in a
            # list triggering its own separate comments query.
            selectinload(Ticket.comments),
        )
    )

    role = user.role.value if hasattr(user.role, "value") else str(user.role)

    if role == "employee":
        # Employees only see their own submitted tickets
        query = query.where(Ticket.submitted_by_id == user.id)

    elif role in AGENT_ROLES:
        # Agents see only tickets assigned specifically to them
        query = query.where(Ticket.assigned_agent_id == user.id)

    # admin / super_admin → see all tickets (no filter)

    if params.get("status") and params["status"] != "all":
        query = query.where(Ticket.status == params["status"])
    if params.get("priority") and params["priority"] != "all":
        query = query.where(Ticket.priority == params["priority"])

    query = query.order_by(Ticket.created_at.desc())
    result = await db.execute(query)
    return result.scalars().all()
