"""Orbit API entrypoint."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import settings
from .database import init_db
from .routers import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables + seed on startup (idempotent).
    await init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description="Turns customer meetings into PRDs, plans, tasks and shipped features — orchestrated by AI agents.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


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
