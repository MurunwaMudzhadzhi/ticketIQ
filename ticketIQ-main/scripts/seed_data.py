#!/usr/bin/env python3
"""
TicketIQ Enterprise — Database Seed Script
===========================================
Populates a fresh (or existing) database with:
  1. The four core departments (HR, IT, Finance, Operations)
  2. The demo user accounts shown on the login screen (1 admin,
     3 support agents, 4 department employees)
  3. A starter batch of realistic support tickets, each pre-classified
     and routed exactly the way the AI classification pipeline would
     route a real ticket, so the analytics dashboard has meaningful
     data to display from the very first run.

Run from the project root:
    cd backend
    python ../scripts/seed_data.py

This script is idempotent — if a department, user, or any tickets
already exist, it skips re-creating them instead of erroring out or
duplicating rows. That makes it safe to run more than once (e.g. after
restarting a dev server) without wiping real data.
"""
import asyncio, sys, os, uuid, random, math
from datetime import datetime, timedelta, timezone

# Make the `app` package (living in /backend/app) importable when this
# script is run from the /scripts folder rather than from /backend itself.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
sys.stdout.reconfigure(encoding='utf-8')

# Load backend/.env manually since this script runs standalone, outside
# of FastAPI's own startup (which would normally load it for us).
_env = os.path.join(os.path.dirname(__file__), '..', 'backend', '.env')
if os.path.exists(_env):
    from dotenv import load_dotenv
    load_dotenv(_env)

from app.db.session import AsyncSessionLocal, init_db
from app.models.models import User, UserRole, Department, Ticket, TicketStatus, TicketPriority
from app.services.auth.auth_service import hash_password
from app.core.config import AGENT_SKILL_PROFILES

# Small helper so every "now" timestamp in this file is timezone-aware UTC,
# matching how the rest of the app stores datetimes.
utcnow = lambda: datetime.now(timezone.utc)

# ─────────────────────────────────────────────────────────────────────────
# DEPARTMENTS
# Each department gets a distinct accent colour used throughout the
# frontend (badges, charts, KPI cards) so users can recognise a
# department at a glance without reading the label.
# ─────────────────────────────────────────────────────────────────────────
DEMO_DEPARTMENTS = [
    {"name": "Human Resources",        "slug": "hr",         "color": "#8B5CF6", "description": "Employee relations, benefits, policies, leave management"},
    {"name": "Information Technology", "slug": "it",         "color": "#3B82F6", "description": "Hardware, software, network, system access and security"},
    {"name": "Finance",                "slug": "finance",    "color": "#10B981", "description": "Expenses, payroll, invoices, budget and procurement"},
    {"name": "Operations",             "slug": "operations", "color": "#F59E0B", "description": "Facilities, logistics, procurement and maintenance"},
]

