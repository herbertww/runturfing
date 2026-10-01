"""
Runturfing Backend – Database
Async SQLAlchemy session factory and base model.
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.engine.interfaces import BindTyping
from sqlalchemy.orm import DeclarativeBase
from api.config import settings


def _normalize_url(url: str) -> str:
    """Managed Postgres (Railway, Heroku, etc.) hands out postgres:// or
    postgresql:// URLs; SQLAlchemy needs the +asyncpg driver marker. Normalize
    here so the env var can hold whatever the provider injected."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix):]
    return url


engine = create_async_engine(
    _normalize_url(settings.database_url),
    echo=settings.debug,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)

# SQLAlchemy's asyncpg dialect defaults to BindTyping.RENDER_CASTS, which
# renders a cast on every bind parameter typed from the Python value. Every id
# in this codebase is a str, so `WHERE id = :uid` compiled to `id = $1::VARCHAR`
# and Postgres refused it: "operator does not exist: uuid = character varying".
# psycopg2 never did this, which is why the SQL itself reads fine.
#
# BindTyping.NONE lets Postgres infer each parameter's type from its context,
# so a str binds cleanly against a uuid column. The alternative was converting
# ~40 call sites across 9 files to uuid.UUID objects, including every path
# parameter and the JWT subject.
#
# Verified end to end by scripts/smoke_test.py against a real database.
engine.dialect.bind_typing = BindTyping.NONE

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
