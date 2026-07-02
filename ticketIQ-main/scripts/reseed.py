#!/usr/bin/env python3
"""
TicketIQ — Rich Reseed Script
================================
DESTRUCTIVE: drops every existing department, user, ticket, comment,
audit log, and refresh token, then rebuilds the database from scratch
with a larger, more varied demo dataset than scripts/seed_data.py.

How this differs from seed_data.py:
  seed_data.py  — SAFE, idempotent. Adds the core login-screen demo
                  accounts and a small set of sample tickets, but only
                  if the database is empty (skips anything that already
                  exists). This is what you'd normally run.
  reseed.py     — DESTRUCTIVE. Wipes everything first, then seeds a
                  bigger dataset (the same core accounts PLUS four extra
                  employees) with more tickets across more statuses, for
                  testing/demoing the analytics dashboard with more
                  realistic volume than the minimal seed_data.py set
                  provides.

Only run this when you genuinely want to reset the database to a known
state and don't mind losing whatever's currently in it.

Run from /backend:  python ../scripts/reseed.py
"""
import asyncio, sys, os, uuid, random, math
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
_env = os.path.join(os.path.dirname(__file__), '..', 'backend', '.env')
if os.path.exists(_env):
    from dotenv import load_dotenv; load_dotenv(_env)

from sqlalchemy import text
from app.db.session import AsyncSessionLocal, init_db
from app.models.models import User, UserRole, Department, Ticket, TicketStatus, TicketPriority, AuditLog, RefreshToken
from app.services.auth.auth_service import hash_password
from app.core.config import AGENT_SKILL_PROFILES

utcnow = lambda: datetime.now(timezone.utc)

# Same four departments as core/config.py's DEPARTMENTS — duplicated
# here (rather than imported) so this script can run standalone and
# stay readable on its own, at the cost of needing to be kept in sync
# manually if departments ever change.
DEPARTMENTS = [
    {"name": "Human Resources",        "slug": "hr",         "color": "#8B5CF6", "description": "Employee relations, benefits, policies, leave"},
    {"name": "Information Technology", "slug": "it",         "color": "#3B82F6", "description": "Hardware, software, network, system access"},
    {"name": "Finance",                "slug": "finance",    "color": "#10B981", "description": "Expenses, payroll, invoices, budget"},
    {"name": "Operations",             "slug": "operations", "color": "#F59E0B", "description": "Facilities, logistics, procurement, maintenance"},
]