# ─────────────────────────────────────────────────────────────────────────
# DEMO USER ACCOUNTS
# These are exactly the accounts shown as quick-login cards on the
# sign-in screen. Each employee belongs to one department and only ever
# sees their own tickets; each agent has an `ark` (agent_role_key) that
# determines which AI-routed tickets land in their queue:
#   ai_intern             -> all HR tickets
#   it_support_technician -> IT tickets AND Finance tickets
#   junior_operations     -> all Operations tickets
# (Use UserRole enum members directly, rather than plain strings, so a
#  typo here fails loudly at seed time instead of silently at login time.)
# ─────────────────────────────────────────────────────────────────────────
DEMO_USERS = [
    # --- Admin --------------------------------------------------------
    {
        "email": "admin@ticketiq.com",
        "pw":    "Admin@1234",
        "name":  "Alex Morgan",
        "role":  UserRole.admin,
        "eid":   "EMP-0001",
        "title": "System Administrator",
        "dept":  None,
        "ark":   None,
        "location": "Head Office, Cape Town",
    },
    # --- Support agents -------------------------------------------------
    # AI Intern — handles every ticket routed to the HR department.
    {
        "email": "lerato.selowa@ticketiq.com",
        "pw":    "TicketIQ@2026",
        "name":  "Lerato Selowa",
        "role":  UserRole.ai_intern,
        "eid":   "AGT-0001",
        "title": "AI Intern",
        "dept":  None,
        "ark":   "ai_intern",
        "location": "Sandton, Johannesburg",
    },
    # IT Support Agent — handles both IT tickets and Finance tickets
    # (Finance issues are frequently systems/access related, so they're
    # routed to IT support rather than a dedicated finance agent).
    {
        "email": "leslie.kekana@ticketiq.com",
        "pw":    "TicketIQ@2026",
        "name":  "Leslie Kekana",
        "role":  UserRole.it_support,
        "eid":   "AGT-0002",
        "title": "IT Support Assistant",
        "dept":  None,
        "ark":   "it_support_technician",
        "location": "Century City, Cape Town",
    },
    # Junior Operations Agent — handles every Operations ticket.
    # Note: this is a different account (and a different email) from
    # the Operations *Employee* below, even though both happen to share
    # the same person's name in this demo dataset.
    {
        "email": "murunwa.mudzhadzhi.agent@ticketiq.com",
        "pw":    "TicketIQ@2026",
        "name":  "Murunwa Mudzhadzhi",
        "role":  UserRole.junior_ops,
        "eid":   "AGT-0003",
        "title": "Junior Automation Support",
        "dept":  None,
        "ark":   "junior_operations",
        "location": "Durban North",
    },
    # --- Department employees -------------------------------------------
    # Each employee below only submits and views tickets for their own
    # department; the AI classifier routes their tickets automatically.
    {
        "email": "mutshutshudzi.nemanashi@ticketiq.com",
        "pw":    "TicketIQ@2026",
        "name":  "Mutshutshudzi Nemanashi",
        "role":  UserRole.employee,
        "eid":   "EMP-0010",
        "title": "HR Coordinator",
        "dept":  "hr",
        "ark":   None,
        "location": "Sandton, Johannesburg",
    },
    {
        "email": "lehlogonolo.ledwaba@ticketiq.com",
        "pw":    "TicketIQ@2026",
        "name":  "Lehlogonolo Ledwaba",
        "role":  UserRole.employee,
        "eid":   "EMP-0011",
        "title": "Software Engineer",
        "dept":  "it",
        "ark":   None,
        "location": "Cape Town CBD",
    },
    {
        "email": "pamela.sibiya@ticketiq.com",
        "pw":    "TicketIQ@2026",
        "name":  "Pamela Sibiya",
        "role":  UserRole.employee,
        "eid":   "EMP-0012",
        "title": "Finance Analyst",
        "dept":  "finance",
        "ark":   None,
        "location": "Rosebank, Johannesburg",
    },
    {
        "email": "murunwa.mudzhadzhi.emp@ticketiq.com",
        "pw":    "TicketIQ@2026",
        "name":  "Murunwa Mudzhadzhi",
        "role":  UserRole.employee,
        "eid":   "EMP-0013",
        "title": "Operations Coordinator",
        "dept":  "operations",
        "ark":   None,
        "location": "Umhlanga, Durban",
    },
]

