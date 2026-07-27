from fastapi import APIRouter

from . import artifacts, chat, credits, entities, feedback, findings, goals, integrations, internal, webhooks

api_router = APIRouter()
for module in (artifacts, chat, credits, entities, feedback, findings, goals, integrations, internal, webhooks):
    api_router.include_router(module.router)
