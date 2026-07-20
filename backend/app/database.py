"""Async SQLAlchemy engine + session factory."""
import ssl
from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

_url = make_url(settings.database_url)
if settings.db_password:
    _url = _url.set(password=settings.db_password)
_is_sqlite = _url.get_backend_name() == "sqlite"

_connect_args: dict = {}
if _is_sqlite:
    _connect_args["timeout"] = 30
elif _url.get_backend_name() == "postgresql":
    _url = _url.set(drivername="postgresql+asyncpg")
    _host = _url.host or _url.query.get("host") or ""
    _url = _url.difference_update_query(["sslmode", "ssl", "channel_binding"])
    if not str(_host).startswith("/"):
        _ctx = ssl.create_default_context()
        _ctx.check_hostname = False
        _ctx.verify_mode = ssl.CERT_NONE
        _connect_args["ssl"] = _ctx
    _connect_args["statement_cache_size"] = 0

engine = create_async_engine(_url, echo=False, future=True, connect_args=_connect_args)

if _is_sqlite:
    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

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
    from sqlalchemy import inspect, text

    is_pg = conn.dialect.name == "postgresql"
    if is_pg:
        # pgvector's `vector` type must exist BEFORE any CREATE TABLE with a
        # Vector column — both the fresh create_all path below and migration 0009
        # on managed DBs. Without this a brand-new Postgres fails to boot.
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

    insp = inspect(conn)
    cfg = _alembic_config(conn)
    if not insp.has_table("workspaces"):
        Base.metadata.create_all(conn)
        if is_pg:
            # create_all only builds model-declared indexes; the HNSW vector index
            # is raw DDL (migration 0009), so the fresh path must add it too or
            # native similarity search falls back to an unindexed scan.
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_artifacts_embedding ON artifacts "
                "USING hnsw (embedding vector_cosine_ops)"))
        command.stamp(cfg, "head")
    elif not insp.has_table("alembic_version"):
        command.stamp(cfg, "0001_baseline")
        command.upgrade(cfg, "head")
        _repair_pre_alembic_drift(conn)
    else:
        command.upgrade(cfg, "head")
        _repair_pre_alembic_drift(conn)


async def init_db() -> None:
    """Migrate to head (Alembic), then ensure the workspace + connector catalog."""
    from . import models  # noqa: F401  (register models)
    from .seed import ensure_integrations
    from .services.workspace import ensure_default_workspace

    async with engine.begin() as conn:
        await conn.run_sync(_migrate)
    async with SessionLocal() as session:
        await ensure_default_workspace(session)
        await ensure_integrations(session)
        await session.commit()
