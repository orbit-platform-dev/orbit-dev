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


def _alembic_config(conn):
    from pathlib import Path

    from alembic.config import Config

    cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    cfg.attributes["connection"] = conn
    return cfg


def _repair_pre_alembic_drift(conn) -> None:
    """Create any missing tables and ALTER in any missing columns after migrations.

    Dev databases created before Alembic got their tables from create_all and
    their columns from an ad-hoc auto-ALTER, both run at every startup — so
    individual DBs can sit anywhere between the very first schema and the 0001
    baseline. Migrations only cover baseline→head; this trues up the
    pre-baseline gap. Idempotent, additive only.
    """
    from sqlalchemy import inspect, text

    Base.metadata.create_all(conn)  # creates missing tables only, never touches existing ones
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


def _migrate(conn) -> None:
    """Bring the schema to head via Alembic (sync context under run_sync).

    - Fresh DB: create_all (fast, complete) then stamp head.
    - Pre-Alembic DB (tables but no alembic_version): stamp baseline, upgrade.
    - Managed DB: plain upgrade to head.
    """
    from alembic import command
    from sqlalchemy import inspect

    insp = inspect(conn)
    cfg = _alembic_config(conn)
    if not insp.has_table("meetings"):
        Base.metadata.create_all(conn)
        command.stamp(cfg, "head")
    elif not insp.has_table("alembic_version"):
        command.stamp(cfg, "0001_baseline")
        command.upgrade(cfg, "head")
        _repair_pre_alembic_drift(conn)
    else:
        command.upgrade(cfg, "head")
        _repair_pre_alembic_drift(conn)


async def _backfill_customers(session) -> None:
    """Idempotently attach legacy rows (account string only) to Customer entities."""
    from sqlalchemy import select

    from .models import ExecutionPlan, Meeting
    from .services.customers import resolve_customer
    from .services.workspace import DEFAULT_WORKSPACE_ID, ensure_default_workspace

    await ensure_default_workspace(session)
    meetings = (await session.execute(
        select(Meeting).where(Meeting.customer_id.is_(None)))).scalars().all()
    for m in meetings:
        c = await resolve_customer(session, m.workspace_id or DEFAULT_WORKSPACE_ID, m.account)
        if c:
            m.customer_id = c.id
    plans = (await session.execute(
        select(ExecutionPlan).where(ExecutionPlan.customer_id.is_(None),
                                    ExecutionPlan.source_meeting_id.is_not(None)))).scalars().all()
    for p in plans:
        m = await session.get(Meeting, p.source_meeting_id)
        if m and m.customer_id:
            p.customer_id = m.customer_id
    await session.commit()


async def _backfill_embeddings(session, limit: int = 100) -> None:
    """Embed pre-existing rows so semantic retrieval covers old history.
    Capped per boot; skipped entirely when embeddings are unavailable."""
    from sqlalchemy import select

    from .models import KnowledgeItem, Meeting
    from .services import embeddings

    if not embeddings.available():
        return
    meetings = (await session.execute(
        select(Meeting).where(Meeting.embedding.is_(None), Meeting.analysis.is_not(None))
        .limit(limit))).scalars().all()
    for m in meetings:
        a = m.analysis or {}
        m.embedding = await embeddings.embed_text(
            f"{m.title}\n{a.get('summary', '')}\n" + " ".join(a.get("keyTakeaways", [])))
    items = (await session.execute(
        select(KnowledgeItem).where(KnowledgeItem.embedding.is_(None)).limit(limit))).scalars().all()
    for item in items:
        text = f"[{item.kind}] {item.title}\n" + "\n".join(
            str(v) for v in (item.content or {}).values() if isinstance(v, str) and v)
        item.embedding = await embeddings.embed_text(text[:2000])
    await session.commit()


async def init_db() -> None:
    """Migrate to head (Alembic), seed, and backfill customer links + embeddings."""
    from . import models  # noqa: F401  (register models)
    from .seed import ensure_integrations, seed_if_empty

    async with engine.begin() as conn:
        await conn.run_sync(_migrate)
    async with SessionLocal() as session:
        if settings.seed_demo:
            await seed_if_empty(session)
        # Always ensure the integration catalog exists (even on a non-empty DB).
        await ensure_integrations(session)
        await _backfill_customers(session)
        await _backfill_embeddings(session)
