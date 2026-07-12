"""Retire the legacy pipeline: drop the tables that backed meetings, execution
plans, tasks, timeline, knowledge, customers, agents, members, calendar
connections, approvals and sync jobs. The MVP loop keeps workspaces, artifacts,
entities, links, insights, goals, feedback, integrations and activity_events.

Defensive: only drops tables that exist, so it is safe on any dev DB.
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_drop_legacy"
down_revision = "0011_findings"
branch_labels = None
depends_on = None

_LEGACY = [
    "meetings", "projects", "tasks", "timeline_events", "knowledge_items",
    "customers", "agents", "members", "calendar_connections", "approvals", "sync_jobs",
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for name in _LEGACY:
        if name in tables:
            op.drop_table(name)


def downgrade() -> None:
    # One-way retirement; recreate from history if ever needed.
    pass
