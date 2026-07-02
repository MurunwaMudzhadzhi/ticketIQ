"""
TicketIQ — Application Configuration
======================================
Centralizes every environment-driven setting the backend needs: the
database connection, JWT signing secret/expiry, which AI provider to
use for ticket classification, and CORS rules.

All of these are read from environment variables (or a local `.env`
file during development) via pydantic-settings — see the `Config`
inner class below. Nothing here should ever be hardcoded with real
production secrets; the defaults shown are safe placeholders only.

This file also defines two pieces of *static* configuration that
aren't really "settings" in the env-var sense, but live here because
they're small and config-like: AGENT_SKILL_PROFILES (the keyword sets
the AI classifier matches tickets against) and DEPARTMENTS (the four
business units tickets get routed into).
"""
from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List


class Settings(BaseSettings):
    """
    All runtime configuration for the backend, loaded from environment
    variables / the `.env` file. Each field below has a safe default so
    the app can still start in a fresh dev environment without any
    configuration at all — though GROQ_API_KEY being empty means the AI
    features fall back to template-based responses rather than true
    LLM-generated ones (see services/ai/response_service.py).
    """
    DATABASE_URL: str = "sqlite+aiosqlite:///" + __import__('os').path.normpath(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', '..', 'ticketiq.db')).replace('\\', '/')
    SECRET_KEY: str = "change-me-in-production-this-must-be-at-least-32-chars!"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_database_url(cls, v: str) -> str:
        """
        Render (and most hosts) hand out Postgres connection strings as
        `postgres://...` or `postgresql://...`, which is what psql/most
        ORMs expect — but SQLAlchemy's *async* engine needs the driver
        spelled out explicitly as `postgresql+asyncpg://...`. Rewriting
        it here means you can paste Render's connection string straight
        into DATABASE_URL without editing it by hand.
        """
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql+asyncpg://", 1)
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    # ── AI Provider Configuration ─────────────────────────────────────────────
    # Set AI_PROVIDER to: "groq" | "openai" | "anthropic" | "local"
    # The pipeline auto-falls-back if the primary provider is not configured.
    AI_PROVIDER: str = "groq"

    # Groq (primary / default)
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama3-8b-8192"
    GROQ_CLASSIFICATION_MODEL: str = "llama3-8b-8192"

    # OpenAI (optional alternative)
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"

    # Anthropic Claude (optional alternative)
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-haiku-4-5-20251001"

    # Local LLM — any OpenAI-compatible server (Ollama, LM Studio, llama.cpp)
    LOCAL_LLM_BASE_URL: str = ""
    LOCAL_LLM_MODEL: str = "llama3"

    APP_ENV: str = "development"
    CORS_ORIGINS: str = "http://localhost:3000"

    class Config:
        env_file = ".env"   # load values from a local .env file in development
        extra = "ignore"    # ignore any unrecognized env vars instead of erroring

    @property
    def cors_origins_list(self) -> List[str]:
        """
        CORS_ORIGINS is stored as a single comma-separated string (since
        that's what fits cleanly in a .env file); this splits it into
        the actual list FastAPI's CORS middleware expects.
        """
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]


settings = Settings()

# ─────────────────────────────────────────────────────────────────────────────
# AGENT SKILL PROFILES
# ─────────────────────────────────────────────────────────────────────────────
# These are the skill tokens the AI uses when tokenizing a ticket.
# Every agent is available for every department — the AI reads the ticket,
# tokenizes it against each agent's skills, and picks the best match by ID.
#
# You can add more agents in the DB; give them an agent_skill_tokens list
# and they will automatically be considered for routing.
# ─────────────────────────────────────────────────────────────────────────────

