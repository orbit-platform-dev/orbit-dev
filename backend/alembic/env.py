"""Alembic environment.

Runs in two modes:
- CLI (`alembic upgrade head`): builds an async engine from app settings.
- In-process (startup bootstrap in app.database.init_db): the app passes its own
  sync connection via `config.attributes["connection"]`.
"""

from __future__ import annotations

from alembic import context
from app import models  # noqa: F401  (register all tables on Base.metadata)
from app.config import settings
from app.database import Base

config = context.config
target_metadata = Base.metadata


def _do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite can't ALTER in place; batch mode rebuilds the table instead.
        render_as_batch=connection.dialect.name == "sqlite",
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_offline() -> None:
    context.configure(url=settings.database_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:  # in-process: reuse the app's connection
        _do_run_migrations(connection)
        return

    import asyncio

    from sqlalchemy.ext.asyncio import create_async_engine

    async def _run() -> None:
        engine = create_async_engine(settings.database_url)
        async with engine.begin() as conn:
            await conn.run_sync(_do_run_migrations)
        await engine.dispose()

    asyncio.run(_run())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