USERS = [
    # Admin
    {"email": "admin@ticketiq.com",     "pw": "Admin@1234",    "name": "Alex Morgan",     "role": "admin",                 "eid": "EMP-0001", "title": "System Administrator",      "dept": None,         "ark": None},
    # Agents
    {"email": "lerato.selowa@ticketiq.com", "pw": "TicketIQ@2026", "name": "Lerato Selowa",       "role": "ai_intern",             "eid": "AGT-0001", "title": "AI Intern",                 "dept": None,         "ark": "ai_intern"},
    {"email": "leslie.kekana@ticketiq.com", "pw": "TicketIQ@2026", "name": "Leslie Kekana",       "role": "it_support_technician", "eid": "AGT-0002", "title": "IT Support Agent",          "dept": None,         "ark": "it_support_technician"},
    {"email": "murunwa.mudzhadzhi.agent@ticketiq.com", "pw": "TicketIQ@2026", "name": "Murunwa Mudzhadzhi", "role": "junior_operations", "eid": "AGT-0003", "title": "Junior Operations Agent",   "dept": None,         "ark": "junior_operations"},
    # Employees (the four shown on the login screen)
    {"email": "mutshutshudzi.nemanashi@ticketiq.com", "pw": "TicketIQ@2026", "name": "Mutshutshudzi Nemanashi", "role": "employee", "eid": "EMP-0010", "title": "HR Coordinator",          "dept": "hr",         "ark": None},
    {"email": "lehlogonolo.ledwaba@ticketiq.com",     "pw": "TicketIQ@2026", "name": "Lehlogonolo Ledwaba",     "role": "employee", "eid": "EMP-0011", "title": "Software Engineer",        "dept": "it",         "ark": None},
    {"email": "pamela.sibiya@ticketiq.com",           "pw": "TicketIQ@2026", "name": "Pamela Sibiya",           "role": "employee", "eid": "EMP-0012", "title": "Finance Analyst",          "dept": "finance",    "ark": None},
    {"email": "murunwa.mudzhadzhi.emp@ticketiq.com",  "pw": "TicketIQ@2026", "name": "Murunwa Mudzhadzhi",      "role": "employee", "eid": "EMP-0013", "title": "Operations Coordinator",   "dept": "operations", "ark": None},
    # Extra employees for richer demo data — not shown on the login screen's
    # quick-login cards, kept under their original names since they exist
    # only to give the analytics dashboard a larger, more realistic dataset.
    {"email": "marcus.j@ticketiq.com",  "pw": "Employee@1234", "name": "Marcus Johnson",  "role": "employee", "eid": "EMP-0014", "title": "Senior HR Manager",        "dept": "hr",         "ark": None},
    {"email": "lisa.c@ticketiq.com",    "pw": "Employee@1234", "name": "Lisa Chen",       "role": "employee", "eid": "EMP-0015", "title": "DevOps Engineer",          "dept": "it",         "ark": None},
    {"email": "david.o@ticketiq.com",   "pw": "Employee@1234", "name": "David Osei",      "role": "employee", "eid": "EMP-0016", "title": "Financial Controller",     "dept": "finance",    "ark": None},
    {"email": "rachel.m@ticketiq.com",  "pw": "Employee@1234", "name": "Rachel Moore",    "role": "employee", "eid": "EMP-0017", "title": "Logistics Manager",        "dept": "operations", "ark": None},
]

SLA_MAP = {"critical": 4, "high": 24, "medium": 72, "low": 168}