AGENT_SKILL_PROFILES = {
    "ai_intern": {
        "display_name": "AI Intern",
        "color": "#8B5CF6",
        "skill_tokens": [
            # HR & People Operations
            "leave", "annual_leave", "sick_leave", "maternity", "paternity", "vacation",
            "payslip", "salary", "pay", "compensation", "bonus",
            "onboarding", "offboarding", "new_hire", "resignation", "termination",
            "hr_policy", "policy", "contract", "employment", "benefits", "pension",
            "performance_review", "appraisal", "training", "learning", "development",
            "workplace_conduct", "harassment", "conflict", "disciplinary",
            "job_change", "promotion", "transfer", "probation",
            "health_insurance", "medical_aid", "wellbeing",
        ],
        "expertise_summary": (
            "Specialist in Human Resources and people operations. "
            "Handles all HR-related matters: leave requests, payslips, employment policies, "
            "onboarding/offboarding, performance reviews, benefits, and employee relations."
        ),
    },
    "it_support_technician": {
        "display_name": "IT Support Technician",
        "color": "#3B82F6",
        "skill_tokens": [
            # IT / Technical
            "password", "vpn", "network", "wifi", "internet", "connectivity",
            "laptop", "computer", "pc", "desktop", "hardware", "device",
            "software", "installation", "install", "update", "upgrade", "crash",
            "bug", "error", "system", "server", "infrastructure", "cloud",
            "email", "outlook", "teams", "slack", "access", "permission",
            "account", "login", "authentication", "2fa", "mfa", "security",
            "printer", "scanner", "monitor", "keyboard", "mouse", "phone",
            "mobile", "backup", "data_recovery", "cybersecurity", "breach",
            "database", "api", "integration", "deployment",
            # Finance / Financial Systems
            "expense", "expense_claim", "reimbursement", "invoice", "receipt",
            "payroll", "salary_discrepancy", "budget", "purchase_order",
            "vendor_payment", "financial_report", "accounting_software",
            "tax", "vat", "audit", "financial_system", "erp", "sap",
            "approval_workflow", "cost_centre", "procurement_system",
        ],
        "expertise_summary": (
            "Technical specialist covering IT infrastructure and financial systems. "
            "Handles hardware, software, networking, system access, cybersecurity, "
            "and all financial processes: expenses, payroll, invoices, budgets, "
            "purchase orders, and accounting software."
        ),
    },
    "junior_operations": {
        "display_name": "Junior Operations",
        "color": "#F59E0B",
        "skill_tokens": [
            # Facilities & Physical Workspace
            "office", "facilities", "maintenance", "repair", "building",
            "desk", "chair", "furniture", "ergonomics",
            "meeting_room", "conference_room", "booking",
            "cleaning", "housekeeping", "sanitization",
            "parking", "access_card", "security_badge", "key_fob",
            "air_conditioning", "heating", "lighting", "plumbing", "elevator",
            # Logistics & Procurement
            "supplies", "stationery", "office_supplies", "consumables",
            "delivery", "courier", "shipment", "inventory",
            "travel", "flight", "hotel", "accommodation", "car_hire",
            "event", "event_logistics", "catering", "venue",
            "vendor", "supplier", "procurement", "purchase_request",
            "company_vehicle", "fleet", "asset_management",
            "health_safety", "fire_safety", "first_aid", "incident",
        ],
        "expertise_summary": (
            "Operations specialist for physical workspace, logistics, and procurement. "
            "Handles facilities maintenance, office supplies, meeting room setup, "
            "building access, travel bookings, event logistics, vendor management, "
            "deliveries, company vehicles, and health & safety."
        ),
    },
}

# The four business units every ticket gets classified into. This is the
# canonical definition; scripts/seed_data.py and scripts/reseed.py both
# read from a copy of this same list when populating a fresh database,
# so if you add a department here, update those seed scripts too.
DEPARTMENTS = [
    {"name": "Human Resources",       "slug": "hr",         "color": "#8B5CF6", "description": "Employee relations, benefits, policies, leave"},
    {"name": "Information Technology","slug": "it",         "color": "#3B82F6", "description": "Hardware, software, network, system access"},
    {"name": "Finance",               "slug": "finance",    "color": "#10B981", "description": "Expenses, payroll, invoices, budget"},
    {"name": "Operations",            "slug": "operations", "color": "#F59E0B", "description": "Facilities, logistics, procurement, maintenance"},
]
