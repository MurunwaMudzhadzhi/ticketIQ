"""
TicketIQ — Admin Endpoints
==============================
User and department management, restricted to admin/super_admin
accounts only via the `AdminOnly` dependency defined below:

  GET    /admin/users                — list every user account
  POST   /admin/users                — create a new user account
  PATCH  /admin/users/{id}           — update an existing user
  GET    /admin/departments          — list every department
  POST   /admin/departments          — create a new department
  PATCH  /admin/departments/{id}     — update a department
  DELETE /admin/departments/{id}     — delete a department
  GET    /admin/system-stats         — high-level counts for the admin settings page

This is the one place in the backend where accounts get created
directly (as opposed to self-registration, which this app doesn't
have — see scripts/seed_data.py for how the demo accounts are seeded
instead). Every route here depends on AdminOnly, so a non-admin calling
any of these gets a 403 before the handler body even runs.
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, EmailStr
from typing import Optional, Any
import uuid

from app.db.session import get_db
from app.core.deps import get_current_user, require_roles
from app.models.models import User, Department, UserRole
from app.services.auth.auth_service import hash_password
from app.core.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])

# A single reusable dependency requiring either admin or super_admin —
# every route below depends on this rather than repeating the role
# check inline. See require_roles() in core/deps.py for how it works.
AdminOnly = require_roles("admin", "super_admin")


def _user_dict(u: User) -> dict:
    """
    Converts a User row into the dict shape returned by the admin user
    list/management endpoints. Deliberately never includes
    `hashed_password` — this is the boundary that keeps password
    hashes out of any admin-facing API response.
    """
    return {
        "id":                str(u.id),
        "email":             u.email,
        "full_name":         u.full_name,
        "role":              u.role.value if hasattr(u.role, "value") else str(u.role),
        "employee_id":       u.employee_id,
        "department_id":     u.department_id,
        "department_name":   u.department.name if u.department else None,
        "agent_departments": u.agent_departments or [],
        "agent_role_key":    u.agent_role_key,
        "job_title":         u.job_title,
        "is_active":         u.is_active,
        "created_at":        u.created_at.isoformat() if u.created_at else None,
    }


@router.get("/users")
async def list_users(
    _:  User = Depends(AdminOnly),
    db: AsyncSession = Depends(get_db),
):
    """Returns every user account in the system, oldest first — powers the admin user management table."""
    result = await db.execute(
        select(User).options(selectinload(User.department)).order_by(User.created_at)
    )
    return [_user_dict(u) for u in result.scalars().all()]


class CreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: str
    department_id: Optional[str] = None
    agent_departments: Optional[list] = None
    agent_role_key: Optional[str] = None
    job_title: Optional[str] = None
    employee_id: Optional[str] = None


@router.post("/users")
async def create_user(
    req: CreateUserRequest,
    _:   User = Depends(AdminOnly),
    db:  AsyncSession = Depends(get_db),
):
    """
    Creates a new user account (employee, agent, or admin) directly —
    used by the admin "add user" form in the frontend. The password is
    hashed before storage exactly the same way as everywhere else (see
    hash_password() in auth_service.py), so there's no separate or
    weaker password-handling path just because an admin is creating the
    account rather than the user signing up themself.
    """
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already exists")

    user = User(
        email             = req.email,
        full_name         = req.full_name,
        hashed_password   = hash_password(req.password),
        role              = UserRole(req.role),
        department_id     = req.department_id,
        agent_departments = req.agent_departments or [],
        agent_role_key    = req.agent_role_key,
        job_title         = req.job_title,
        employee_id       = req.employee_id,
    )
    db.add(user)
    await db.flush()
    return _user_dict(user)


class UpdateUserRequest(BaseModel):
    full_name:        Optional[str]  = None
    job_title:        Optional[str]  = None
    agent_role_key:   Optional[str]  = None
    agent_departments: Optional[list] = None
    is_active:        Optional[bool] = None


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    req:     UpdateUserRequest,
    _:       User = Depends(AdminOnly),
    db:      AsyncSession = Depends(get_db),
):
    """
    Partially updates a user account. `exclude_unset=True` below means
    only fields the admin actually sent in the request get changed —
    fields left out of the request body are left completely untouched,
    rather than being reset to None/default. This is what lets the
    frontend send e.g. just `{"is_active": false}` to deactivate a user
    without having to resend their full_name, job_title, etc unchanged.
    """
    result = await db.execute(select(User).options(selectinload(User.department)).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    patch = req.model_dump(exclude_unset=True)
    for field, value in patch.items():
        setattr(user, field, value)

    return _user_dict(user)


def _dept_dict(d: Department) -> dict:
    """Converts a Department row into the dict shape used by the admin department management endpoints."""
    return {
        "id":                str(d.id),
        "name":              d.name,
        "slug":              d.slug,
        "color":             d.color,
        "description":       d.description,
        "routed_agent_role": d.routed_agent_role,
        "is_active":         d.is_active,
        "created_at":        d.created_at.isoformat() if d.created_at else None,
    }


class CreateDepartmentRequest(BaseModel):
    name:              str
    slug:              str
    color:             Optional[str] = "#3B82F6"
    description:       Optional[str] = None
    routed_agent_role: Optional[str] = None


class UpdateDepartmentRequest(BaseModel):
    name:              Optional[str]  = None
    color:             Optional[str]  = None
    description:       Optional[str]  = None
    routed_agent_role: Optional[str]  = None
    is_active:         Optional[bool] = None


@router.get("/departments")
async def list_departments(
    _:  User = Depends(AdminOnly),
    db: AsyncSession = Depends(get_db),
):
    """Returns every department, alphabetically — powers the admin department management page."""
    result = await db.execute(select(Department).order_by(Department.name))
    return [_dept_dict(d) for d in result.scalars().all()]


@router.post("/departments")
async def create_department(
    req: CreateDepartmentRequest,
    _:   User = Depends(AdminOnly),
    db:  AsyncSession = Depends(get_db),
):
    """
    Creates a new department. The `slug` must be unique (it's used as
    the stable machine-readable identifier elsewhere, e.g. in AI
    classification results and seed scripts — see DEPARTMENTS in
    core/config.py), so it's checked for collisions before creating.
    """
    existing = await db.execute(select(Department).where(Department.slug == req.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Slug already exists")
    dept = Department(
        id=str(uuid.uuid4()),
        name=req.name,
        slug=req.slug,
        color=req.color,
        description=req.description,
        routed_agent_role=req.routed_agent_role,
    )
    db.add(dept)
    await db.flush()
    return _dept_dict(dept)


@router.patch("/departments/{dept_id}")
async def update_department(
    dept_id: str,
    req:     UpdateDepartmentRequest,
    _:       User = Depends(AdminOnly),
    db:      AsyncSession = Depends(get_db),
):
    """Partially updates a department, same exclude_unset pattern as update_user() above."""
    result = await db.execute(select(Department).where(Department.id == dept_id))
    dept = result.scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(dept, field, value)
    return _dept_dict(dept)


@router.delete("/departments/{dept_id}")
async def delete_department(
    dept_id: str,
    _:       User = Depends(AdminOnly),
    db:      AsyncSession = Depends(get_db),
):
    """
    Deletes a department outright. Note: tickets and users referencing
    this department (via department_id) have that column nullable (see
    models.py), so they aren't deleted along with it — they simply end
    up with a null department reference rather than being cascade-deleted,
    which avoids accidentally wiping out ticket history just because a
    department was reorganized away.
    """
    result = await db.execute(select(Department).where(Department.id == dept_id))
    dept = result.scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    await db.delete(dept)
    return {"ok": True}


@router.get("/system-stats")
async def system_stats(
    _:  User = Depends(AdminOnly),
    db: AsyncSession = Depends(get_db),
):
    """
    High-level system counts shown on the admin settings page. The
    db_engine/ai_model fields are read live from the actual configured
    settings (see core/config.py) rather than hardcoded, so this stays
    accurate if the deployment switches database or AI model without
    anyone remembering to update a string here.
    """
    from sqlalchemy import func
    from app.models.models import Ticket
    total_users   = await db.execute(select(func.count(User.id)))
    total_tickets = await db.execute(select(func.count(Ticket.id)))
    active_users  = await db.execute(select(func.count(User.id)).where(User.is_active == True))
    total_depts   = await db.execute(select(func.count(Department.id)))

    # Derive a friendly engine name from the actual configured
    # DATABASE_URL, rather than a hardcoded "SQLite" string that would
    # quietly become wrong the moment this app is pointed at a real
    # production database (e.g. PostgreSQL).
    db_url = settings.DATABASE_URL
    if db_url.startswith("sqlite"):
        db_engine_label = "SQLite (aiosqlite)"
    elif db_url.startswith("postgres"):
        db_engine_label = "PostgreSQL"
    elif db_url.startswith("mysql"):
        db_engine_label = "MySQL"
    else:
        db_engine_label = db_url.split("://")[0]

    return {
        "total_users":   total_users.scalar()  or 0,
        "active_users":  active_users.scalar() or 0,
        "total_tickets": total_tickets.scalar() or 0,
        "total_departments": total_depts.scalar() or 0,
        "app_version":   "1.0.0",
        "app_env":       settings.APP_ENV,
        "db_engine":     db_engine_label,
        "ai_model":      f"{settings.GROQ_MODEL} (Groq)" if settings.GROQ_API_KEY and not settings.GROQ_API_KEY.startswith("gsk_your") else "Not configured (using keyword fallback)",
    }