TICKETS = [
    # HR → ai_intern
    {"title": "Annual Leave Request — 3 Days",         "desc": "I'd like to request 3 days annual leave March 20–22. Please advise.",                  "sub": "mutshutshudzi.nemanashi@ticketiq.com",  "dept": "hr",         "status": "resolved",    "priority": "low",      "agent": "ai_intern",             "tokens": ["annual_leave","leave"],          "weights": {"annual_leave":3,"leave":3}},
    {"title": "February Payslip Missing from Portal",  "desc": "My February payslip is not visible in the portal. All previous months accessible.",     "sub": "mutshutshudzi.nemanashi@ticketiq.com",  "dept": "hr",         "status": "in_progress", "priority": "high",     "agent": "ai_intern",             "tokens": ["payslip","pay","salary"],         "weights": {"payslip":3,"pay":2,"salary":2}},
    {"title": "Maternity Leave Policy Clarification",  "desc": "Expecting in June. Need clarity on maternity leave duration and pay structure.",         "sub": "marcus.j@ticketiq.com",  "dept": "hr",         "status": "open",        "priority": "medium",   "agent": "ai_intern",             "tokens": ["maternity","leave","hr_policy"],  "weights": {"maternity":3,"leave":2,"hr_policy":2}},
    {"title": "Performance Review Schedule Q2",        "desc": "Can you confirm the Q2 performance review dates and format for our department?",         "sub": "marcus.j@ticketiq.com",  "dept": "hr",         "status": "assigned",    "priority": "low",      "agent": "ai_intern",             "tokens": ["performance_review","appraisal"], "weights": {"performance_review":3,"appraisal":2}},
    {"title": "Onboarding Pack for New Starter",       "desc": "New hire James Addo starts Monday. Please arrange induction, access badge and welcome pack.","sub": "mutshutshudzi.nemanashi@ticketiq.com","dept": "hr",         "status": "escalated",   "priority": "high",     "agent": "ai_intern",             "tokens": ["onboarding","new_hire"],         "weights": {"onboarding":3,"new_hire":3}},
    # IT → it_support_technician
    {"title": "VPN Not Connecting After Windows Update","desc": "Cisco VPN shows Error 442 since yesterday's update. Reinstall didn't help.",            "sub": "lehlogonolo.ledwaba@ticketiq.com",   "dept": "it",         "status": "in_progress", "priority": "critical", "agent": "it_support_technician", "tokens": ["vpn","connectivity","error"],     "weights": {"vpn":3,"connectivity":3,"error":2}},
    {"title": "Laptop Running Extremely Slow",          "desc": "Dell XPS 13 very slow — apps take 30+ seconds, storage at 95%.",                        "sub": "lehlogonolo.ledwaba@ticketiq.com",   "dept": "it",         "status": "assigned",    "priority": "medium",   "agent": "it_support_technician", "tokens": ["laptop","hardware","system"],     "weights": {"laptop":3,"hardware":2,"system":1}},
    {"title": "New Hire Software Setup — David Chen",   "desc": "Starts Monday. Needs Office 365, Slack, Figma, GitHub. Laptop on my desk.",             "sub": "lisa.c@ticketiq.com",    "dept": "it",         "status": "open",        "priority": "high",     "agent": "it_support_technician", "tokens": ["new_hire","software","access"],   "weights": {"new_hire":3,"software":2,"access":2}},
    {"title": "MFA Setup Failing for Remote Users",     "desc": "Three remote team members can't complete MFA setup. Blocking work from home access.",    "sub": "lisa.c@ticketiq.com",    "dept": "it",         "status": "resolved",    "priority": "high",     "agent": "it_support_technician", "tokens": ["mfa","authentication","access"],  "weights": {"mfa":3,"authentication":3,"access":2}},
    {"title": "Office Wi-Fi Dropping Every 30 Minutes", "desc": "Wi-Fi in the east wing drops every ~30 min. Affects 15+ staff.",                        "sub": "lehlogonolo.ledwaba@ticketiq.com",   "dept": "it",         "status": "escalated",   "priority": "critical", "agent": "it_support_technician", "tokens": ["wifi","network","connectivity"],  "weights": {"wifi":3,"network":3,"connectivity":2}},
    # Finance → it_support_technician
    {"title": "Expense Claim Rejected Without Explanation","desc": "£240 client dinner claim (EXP-2024-0892) rejected with no reason. All receipts attached.","sub": "pamela.sibiya@ticketiq.com","dept": "finance",    "status": "escalated",   "priority": "high",     "agent": "it_support_technician", "tokens": ["expense_claim","reimbursement"],  "weights": {"expense_claim":3,"reimbursement":2}},
    {"title": "Q1 Budget Report Not Generated",         "desc": "Automated Q1 budget report failed. Dashboard shows error. Needed for Monday board meeting.","sub": "david.o@ticketiq.com","dept": "finance",   "status": "in_progress", "priority": "critical", "agent": "it_support_technician", "tokens": ["budget","financial_report"],      "weights": {"budget":3,"financial_report":3}},
    {"title": "Purchase Order Approval Pending 2 Weeks","desc": "PO-2024-0445 for monitors and docking stations £3,200 pending for 2 weeks.",            "sub": "pamela.sibiya@ticketiq.com",     "dept": "finance",    "status": "resolved",    "priority": "medium",   "agent": "it_support_technician", "tokens": ["purchase_order","approval_workflow"],"weights": {"purchase_order":3,"approval_workflow":2}},
    {"title": "SAP Login Broken After Password Reset",  "desc": "After IT forced password reset, SAP ERP won't authenticate. Urgent — month end close.", "sub": "david.o@ticketiq.com",   "dept": "finance",    "status": "assigned",    "priority": "critical", "agent": "it_support_technician", "tokens": ["sap","erp","authentication"],     "weights": {"sap":3,"erp":3,"authentication":2}},
    # Operations → junior_operations
    {"title": "Office Chair Broken — Urgent Replacement","desc": "Hydraulic mechanism broken, sinks to lowest. Urgent ergonomic replacement needed.",    "sub": "murunwa.mudzhadzhi.emp@ticketiq.com",    "dept": "operations", "status": "assigned",    "priority": "medium",   "agent": "junior_operations",     "tokens": ["chair","furniture","maintenance"],  "weights": {"chair":3,"furniture":2,"maintenance":2}},
    {"title": "Meeting Room 3A Projector Faulty",       "desc": "HDMI port loose, disconnects mid-presentation. Client presentation Friday.",             "sub": "murunwa.mudzhadzhi.emp@ticketiq.com",    "dept": "operations", "status": "in_progress", "priority": "high",     "agent": "junior_operations",     "tokens": ["meeting_room","facilities","repair"],"weights": {"meeting_room":3,"facilities":2,"repair":2}},
    {"title": "Building Access Card Stopped Working",   "desc": "Card stopped working at server room door. Needs re-programming. Employee: EMP-0013.",    "sub": "rachel.m@ticketiq.com",  "dept": "operations", "status": "resolved",    "priority": "high",     "agent": "junior_operations",     "tokens": ["access_card","security_badge","building"],"weights": {"access_card":3,"security_badge":2,"building":2}},
    {"title": "Office Supplies Running Low — Urgent",   "desc": "Printer paper, toner cartridges and pens depleted. Need emergency order.",               "sub": "rachel.m@ticketiq.com",  "dept": "operations", "status": "open",        "priority": "low",      "agent": "junior_operations",     "tokens": ["supplies","office_supplies","procurement"],"weights": {"supplies":3,"office_supplies":2,"procurement":1}},
    {"title": "Air Conditioning Broken — Floor 3",      "desc": "AC unit on floor 3 blowing hot air since Monday. 28°C in office. Staff discomfort.",     "sub": "murunwa.mudzhadzhi.emp@ticketiq.com",    "dept": "operations", "status": "escalated",   "priority": "high",     "agent": "junior_operations",     "tokens": ["air_conditioning","facilities","maintenance"],"weights": {"air_conditioning":3,"facilities":2,"maintenance":2}},
    {"title": "Company Vehicle Fleet Service Due",      "desc": "3 company vehicles due for service this month. Booking confirmation needed.",             "sub": "rachel.m@ticketiq.com",  "dept": "operations", "status": "open",        "priority": "low",      "agent": "junior_operations",     "tokens": ["company_vehicle","fleet","maintenance"],"weights": {"company_vehicle":3,"fleet":2,"maintenance":1}},
]


