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


def _ensure_columns(conn) -> None:
    """Add any model columns missing from existing tables (lightweight, no Alembic).

    `create_all` only creates missing *tables*, never missing *columns*. When the
    schema grows, this idempotently ALTERs in the new columns so existing data
    (e.g. the running Postgres volume) is preserved instead of wiped.
    """
    from sqlalchemy import inspect, text

    insp = inspect(conn)
    existing_tables = set(insp.get_table_names())
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in have:
                continue
            ddl = f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(dialect=conn.dialect)}"
            default = getattr(col.default, "arg", None)
            if default is not None and not callable(default):
                ddl += f" DEFAULT '{default}'"
            conn.execute(text(ddl))


async def init_db() -> None:
    """Create tables, run lightweight column migrations, and seed unless disabled."""
    from . import models  # noqa: F401  (register models)
    from .seed import seed_if_empty

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_ensure_columns)
    if settings.seed_demo:
        async with SessionLocal() as session:
            await seed_if_empty(session)
