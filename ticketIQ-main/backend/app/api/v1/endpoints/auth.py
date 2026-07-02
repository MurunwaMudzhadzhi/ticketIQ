"""
TicketIQ — Auth Endpoints
============================
Everything related to logging in, staying logged in, and logging out:

  POST /auth/login            — email + password -> access + refresh tokens
  POST /auth/refresh          — exchange a refresh token for a new access token
  POST /auth/logout           — revoke a refresh token
  GET  /auth/me               — return the current logged-in user's profile
  POST /auth/change-password  — change your own password

All the actual cryptographic/database work (hashing, token signing,
lookups) lives in services/auth/auth_service.py — this file is just the
HTTP-facing layer: parse the request, call the service functions, shape
the response, and return the right HTTP status on failure.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.models import User, RefreshToken
from app.services.auth.auth_service import (
    authenticate_user, create_access_token, create_refresh_token,
    hash_password, get_redirect_url
)
import uuid

router = APIRouter(prefix="/auth", tags=["auth"])


# ─── Request bodies ───────────────────────────────────────────────────────────
# Pydantic models describing exactly what JSON shape each endpoint
# expects — FastAPI uses these to validate incoming requests
# automatically (e.g. rejecting a login request with no password
# before our own code even runs) and to generate the API docs.

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


def _user_to_dict(user: User) -> dict:
    """
    Converts a User database row into the plain dict shape sent to the
    frontend. Centralized here so every endpoint that returns user info
    (login, /me) returns an identical shape — the frontend only needs
    to know one "user object" format, not several slightly different
    ones depending on which endpoint it called.

    Notably, `hashed_password` is never included here — this function
    is the boundary that keeps the password hash from ever accidentally
    leaking into an API response.
    """
    role_val = user.role.value if hasattr(user.role, 'value') else str(user.role)
    return {
        "id":                   str(user.id),
        "email":                user.email,
        "full_name":            user.full_name,
        "role":                 role_val,
        "employee_id":          user.employee_id,
        "department_id":        str(user.department_id) if user.department_id else None,
        "department_name":      user.department.name if user.department else None,
        "agent_departments":    user.agent_departments or [],
        "agent_role_key":       user.agent_role_key,
        "job_title":            user.job_title,
        "office_location":      user.office_location,
        "avatar_url":           user.avatar_url,
        "permissions":          user.permissions or [],
    }


@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Validates email + password, and on success issues both an access
    token (short-lived, sent on every API request) and a refresh token
    (long-lived, stored by the frontend and used only to get a new
    access token once the current one expires). Also tells the
    frontend which dashboard URL to redirect to, based on the user's role.
    """
    user = await authenticate_user(db, req.email, req.password)
    if not user:
        # Deliberately the same generic error whether the email doesn't
        # exist or the password is wrong — see authenticate_user()'s
        # docstring for why.
        raise HTTPException(status_code=401, detail="Invalid email or password")

    role_val = user.role.value if hasattr(user.role, 'value') else str(user.role)
    access_token = create_access_token(str(user.id), role_val)
    refresh_token = await create_refresh_token(db, str(user.id))

    user.last_login = datetime.now(timezone.utc)

    return {
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "token_type":    "bearer",
        "user":          _user_to_dict(user),
        "redirect_url":  get_redirect_url(role_val),
    }


@router.post("/refresh")
async def refresh_token(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """
    Exchanges a still-valid refresh token for a brand new access token,
    without requiring the user to re-enter their password. This is what
    the frontend's axios interceptor (see frontend/src/lib/api.ts) calls
    automatically whenever a request comes back 401 because the access
    token expired — from the user's point of view, their session just
    keeps working seamlessly.
    """
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token == req.refresh_token,
            RefreshToken.revoked == False,
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    rt = result.scalar_one_or_none()
    if not rt:
        # Covers a refresh token that's unknown, already revoked (e.g.
        # from a previous logout), or simply expired.
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    from sqlalchemy.orm import selectinload
    user_result = await db.execute(
        select(User).options(selectinload(User.department)).where(User.id == rt.user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found")

    role_val = user.role.value if hasattr(user.role, 'value') else str(user.role)
    new_access = create_access_token(str(user.id), role_val)

    return {"access_token": new_access, "token_type": "bearer"}


@router.post("/logout")
async def logout(req: LogoutRequest, db: AsyncSession = Depends(get_db)):
    """
    Revokes a single refresh token, ending that one session. Doesn't
    require the access token to still be valid (a user should be able
    to log out even with an expired session) — only the refresh token
    itself is needed.
    """
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token == req.refresh_token)
    )
    rt = result.scalar_one_or_none()
    if rt:
        rt.revoked = True
    # Always returns success even if the token wasn't found — from the
    # frontend's perspective, "log out" should never visibly fail.
    return {"message": "Logged out"}


@router.get("/me")
async def me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the currently logged-in user's own profile. Used by the
    frontend on page load to restore session state (e.g. "who am I,
    what's my role, which dashboard should I be on") without needing to
    re-send login credentials.
    """
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(User).options(selectinload(User.department)).where(User.id == current_user.id)
    )
    user = result.scalar_one()
    return _user_to_dict(user)


@router.post("/change-password")
async def change_password(
    req:          ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    """
    Lets a logged-in user change their own password. Requires the
    CURRENT password as proof of identity (rather than just trusting
    the access token alone) — this protects against the case where
    someone gets temporary access to an already-logged-in browser
    session but doesn't know the actual password.
    """
    from app.services.auth.auth_service import verify_password
    if not verify_password(req.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.hashed_password = hash_password(req.new_password)
    return {"message": "Password updated successfully"}
