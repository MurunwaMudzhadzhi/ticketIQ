"""
TicketIQ — Database Models
============================
Every table in the application is defined here as a SQLAlchemy ORM
class. There are six tables in total:

  Department      — the four business units tickets get routed to
  User             — every account: employees, agents, and admins
  Ticket           — the core entity: one support request
  TicketComment    — replies/notes attached to a ticket
  AuditLog         — a record of who did what, and when, per ticket
  RefreshToken     — long-lived tokens used to re-issue access tokens

Relationships between these tables (e.g. "a ticket belongs to a
department") are declared explicitly below using SQLAlchemy's
`relationship()`, which is what lets code elsewhere write
`ticket.department.name` instead of writing a manual JOIN every time.
"""
from sqlalchemy import (
    Column, String, Boolean, DateTime, Text,
    ForeignKey, JSON, Enum as SAEnum
)
from sqlalchemy.orm import relationship, DeclarativeBase
from datetime import datetime, timezone
import uuid
import enum


def utcnow():
    """
    Returns the current time as a timezone-aware UTC datetime.

    Used as the default value for every `created_at` / `updated_at`
    column below. Using timezone-AWARE datetimes (rather than naive
    ones) matters because it avoids a whole category of subtle bugs
    where times get compared or subtracted without anyone noticing
    they're actually in different timezones.
    """
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """SQLAlchemy's declarative base — every table class below inherits
    from this so SQLAlchemy knows to track it as a mapped table."""
    pass


# ─── Enums ────────────────────────────────────────────────────────────────────
# Using Python's `enum` (rather than plain strings) for these three fields
# means the database column is constrained to only ever contain one of
# the listed values — a typo like status="resolvd" fails immediately
# instead of silently corrupting data.

class UserRole(str, enum.Enum):
    """
    Every possible account type in the system.

    Note that the *Python name* (left of `=`) and the *stored value*
    (right of `=`) are different for the two agent roles below — e.g.
    `UserRole.it_support` is the Python-side name used in code, but the
    string actually stored in the database is `"it_support_technician"`.
    Always compare against `.value` or the enum member itself, never a
    hand-typed string, to avoid mismatches.
    """
    employee   = "employee"             # A regular department employee who submits tickets
    ai_intern  = "ai_intern"             # Support agent — handles all HR tickets
    it_support = "it_support_technician" # Support agent — handles IT + Finance tickets
    junior_ops = "junior_operations"     # Support agent — handles Operations tickets
    admin      = "admin"                 # Full dashboard + user management access
    super_admin = "super_admin"          # Reserved for top-level system administration


class TicketStatus(str, enum.Enum):
    """The lifecycle a ticket moves through from creation to close."""
    open             = "open"              # Just created, not yet picked up
    pending          = "pending"           # Waiting on something before work can start
    assigned         = "assigned"          # An agent has been assigned but hasn't started
    in_progress      = "in_progress"       # An agent is actively working on it
    escalated        = "escalated"         # Flagged for priority/senior attention
    waiting_for_user = "waiting_for_user"  # Blocked, waiting on a reply from the submitter
    resolved         = "resolved"          # Fixed, but not yet formally closed
    closed           = "closed"            # Fully closed out


class TicketPriority(str, enum.Enum):
    """
    How urgently a ticket needs attention. This also drives the SLA
    deadline calculation (see ticket_service.py), where each priority
    level is allowed a different number of hours before it's considered
    breached.
    """
    critical = "critical"
    high     = "high"
    medium   = "medium"
    low      = "low"


# ─── Department ───────────────────────────────────────────────────────────────

