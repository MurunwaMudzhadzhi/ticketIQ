"""
TicketIQ — FastAPI Application Entry Point
==============================================
This is the file `uvicorn app.main:app` actually runs. It wires
together everything else in the backend:

  1. Creates the FastAPI app itself (with its docs/OpenAPI URLs)
  2. Configures CORS so the Next.js frontend (running on a different
     port/origin) is allowed to call this API from the browser
  3. Registers every route group (auth, tickets, analytics, admin)
     under a shared /api/v1 prefix
  4. Ensures the database tables exist before the app starts accepting
     requests

Each route group lives in its own file under api/v1/endpoints/ — this
file doesn't define any business logic itself, it just assembles the
pieces.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.db.session import init_db
from app.api.v1.endpoints import auth, tickets, analytics, admin, forecast

app = FastAPI(
    title="TicketIQ Enterprise API",
    description="AI-Powered Enterprise Smart Ticketing Platform",
    version="1.0.0",
    docs_url="/api/v1/docs",            # interactive Swagger UI — handy for manually testing endpoints
    openapi_url="/api/v1/openapi.json", # raw OpenAPI schema, e.g. for generating a typed frontend client
)

# CORS: by default, browsers block a page on one origin (e.g.
# http://localhost:3000, the Next.js frontend) from calling an API on a
# different origin (e.g. http://localhost:8000, this backend) unless
# the API explicitly allows it. `cors_origins_list` (see core/config.py)
# is the whitelist of frontend URLs allowed to do that — in production
# this should be set to the real deployed frontend URL, never "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Every route group gets mounted under /api/v1, so e.g. the login route
# defined as "/auth/login" inside auth.py ends up reachable at
# "/api/v1/auth/login".
app.include_router(auth.router,      prefix="/api/v1")
app.include_router(tickets.router,   prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(forecast.router,  prefix="/api/v1")
app.include_router(admin.router,     prefix="/api/v1")


@app.on_event("startup")
async def startup():
    """
    Runs once, automatically, when the server first starts (not on
    every request). Ensures the database schema exists — see
    db/session.py's init_db() — so a freshly cloned project with an
    empty database "just works" the first time you run it, without a
    separate manual migration step.
    """
    import sys
    # Ensures emoji/unicode in print statements elsewhere in the app
    # don't crash on Windows terminals that default to a non-UTF-8 codec.
    sys.stdout.reconfigure(encoding='utf-8')
    await init_db()
    print("[OK] TicketIQ Enterprise API started")
    print("[DOCS] http://localhost:8000/api/v1/docs")


@app.get("/api/v1/health")
async def health():
    """
    Simple liveness check with no auth required — used by deployment
    platforms (and by anyone debugging) to confirm the server is up and
    responding, before worrying about whether any particular feature
    works.
    """
    return {"status": "ok", "service": "TicketIQ Enterprise"}
