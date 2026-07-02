"""
TicketIQ — Shared FastAPI Dependencies
=========================================
Reusable building blocks injected into route handlers via FastAPI's
`Depends()` mechanism. The most important one is `get_current_user`,
which every protected endpoint depends on (directly or indirectly) to
identify who's making the request.

Quick reference for endpoint authors:
  get_current_user        -> any logged-in user, any role
  require_roles("admin")  -> only the listed role(s) may proceed
  is_agent(user) / is_admin(user) -> plain boolean checks for use
                                      inside a handler's own logic
                                      (e.g. to branch behaviour),
                                      rather than as a Depends() gate
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.services.auth.auth_service import decode_token, get_user_by_id
from app.models.models import User
from jose import JWTError

# FastAPI's built-in "Bearer <token>" auth scheme — this is what makes
# the interactive API docs (/api/v1/docs) show an "Authorize" button
# and what extracts the token out of the Authorization header for us.
bearer = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    The core auth dependency: validates the JWT access token on the
    request, looks up the corresponding user, and returns it.

    Add `current_user: User = Depends(get_current_user)` as a parameter
    on any route that should require login — FastAPI runs this
    automatically before the route handler's own code executes, and
    raises a 401 itself if anything here fails, so the handler body
    never has to check "is this person logged in" manually.
    """
    try:
        payload = decode_token(credentials.credentials)
        user_id = payload.get("sub")  # "sub" (subject) is the standard JWT claim for "who is this token about"
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        # Covers both a malformed token and a token that has expired —
        # decode_token() raises JWTError for both cases.
        raise HTTPException(status_code=401, detail="Token expired or invalid")

    user = await get_user_by_id(db, user_id)
    if not user or not user.is_active:
        # Covers both "user no longer exists" (deleted) and "user has
        # been deactivated" (is_active=False) — either way, a
        # previously-valid token should stop working immediately.
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def require_roles(*roles: str):
    """
    Returns a FastAPI dependency that only allows the given role(s)
    through, raising 403 Forbidden for anyone else. Used like:

        @router.get("/admin-only-thing")
        async def handler(user: User = Depends(require_roles("admin", "super_admin"))):
            ...

    This is a "dependency factory" — calling require_roles(...) builds
    and returns the actual checker function, which is what FastAPI then
    calls on every request to that route.
    """
    async def checker(current_user: User = Depends(get_current_user)) -> User:
        # role can be either the enum member or a plain string depending
        # on context, so normalize to its string value before comparing.
        role_val = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
        if role_val not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {roles}",
            )
        return current_user
    return checker


def is_agent(user: User) -> bool:
    """
    Plain boolean check (not a Depends() dependency) for "is this user
    one of the three support-agent roles". Useful inside a handler body
    when the logic needs to branch on agent-ness rather than reject
    non-agents outright — e.g. "show different ticket fields to agents
    vs employees" rather than "block non-agents entirely".
    """
    agent_roles = {"ai_intern", "it_support_technician", "junior_operations"}
    role_val = user.role.value if hasattr(user.role, 'value') else str(user.role)
    return role_val in agent_roles


def is_admin(user: User) -> bool:
    """Plain boolean check for "is this user an admin or super_admin"."""
    role_val = user.role.value if hasattr(user.role, 'value') else str(user.role)
    return role_val in ("admin", "super_admin")