class Department(Base):
    """
    One of the four business units (HR, IT, Finance, Operations) that
    tickets get classified and routed into. Each department has its own
    accent colour (used in badges/charts throughout the frontend) and an
    optional `routed_agent_role` indicating which agent role normally
    handles its tickets.
    """
    __tablename__ = "departments"

    id               = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name             = Column(String(100), nullable=False, unique=True)   # e.g. "Human Resources"
    slug             = Column(String(50), nullable=False, unique=True)    # e.g. "hr" — used in URLs/seed scripts
    color            = Column(String(10), default="#3B82F6")              # hex colour for UI badges/charts
    description      = Column(Text, nullable=True)
    routed_agent_role = Column(String(50), nullable=True)                 # which UserRole normally handles this dept's tickets
    is_active        = Column(Boolean, default=True)
    created_at       = Column(DateTime, default=utcnow)

    # back_populates links this to the matching relationship on the other
    # side (User.department / Ticket.department), so SQLAlchemy keeps
    # both directions of the relationship in sync automatically.
    users   = relationship("User", back_populates="department")
    tickets = relationship("Ticket", back_populates="department")


# ─── User ─────────────────────────────────────────────────────────────────────

class User(Base):
    """
    Every account in the system — employees, support agents, and admins
    are all rows in this single table, distinguished by the `role`
    column. Which fields matter depends on the role:

      employee  -> uses `department_id` (their own department)
      agent     -> uses `agent_role_key` and `agent_departments`
                   (which department(s) of tickets they're routed)
      admin     -> uses neither; has full access regardless
    """
    __tablename__ = "users"

    id               = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email            = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password  = Column(String(255), nullable=False)  # bcrypt hash — the plaintext password is never stored, see auth_service.py
    full_name        = Column(String(200), nullable=False)
    role             = Column(SAEnum(UserRole), nullable=False, default=UserRole.employee)
    employee_id      = Column(String(50), unique=True, nullable=True)  # human-readable staff ID, e.g. "EMP-0012"

    # --- Employee-specific fields ---
    department_id    = Column(String(36), ForeignKey("departments.id"), nullable=True)

    # --- Agent-specific fields ---
    agent_departments = Column(JSON, default=list)   # reserved for agents who might cover >1 department by ID
    agent_role_key   = Column(String(50), nullable=True)  # e.g. "ai_intern" — drives ticket routing in groq_service.py

    job_title        = Column(String(100), nullable=True)
    office_location  = Column(String(100), nullable=True)
    avatar_url       = Column(String(500), nullable=True)
    is_active        = Column(Boolean, default=True)        # soft-disable flag — inactive users can't log in
    permissions      = Column(JSON, default=list)           # reserved for future fine-grained permission checks
    last_login       = Column(DateTime, nullable=True)
    created_at       = Column(DateTime, default=utcnow)
    updated_at       = Column(DateTime, default=utcnow, onupdate=utcnow)  # auto-refreshes on every update

    department        = relationship("Department", back_populates="users")
    # Two separate relationships to Ticket, because a User can be linked
    # to a ticket in two different ways (as the person who submitted it,
    # or as the agent assigned to resolve it) — `foreign_keys=` tells
    # SQLAlchemy which column on Ticket each relationship should follow.
    submitted_tickets = relationship("Ticket", foreign_keys="Ticket.submitted_by_id", back_populates="submitter")
    assigned_tickets  = relationship("Ticket", foreign_keys="Ticket.assigned_agent_id", back_populates="assigned_agent")
    comments          = relationship("TicketComment", back_populates="author")
    refresh_tokens    = relationship("RefreshToken", back_populates="user")


# ─── Ticket ───────────────────────────────────────────────────────────────────