# ─────────────────────────────────────────────────────────────────────────
# SAMPLE TICKETS
# Thirteen realistic tickets spread across all four departments and a
# mix of statuses/priorities, so every chart on the analytics dashboard
# (volume, by-department, by-priority, by-status, SLA) has more than
# one data point to draw on right after seeding.
#
# `tokens` / `weights` feed the same keyword-scoring routine the live
# AI classification fallback uses (see strategy_mapper.py), so the
# "AI classification" stored on each seeded ticket is computed the same
# way a real ticket would be scored — not just hand-typed fake data.
# ─────────────────────────────────────────────────────────────────────────
SAMPLE_TICKETS = [
    # HR -> ai_intern
    {
        "title":  "Annual Leave Request — 3 Days",
        "desc":   "I'd like to request 3 days annual leave March 20-22. I have 8 remaining days. Please advise if there are conflicts.",
        "sub":    "mutshutshudzi.nemanashi@ticketiq.com", "dept": "hr",
        "status": "assigned", "priority": "low",
        "tokens": ["annual_leave","leave","vacation"],
        "weights":{"annual_leave":3,"leave":3,"vacation":2}, "agent_role": "ai_intern",
    },
    {
        "title":  "February Payslip Missing from Portal",
        "desc":   "My February payslip is not visible in the portal. All previous months are accessible. Please investigate.",
        "sub":    "mutshutshudzi.nemanashi@ticketiq.com", "dept": "hr",
        "status": "in_progress", "priority": "high",
        "tokens": ["payslip","pay","salary"],
        "weights":{"payslip":3,"pay":2,"salary":2}, "agent_role": "ai_intern",
    },
    {
        "title":  "Maternity Leave Policy Clarification",
        "desc":   "I'm expecting in June. Need clarity on maternity leave duration, pay structure, and return-to-work process.",
        "sub":    "mutshutshudzi.nemanashi@ticketiq.com", "dept": "hr",
        "status": "open", "priority": "medium",
        "tokens": ["maternity","leave","hr_policy","benefits"],
        "weights":{"maternity":3,"leave":2,"hr_policy":2,"benefits":1}, "agent_role": "ai_intern",
    },
    {
        "title":  "Performance Review Scheduling",
        "desc":   "I have not received my Q1 performance review invitation. My manager confirmed it should have been sent last week.",
        "sub":    "mutshutshudzi.nemanashi@ticketiq.com", "dept": "hr",
        "status": "open", "priority": "medium",
        "tokens": ["performance_review","appraisal","hr_policy"],
        "weights":{"performance_review":3,"appraisal":2,"hr_policy":1}, "agent_role": "ai_intern",
    },
    # IT -> it_support_technician
    {
        "title":  "VPN Not Connecting After Windows Update",
        "desc":   "Cisco VPN shows Error 442 since yesterday's Windows update. Reinstall didn't help. Can't work remotely.",
        "sub":    "lehlogonolo.ledwaba@ticketiq.com", "dept": "it",
        "status": "in_progress", "priority": "critical",
        "tokens": ["vpn","connectivity","software","error","update"],
        "weights":{"vpn":3,"connectivity":3,"software":2,"error":2,"update":1}, "agent_role": "it_support_technician",
    },
    {
        "title":  "Laptop Running Extremely Slow",
        "desc":   "My Dell XPS 13 has been very slow this week. Apps take 30+ seconds to open. Storage is at 95%.",
        "sub":    "lehlogonolo.ledwaba@ticketiq.com", "dept": "it",
        "status": "assigned", "priority": "medium",
        "tokens": ["laptop","hardware","software","system"],
        "weights":{"laptop":3,"hardware":2,"software":2,"system":1}, "agent_role": "it_support_technician",
    },
    {
        "title":  "New Hire Software Setup — David Chen",
        "desc":   "New hire David Chen starts Monday. Needs Office 365, Slack, Figma, and GitHub access. Laptop is on my desk.",
        "sub":    "lehlogonolo.ledwaba@ticketiq.com", "dept": "it",
        "status": "open", "priority": "high",
        "tokens": ["new_hire","software","installation","access","account"],
        "weights":{"new_hire":3,"software":2,"installation":2,"access":2,"account":1}, "agent_role": "it_support_technician",
    },
    # Finance -> it_support_technician (Finance systems issues route to IT support)
    {
        "title":  "Expense Claim Rejected Without Explanation",
        "desc":   "My R3,200 client dinner expense claim (EXP-2024-0892) was rejected with no reason. All receipts were attached.",
        "sub":    "pamela.sibiya@ticketiq.com", "dept": "finance",
        "status": "escalated", "priority": "high",
        "tokens": ["expense_claim","expense","reimbursement","receipt"],
        "weights":{"expense_claim":3,"expense":3,"reimbursement":2,"receipt":1}, "agent_role": "it_support_technician",
    },
    {
        "title":  "Q1 Budget Report Not Generated",
        "desc":   "The automated Q1 budget report failed to generate. Finance dashboard shows a system error. Needed for Monday board meeting.",
        "sub":    "pamela.sibiya@ticketiq.com", "dept": "finance",
        "status": "in_progress", "priority": "critical",
        "tokens": ["budget","financial_report","financial_system","error"],
        "weights":{"budget":3,"financial_report":3,"financial_system":2,"error":2}, "agent_role": "it_support_technician",
    },
    {
        "title":  "Purchase Order Approval — Office Equipment",
        "desc":   "Requesting approval for PO-2024-0445 covering monitors and docking stations totalling R48,000. Budget code: IT-CAPEX-2024.",
        "sub":    "pamela.sibiya@ticketiq.com", "dept": "finance",
        "status": "open", "priority": "medium",
        "tokens": ["purchase_order","approval_workflow","budget","procurement_system"],
        "weights":{"purchase_order":3,"approval_workflow":2,"budget":2,"procurement_system":1}, "agent_role": "it_support_technician",
    },
    # Operations -> junior_operations
    {
        "title":  "Office Chair Broken — Urgent Replacement",
        "desc":   "The hydraulic mechanism on my chair is broken. It sinks to the lowest position immediately. Please arrange urgent replacement.",
        "sub":    "murunwa.mudzhadzhi.emp@ticketiq.com", "dept": "operations",
        "status": "assigned", "priority": "medium",
        "tokens": ["chair","furniture","maintenance","repair","office"],
        "weights":{"chair":3,"furniture":2,"maintenance":2,"repair":2,"office":1}, "agent_role": "junior_operations",
    },
    {
        "title":  "Meeting Room 3A Projector Faulty",
        "desc":   "HDMI port on 3A projector is loose and disconnects mid-presentation. Client presentation on Friday — urgent fix needed.",
        "sub":    "murunwa.mudzhadzhi.emp@ticketiq.com", "dept": "operations",
        "status": "in_progress", "priority": "high",
        "tokens": ["meeting_room","facilities","repair","maintenance"],
        "weights":{"meeting_room":3,"facilities":2,"repair":2,"maintenance":2}, "agent_role": "junior_operations",
    },
    {
        "title":  "Building Access Card Stopped Working",
        "desc":   "My access card stopped working at the server room door. Security confirmed it needs re-programming. Employee ID: EMP-0013.",
        "sub":    "murunwa.mudzhadzhi.emp@ticketiq.com", "dept": "operations",
        "status": "resolved", "priority": "high",
        "tokens": ["access_card","security_badge","building","facilities"],
        "weights":{"access_card":3,"security_badge":2,"building":2,"facilities":1}, "agent_role": "junior_operations",
    },
]


