from fastapi import APIRouter

from . import artifacts, chat, entities, feedback, findings, goals, integrations, internal, specs, webhooks

api_router = APIRouter()
for module in (artifacts, chat, entities, feedback, findings, goals, integrations, internal, specs, webhooks):
    api_router.include_router(module.router)
