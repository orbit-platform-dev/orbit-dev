from fastapi import APIRouter

from . import (
    activity,
    agents,
    dashboard,
    graph,
    integrations,
    meetings,
    projects,
    tasks,
    timeline,
)

api_router = APIRouter()
for module in (meetings, agents, projects, tasks, graph, timeline, integrations, activity, dashboard):
    api_router.include_router(module.router)
