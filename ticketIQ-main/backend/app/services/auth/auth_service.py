"""
TicketIQ — Authentication Service
====================================
All the low-level building blocks login/auth needs: hashing and
verifying passwords, issuing and decoding JWT access tokens, issuing
refresh tokens, and looking up users for the auth dependency in
core/deps.py.

This file deliberately has no FastAPI-specific code in it (no routes,
no HTTPException) — it's pure logic that the actual /auth endpoints
(api/v1/endpoints/auth.py) and the get_current_user dependency
(core/deps.py) both call into. Keeping auth logic here rather than
scattered across route handlers means there's exactly one place that
knows how passwords are hashed or how tokens are signed.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import jwt, JWTError
import bcrypt as _bcrypt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.config import settings
from app.models.models import User, RefreshToken
import secrets
import uuid


def hash_password(password: str) -> str:
    """
    One-way hashes a plaintext password using bcrypt. The plaintext
    password is NEVER stored anywhere — only this hash is saved to the
    database (see User.hashed_password in models.py). bcrypt
    automatically generates and embeds a random "salt" per password
    (via gensalt()), so two users with the same password still get
    completely different stored hashes.
    """
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """
    Checks a plaintext password attempt against a stored bcrypt hash.
    Never compares plaintext to plaintext, and never decrypts the hash
    back to plaintext (bcrypt hashing is one-way/irreversible by
    design) — bcrypt re-hashes the attempt with the same embedded salt
    and compares the two hashes instead.
    """
    return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, role: str, extra: dict = None) -> str:
    """
    Issues a short-lived signed JWT access token for a logged-in user.
    This is the token the frontend sends as `Authorization: Bearer
    <token>` on every API request afterwards.

    Standard JWT claims used here:
      sub (subject)     -> the user's ID
      iat (issued at)   -> when this token was created
      exp (expiry)      -> when it stops being valid (see
                            ACCESS_TOKEN_EXPIRE_MINUTES in config.py)
      jti (JWT ID)      -> a random unique ID for this specific token,
                            mainly useful if you ever need to revoke or
                            audit individual tokens
    """
    payload = {
        "sub":  str(user_id),
        "role": role,
        "iat":  datetime.now(timezone.utc),
        "exp":  datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "jti":  str(uuid.uuid4()),
        **(extra or {}),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    """
    Verifies a JWT's signature and expiry, and returns its decoded
    payload. Raises jose.JWTError if the token is invalid, expired, or
    has been tampered with — callers (see core/deps.py) are expected to
    catch that and turn it into a 401 response.
    """
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


async def create_refresh_token(db: AsyncSession, user_id: str) -> str:
    """
    Issues a new long-lived refresh token and stores it in the
    database (see the RefreshToken model). Unlike the access token,
    refresh tokens are NOT JWTs — they're just a long random string
    (secrets.token_urlsafe), because their only job is to be looked up
    in the database later when the frontend needs a new access token.
    Storing them server-side (rather than trusting any signed token)
    is what makes it possible to revoke a single session on logout.
    """
    token_str = secrets.token_urlsafe(64)
    expires   = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    rt = RefreshToken(
        id=str(uuid.uuid4()),
        user_id=str(user_id),
        token=token_str,
        expires_at=expires,
    )
    db.add(rt)
    await db.flush()  # writes to the DB within the current transaction without fully committing yet
    return token_str


async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
    """
    Looks up a user by email and checks their password. Returns the
    User object on success, or None on ANY failure (wrong email, wrong
    password, or inactive account) — deliberately not distinguishing
    which one failed in the return value, so the login endpoint can't
    accidentally leak "that email doesn't exist" vs "wrong password" to
    an attacker probing for valid emails.
    """
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(User)
        .options(selectinload(User.department))  # eager-load department now, to avoid a second query later when the route handler reads user.department
        .where(User.email == email, User.is_active == True)
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user


async def get_user_by_id(db: AsyncSession, user_id: str) -> Optional[User]:
    """
    Looks up a user by their ID — this is what get_current_user (see
    core/deps.py) calls after decoding a request's JWT, to turn the
    token's "sub" claim back into an actual User object.
    """
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(User)
        .options(selectinload(User.department))
        .where(User.id == str(user_id))
    )
    return result.scalar_one_or_none()


def get_redirect_url(role: str) -> str:
    """
    Maps a user's role to the dashboard URL the frontend should send
    them to right after login. Centralizing this mapping here (rather
    than duplicating it in frontend code) means the login response can
    just tell the frontend exactly where to go, instead of the
    frontend needing its own copy of "which role goes where" logic.
    """
    return {
        "employee":              "/dashboard/employee",
        "ai_intern":             "/dashboard/agent",
        "it_support_technician": "/dashboard/agent",
        "junior_operations":     "/dashboard/agent",
        "admin":                 "/dashboard/admin",
        "super_admin":           "/dashboard/admin",
    }.get(role, "/dashboard/employee")  # unknown role falls back to the safest, lowest-privilege dashboard