def _score(tokens, weights, role):
    profile = AGENT_SKILL_PROFILES.get(role, {})
    skill   = set(profile.get("skill_tokens", []))
    score   = 0.0
    for t in tokens:
        if t in skill:
            w = weights.get(t, 1)
            score += w * (1 + math.log(w + 1))
    return round(score, 2)


async def reseed():
    print("\nReseeding TicketIQ...\n")
    await init_db()

    async with AsyncSessionLocal() as db:
        # Wipe existing data in order
        for tbl in ["audit_logs","ticket_comments","tickets","refresh_tokens","users","departments"]:
            await db.execute(text(f"DELETE FROM {tbl}"))
        await db.commit()
        print("Cleared existing data.")

        # Departments
        dept_map = {}
        for d in DEPARTMENTS:
            obj = Department(id=str(uuid.uuid4()), **d)
            db.add(obj); await db.flush()
            dept_map[d["slug"]] = obj
            print(f"  + Dept: {d['name']}")

        # Users
        user_map = {}
        for u in USERS:
            dept_id = dept_map[u["dept"]].id if u.get("dept") else None
            obj = User(
                id=str(uuid.uuid4()),
                email=u["email"],
                full_name=u["name"],
                hashed_password=hash_password(u["pw"]),
                role=UserRole(u["role"]),
                employee_id=u["eid"],
                job_title=u["title"],
                department_id=dept_id,
                agent_role_key=u["ark"],
                agent_departments=[],
                is_active=True,
            )
            db.add(obj); await db.flush()
            user_map[u["email"]] = obj
            print(f"  + User: {u['name']} ({u['role']})")

        role_to_user = {
            "ai_intern":             user_map["lerato.selowa@ticketiq.com"],
            "it_support_technician": user_map["leslie.kekana@ticketiq.com"],
            "junior_operations":     user_map["murunwa.mudzhadzhi.agent@ticketiq.com"],
        }

        # Tickets
        for i, t in enumerate(TICKETS):
            submitter = user_map.get(t["sub"])
            dept      = dept_map.get(t["dept"])
            agent     = role_to_user.get(t["agent"])
            scores    = {r: _score(t["tokens"], t["weights"], r) for r in role_to_user}
            winner    = scores[t["agent"]]
            profile   = AGENT_SKILL_PROFILES.get(t["agent"], {})

            hours_ago = random.randint(2, 168)
            created   = utcnow() - timedelta(hours=hours_ago)
            resolved_at = (created + timedelta(hours=random.randint(1, 24))) if t["status"] in ("resolved","closed") else None

            sla_hours = SLA_MAP[t["priority"]]
            sla_deadline = created + timedelta(hours=sla_hours)
            sla_breached = sla_deadline < utcnow() and t["status"] not in ("resolved","closed")

            ai_data = {
                "department_slug":   t["dept"],
                "department_name":   dept.name if dept else t["dept"],
                "priority":          t["priority"],
                "category":          t["title"].split("—")[0].strip(),
                "sentiment":         "neutral",
                "summary":           t["title"],
                "priority_reason":   f"Seeded at {t['priority']} priority",
                "skill_tokens":      t["tokens"],
                "token_weights":     t["weights"],
                "token_match_score": winner,
                "all_agent_scores":  scores,
                "routed_to_role":    t["agent"],
                "routed_to_agent_name": agent.full_name if agent else t["agent"],
                "routing_rationale": f"Score {winner:.1f} — {profile.get('display_name',t['agent'])} matched: {', '.join(t['tokens'][:3])}",
                "selection_confidence": min(winner / 30.0, 0.97),
                "selected_by":       "seed_token_scoring",
                "classified_by":     "seed_data",
            }

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
                ai_classification=ai_data,
                sla_deadline=sla_deadline,
                sla_breached=sla_breached,
                is_escalated=(t["status"] == "escalated"),
                created_at=created,
                resolved_at=resolved_at,
            )
            db.add(ticket); await db.flush()

            # Audit log per ticket
            db.add(AuditLog(
                id=str(uuid.uuid4()),
                ticket_id=ticket.id,
                user_id=submitter.id if submitter else None,
                action="ticket_created",
                details={"title": t["title"], "ai_agent": agent.full_name if agent else None},
                created_at=created,
            ))
            if t["status"] == "resolved":
                db.add(AuditLog(
                    id=str(uuid.uuid4()),
                    ticket_id=ticket.id,
                    user_id=agent.id if agent else None,
                    action="status_changed",
                    details={"new_status": "resolved"},
                    created_at=resolved_at or utcnow(),
                ))

            print(f"  + TIQ-{1001+i:04d} [{t['priority']:8s}] [{t['status']:12s}] {t['title'][:48]}")

        await db.commit()

    print("\nDone! All accounts:\n")
    print("  admin@ticketiq.com                      Admin@1234     (admin)")
    print("  lerato.selowa@ticketiq.com               TicketIQ@2026  (AI Intern)")
    print("  leslie.kekana@ticketiq.com                TicketIQ@2026  (IT Support)")
    print("  murunwa.mudzhadzhi.agent@ticketiq.com     TicketIQ@2026  (Junior Ops)")
    print("  mutshutshudzi.nemanashi@ticketiq.com      TicketIQ@2026  (HR)")
    print("  lehlogonolo.ledwaba@ticketiq.com          TicketIQ@2026  (IT)")
    print("  pamela.sibiya@ticketiq.com                TicketIQ@2026  (Finance)")
    print("  murunwa.mudzhadzhi.emp@ticketiq.com       TicketIQ@2026  (Operations)")
    print("  marcus.j@ticketiq.com                     Employee@1234  (HR senior, extra demo data)")
    print("  lisa.c@ticketiq.com                       Employee@1234  (IT DevOps, extra demo data)")
    print("  david.o@ticketiq.com                      Employee@1234  (Finance, extra demo data)")
    print("  rachel.m@ticketiq.com                     Employee@1234  (Operations, extra demo data)")


if __name__ == "__main__":
    asyncio.run(reseed())
