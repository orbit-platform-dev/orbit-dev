from fastapi import APIRouter

from . import (
    activity,
    agents,
    calendar,
    calls,
    dashboard,
    graph,
    integrations,
    meetings,
    projects,
    tasks,
    timeline,
)

api_router = APIRouter()
for module in (meetings, calls, calendar, agents, projects, tasks, graph, timeline, integrations, activity, dashboard):
    api_router.include_router(module.router)
