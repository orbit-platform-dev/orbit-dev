from fastapi import APIRouter

from . import artifacts, entities, findings, goals, integrations

api_router = APIRouter()
for module in (artifacts, entities, findings, goals, integrations):
    api_router.include_router(module.router)
