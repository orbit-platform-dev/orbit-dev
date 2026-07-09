"""Baseline — the pre-Alembic schema.

The original 11 tables (members, meetings, agents, projects, tasks,
graph_nodes, graph_edges, timeline_events, integrations, calendar_connections,
activity_events) were historically created by `Base.metadata.create_all`.
Fresh databases are still bootstrapped with create_all and then stamped to
head; this revision exists so pre-Alembic databases have a starting point to
upgrade from.
"""
revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
