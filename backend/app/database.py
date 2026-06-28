"""Async SQLAlchemy engine + session factory."""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

engine = create_async_engine(settings.database_url, echo=False, future=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    """Create tables, and seed the demo dataset unless SEED_DEMO is disabled."""
    from . import models  # noqa: F401  (register models)
    from .seed import seed_if_empty

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    if settings.seed_demo:
        async with SessionLocal() as session:
            await seed_if_empty(session)