class Ticket(Base):
    """
    The core entity of the whole application: one support request.

    `ai_classification` is a free-form JSON blob storing everything the
    AI classification step decided about this ticket — which department/
    agent it was routed to, the confidence score, the keyword matches
    that drove the decision, etc. Keeping this as JSON (rather than a
    dozen separate columns) makes it easy to evolve what the classifier
    records without a database migration every time.
    """
    __tablename__ = "tickets"

    id             = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ticket_number  = Column(String(20), unique=True, nullable=False, index=True)  # human-friendly ID, e.g. "TIQ-1001"

    title          = Column(String(500), nullable=False)
    description    = Column(Text, nullable=False)
    status         = Column(SAEnum(TicketStatus), default=TicketStatus.open, nullable=False)
    priority       = Column(SAEnum(TicketPriority), default=TicketPriority.medium, nullable=False)

    submitted_by_id   = Column(String(36), ForeignKey("users.id"), nullable=False)
    department_id     = Column(String(36), ForeignKey("departments.id"), nullable=True)
    assigned_agent_id = Column(String(36), ForeignKey("users.id"), nullable=True)

    ai_classification = Column(JSON, nullable=True)   # full record of how the AI classified/routed this ticket
    sla_deadline      = Column(DateTime, nullable=True)  # when this ticket is due, based on its priority
    sla_breached      = Column(Boolean, default=False)   # set to True once sla_deadline has passed unresolved
    is_escalated      = Column(Boolean, default=False)
    resolution_note   = Column(Text, nullable=True)       # optional note an agent leaves when resolving

    created_at  = Column(DateTime, default=utcnow)
    updated_at  = Column(DateTime, default=utcnow, onupdate=utcnow)
    resolved_at = Column(DateTime, nullable=True)  # set only when status becomes resolved/closed — used for resolution-time analytics

    submitter      = relationship("User", foreign_keys=[submitted_by_id], back_populates="submitted_tickets")
    department     = relationship("Department", back_populates="tickets")
    assigned_agent = relationship("User", foreign_keys=[assigned_agent_id], back_populates="assigned_tickets")
    # cascade="all, delete-orphan" means deleting a ticket also deletes
    # its comments/audit logs automatically — they have no meaning
    # without the parent ticket they belong to.
    comments       = relationship("TicketComment", back_populates="ticket", cascade="all, delete-orphan")
    audit_logs     = relationship("AuditLog", back_populates="ticket", cascade="all, delete-orphan")


# ─── Ticket Comment ───────────────────────────────────────────────────────────

class TicketComment(Base):
    """
    A single reply or note on a ticket. `is_internal` marks notes meant
    only for agents/admins (never shown to the submitting employee);
    `is_ai` marks a comment that was generated by the AI auto-response
    feature rather than typed by a human.
    """
    __tablename__ = "ticket_comments"

    id          = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ticket_id   = Column(String(36), ForeignKey("tickets.id"), nullable=False)
    author_id   = Column(String(36), ForeignKey("users.id"), nullable=False)
    content     = Column(Text, nullable=False)
    is_internal = Column(Boolean, default=False)
    is_ai       = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=utcnow)

    ticket = relationship("Ticket", back_populates="comments")
    author = relationship("User", back_populates="comments")


# ─── Audit Log ────────────────────────────────────────────────────────────────

class AuditLog(Base):
    """
    A lightweight activity trail — one row per notable event (ticket
    created, status changed, escalated, assigned, etc). Used to power
    the "Recent Activity" feed on the admin dashboard. `details` is a
    free-form JSON blob holding whatever extra context that specific
    action needs (e.g. the old and new status for a status change).
    """
    __tablename__ = "audit_logs"

    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ticket_id  = Column(String(36), ForeignKey("tickets.id"), nullable=True)
    user_id    = Column(String(36), ForeignKey("users.id"), nullable=True)
    action     = Column(String(100), nullable=False)   # e.g. "ticket_created", "status_changed"
    details    = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    ticket = relationship("Ticket", back_populates="audit_logs")


# ─── Refresh Token ────────────────────────────────────────────────────────────

class RefreshToken(Base):
    """
    Long-lived tokens used to issue new short-lived access tokens
    without forcing the user to log in again. Storing these in the
    database (rather than just trusting any JWT signed with the right
    secret) means a specific refresh token can be revoked individually —
    e.g. on logout — without invalidating every other session.
    """
    __tablename__ = "refresh_tokens"

    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(String(36), ForeignKey("users.id"), nullable=False)
    token      = Column(String(500), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    revoked    = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="refresh_tokens")
