"""Persist the auto-sync toggle: `workspaces.auto_sync`.

Previously the toggle lived in process memory, so it reset on every restart and
never gated Cloud Scheduler ticks (which run in a different request/instance).
Now it is per-workspace state honored by every scheduled tick path.
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_workspace_auto_sync"
down_revision = "0014_feedback_embedding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("workspaces"):
        return
    cols = {c["name"] for c in inspector.get_columns("workspaces")}
    if "auto_sync" not in cols:
        op.add_column(
            "workspaces",
            sa.Column("auto_sync", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("workspaces"):
        cols = {c["name"] for c in inspector.get_columns("workspaces")}
        if "auto_sync" in cols:
            op.drop_column("workspaces", "auto_sync")
