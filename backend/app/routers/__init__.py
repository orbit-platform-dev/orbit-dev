from fastapi import APIRouter

from . import (
    activity,
    agents,
    calendar,
    chat,
    customers,
    dashboard,
    graph,
    integrations,
    meet,
    meetings,
    projects,
    tasks,
    timeline,
    zoom,
)

api_router = APIRouter()
for module in (meetings, customers, chat, calendar, zoom, meet, agents, projects, tasks,
               graph, timeline, integrations, activity, dashboard):
    api_router.include_router(module.router)