def _token_score(tokens, weights, agent_role_key):
    """
    Reproduces the same weighted keyword-matching score used by the live
    fallback classifier (see strategy_mapper.py) so seeded tickets carry
    a realistic, explainable "AI confidence" score rather than an
    arbitrary made-up number.
    """
    profile = AGENT_SKILL_PROFILES.get(agent_role_key, {})
    agent_tokens = set(profile.get("skill_tokens", []))
    score = 0.0
    for t in tokens:
        if t in agent_tokens:
            w = weights.get(t, 1)
            # log-boosted weighting: a token with weight 3 counts for
            # more than 3x a weight-1 token, rewarding strong keyword
            # matches without letting one keyword dominate completely.
            score += w * (1 + math.log(w + 1))
    return round(score, 2)


async def seed():
    """Main entry point: creates departments, users, and tickets if they
    don't already exist, then prints the demo login credentials."""
    print("\n[SEED] Starting TicketIQ database seed...\n")
    await init_db()  # creates tables on first run; no-op if they already exist

    from sqlalchemy import select, func

    async with AsyncSessionLocal() as db:

        # --- Departments ---------------------------------------------------
        # Skip any department that already exists (matched by slug) so this
        # script can be safely re-run without raising a unique-constraint error.
        dept_map = {}
        for d in DEMO_DEPARTMENTS:
            ex = (await db.execute(select(Department).where(Department.slug == d["slug"]))).scalar_one_or_none()
            if ex:
                dept_map[d["slug"]] = ex
                print(f"  [SKIP] Dept exists: {d['name']}")
            else:
                obj = Department(id=str(uuid.uuid4()), **d)
                db.add(obj)
                await db.flush()
                dept_map[d["slug"]] = obj
                print(f"  [OK]   Created dept: {d['name']}")

        # --- Users -----------------------------------------------------------
        # Same idempotency pattern as departments, matched by email this time.
        user_map = {}
        for u in DEMO_USERS:
            ex = (await db.execute(select(User).where(User.email == u["email"]))).scalar_one_or_none()
            if ex:
                user_map[u["email"]] = ex
                print(f"  [SKIP] User exists: {u['email']}")
            else:
                dept_id = dept_map[u["dept"]].id if u.get("dept") else None
                obj = User(
                    id=str(uuid.uuid4()),
                    email=u["email"],
                    full_name=u["name"],
                    hashed_password=hash_password(u["pw"]),  # bcrypt-hashed — plaintext password is never stored
                    role=u["role"],          # Pass enum member directly to avoid name/value confusion
                    employee_id=u["eid"],
                    job_title=u["title"],
                    office_location=u.get("location"),
                    department_id=dept_id,
                    agent_role_key=u["ark"],
                    agent_departments=[],
                    is_active=True,
                )
                db.add(obj)
                await db.flush()
                user_map[u["email"]] = obj
                print(f"  [OK]   Created: {u['name']} ({u['role'].value})")

        # --- Tickets -----------------------------------------------------------
        # Only seed tickets if the table is completely empty — unlike
        # departments/users, tickets aren't matched individually, since
        # there's no natural unique key to check them against.
        ticket_count = (await db.execute(select(func.count(Ticket.id)))).scalar() or 0
        if ticket_count > 0:
            print(f"\n  [SKIP] {ticket_count} tickets already exist — skipping.\n")
        else:
            # Map each agent role key to the actual seeded agent User row,
            # so every ticket below gets assigned to a real account.
            role_to_user = {
                "ai_intern":             user_map.get("lerato.selowa@ticketiq.com"),
                "it_support_technician": user_map.get("leslie.kekana@ticketiq.com"),
                "junior_operations":     user_map.get("murunwa.mudzhadzhi.agent@ticketiq.com"),
            }
            # Hours allowed before a ticket of each priority breaches its SLA.
            sla_map = {"critical": 4, "high": 24, "medium": 72, "low": 168}

            for i, t in enumerate(SAMPLE_TICKETS):
                submitter  = user_map.get(t["sub"])
                dept       = dept_map.get(t["dept"])
                agent      = role_to_user.get(t["agent_role"])
                # Score this ticket against all three agent roles so we can
                # store the same "all_agent_scores" comparison a live
                # classification would produce, not just the winning score.
                scores     = {r: _token_score(t["tokens"], t["weights"], r)
                              for r in ["ai_intern","it_support_technician","junior_operations"]}
                winner     = scores[t["agent_role"]]
                profile    = AGENT_SKILL_PROFILES.get(t["agent_role"], {})

                # Spread creation times over the last 3 days so the
                # dashboard's "7-day trend" chart has a realistic shape
                # instead of every ticket appearing in the same hour.
                ticket_created_at = utcnow() - timedelta(hours=random.randint(1, 72))
                # Any ticket already marked resolved/closed in the sample
                # data needs a real resolved_at timestamp too — otherwise
                # it sits in an inconsistent state (closed, but with no
                # resolution time), which would silently break any
                # average-resolution-time calculation downstream (see
                # services/analytics/weekly_insights.py).
                ticket_resolved_at = None
                if t["status"] in ("resolved", "closed"):
                    ticket_resolved_at = ticket_created_at + timedelta(hours=random.randint(2, 48))

                ticket = Ticket(
                    id=str(uuid.uuid4()),
                    ticket_number=f"TIQ-{1001+i:04d}",
                    title=t["title"],
                    description=t["desc"],
                    status=TicketStatus(t["status"]),
                    priority=TicketPriority(t["priority"]),
                    submitted_by_id=submitter.id if submitter else None,
                    department_id=dept.id if dept else None,
                    assigned_agent_id=agent.id if agent else None,
                    # ai_classification mirrors exactly what the real
                    # classification pipeline stores on a live ticket —
                    # see response_pipeline.py / strategy_mapper.py.
                    ai_classification={
                        "department_slug":      t["dept"],
                        "department_name":      dept.name if dept else t["dept"],
                        "priority":             t["priority"],
                        "category":             t["title"].split("—")[0].strip(),
                        "sentiment":            "neutral",
                        "summary":              t["title"],
                        "skill_tokens":         t["tokens"],
                        "token_weights":        t["weights"],
                        "token_match_score":    winner,
                        "all_agent_scores":     scores,
                        "routed_to_role":       t["agent_role"],
                        "routed_to_agent_name": agent.full_name if agent else t["agent_role"],
                        "routing_rationale":    f"Score {winner:.1f} — matched: {', '.join(t['tokens'][:4])}",
                        "selection_confidence": min(winner / 30.0, 0.97),
                        "selected_by":          "seed_token_scoring",
                        "classified_by":        "seed_data",
                    },
                    sla_deadline=utcnow() + timedelta(hours=sla_map[t["priority"]]),
                    sla_breached=False,
                    created_at=ticket_created_at,
                    resolved_at=ticket_resolved_at,
                )
                db.add(ticket)
                print(f"  [OK]   TIQ-{1001+i:04d} -> {profile.get('display_name', t['agent_role'])} | {t['title'][:50]}")

        await db.commit()

    # --- Friendly summary printed to the terminal after seeding ----------------
    print("\n[DONE] Seed complete!\n")
    print("=" * 60)
    print("LOGIN CREDENTIALS")
    print("=" * 60)
    print("Admin:      admin@ticketiq.com                       | Admin@1234")
    print()
    print("Department Employees:")
    print("  mutshutshudzi.nemanashi@ticketiq.com | TicketIQ@2026  (HR)")
    print("  lehlogonolo.ledwaba@ticketiq.com     | TicketIQ@2026  (IT)")
    print("  pamela.sibiya@ticketiq.com           | TicketIQ@2026  (Finance)")
    print("  murunwa.mudzhadzhi.emp@ticketiq.com  | TicketIQ@2026  (Operations)")
    print()
    print("Support Agents:")
    print("  lerato.selowa@ticketiq.com             | TicketIQ@2026  (AI Intern — HR tickets)")
    print("  leslie.kekana@ticketiq.com              | TicketIQ@2026  (IT Support — IT + Finance tickets)")
    print("  murunwa.mudzhadzhi.agent@ticketiq.com   | TicketIQ@2026  (Junior Operations — Operations tickets)")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(seed())
