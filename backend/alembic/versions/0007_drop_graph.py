"""Drop the per-meeting execution graph (product simplification 2026-07-11).

The graph was a per-meeting render, not company memory — removed everywhere
(models, persistence, router, UI). Defensive DDL as usual for --reload drift.
"""
from alembic import op
import sqlalchemy as sa

revision = "0007_drop_graph"
down_revision = "0006_ai_os_loop"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("graph_edges"):
        op.drop_table("graph_edges")
    if inspector.has_table("graph_nodes"):
        op.drop_table("graph_nodes")


def downgrade() -> None:
    # The graph is gone from the codebase; there is nothing meaningful to restore.
    pass
