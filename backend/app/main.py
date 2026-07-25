"""Orbit API entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__, mcp_server
from .config import settings
from .database import init_db
from .routers import api_router
from .services import heartbeat


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables + seed on startup (idempotent).
    await init_db()
    from .database import SessionLocal
    from .services import embeddings
    from .services.workspace import ensure_workspace_rows

    # Best-effort: these self-heal on the next boot; a busy DB (locks held by a
    # long sync) must never prevent the app from starting and serving.
    try:
        async with SessionLocal() as db:
            await ensure_workspace_rows(db)
            await embeddings.ensure_vector_space(db)
    except Exception:
        import logging

        logging.getLogger("orbit.startup").warning(
            "workspace/vector-space startup guard skipped; will retry next boot", exc_info=True
        )
    # The OS loop: scheduled scans + brief refresh. Reads + insight writes only;
    # it never executes actions or approves anything.
    heartbeat.start()
    # Mounted sub-apps get no lifespan of their own — the MCP transport's
    # session manager must be entered here or every /mcp request 500s.
    async with mcp_server.session_manager():
        yield
    await heartbeat.stop()


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description="The AI Operating System Layer for companies: signals in, evidence-backed intelligence out, "
    "humans approve — your tools stay the system of record.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# Company memory for external AI agents (Claude Code, Cursor, …) — read-only
# MCP tools over Streamable HTTP at /mcp. Auth model documented in mcp_server.py.
app.add_middleware(mcp_server.MCPDispatch)


@app.get("/health", tags=["meta"])
async def health():
    return {
        "status": "ok",
        "version": __version__,
        "environment": settings.environment,
        "ai_enabled": settings.ai_enabled,
        "default_model": settings.default_model,
    }


@app.get("/", tags=["meta"])
async def root():
    return {"name": settings.app_name, "docs": "/docs", "health": "/health"}
