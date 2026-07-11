from fastapi import APIRouter

from . import (
    activity,
    agents,
    calendar,
    customers,
    dashboard,
    goals,
    insights,
    integrations,
    meet,
    meetings,
    projects,
    tasks,
    timeline,
    zoom,
)

api_router = APIRouter()
for module in (meetings, customers, calendar, zoom, meet, agents, projects, tasks,
               timeline, integrations, insights, goals, activity, dashboard):
    api_router.include_router(module.router)
