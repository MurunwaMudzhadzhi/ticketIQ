"""
TicketIQ — Database Engine & Session Setup
=============================================
Sets up the async SQLAlchemy engine and session factory the rest of
the app uses to talk to the database, plus two helpers:

  get_db()  — FastAPI dependency that hands a route handler a database
              session for the duration of that one request, and
              automatically commits or rolls back when the request
              finishes (see below for exactly how).
  init_db() — creates all tables from the models in models.py if they
              don't already exist. Called once at app startup (see
              main.py) and also by the seed scripts, so a brand new
              database is ready to use without a separate migration
              step.

The engine configuration branches between SQLite (used for local
development — see DATABASE_URL in config.py) and a real server-based
database like PostgreSQL (used in production), because SQLite needs a
couple of special-case settings that a production database doesn't.
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.core.config import settings
from app.models.models import Base

# Render's managed Postgres (and most hosts) hand back a connection
# string with the plain "postgresql://" or legacy "postgres://" scheme.
# SQLAlchemy's async engine needs the driver named explicitly in the
# scheme so it knows to use asyncpg instead of a sync driver — this
# normalizes either form to "postgresql+asyncpg://" without requiring
# the DATABASE_URL env var itself to be edited by hand.
database_url = settings.DATABASE_URL
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

# SQLite: no pool_size/max_overflow (not supported by StaticPool)
connect_args = {}
engine_kwargs = {
    "echo": settings.APP_ENV == "development",  # log every SQL statement in dev, stay quiet in production
    "pool_pre_ping": True,                        # check a connection is still alive before reusing it from the pool
}

if database_url.startswith("sqlite"):
    # SQLite-specific setup: `check_same_thread=False` is required
    # because FastAPI's async event loop may touch the connection from
    # a different thread than the one that created it, and `StaticPool`
    # keeps a single shared connection alive for the whole app's
    # lifetime (SQLite doesn't support the kind of multi-connection
    # pooling a real database server does).
    from sqlalchemy.pool import StaticPool
    connect_args = {"check_same_thread": False}
    engine_kwargs["connect_args"] = connect_args
    engine_kwargs["poolclass"] = StaticPool
else:
    # Real connection pooling for a production-grade database (e.g.
    # PostgreSQL): keep up to 10 connections open and ready, and allow
    # up to 20 more temporarily during traffic spikes.
    engine_kwargs["pool_size"] = 10
    engine_kwargs["max_overflow"] = 20

engine = create_async_engine(database_url, **engine_kwargs)

# The session factory every part of the app uses to open a new database
# session. `expire_on_commit=False` means objects fetched from the
# database stay usable after a commit (without this, SQLAlchemy would
# mark them "expired" and force a fresh database round-trip the next
# time any of their attributes are accessed).
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def get_db():
    """
    FastAPI dependency that provides a single database session scoped
    to one request. Used throughout the app as:

        db: AsyncSession = Depends(get_db)

    The commit/rollback/close pattern here is the standard "session per
    request" lifecycle: if the route handler's code runs without
    raising an exception, the session commits automatically once the
    handler finishes; if anything raised an exception, the whole
    transaction rolls back instead — so a route handler never has to
    remember to call `db.commit()` itself, and a half-finished change
    can never get saved by accident.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """
    Creates every table defined in models.py if it doesn't already
    exist. Safe to call on a database that already has tables — SQLAlchemy's
    `create_all` is a no-op for tables that are already present, which is
    what makes this safe to run every time the app starts (see main.py)
    without wiping or duplicating anything.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)