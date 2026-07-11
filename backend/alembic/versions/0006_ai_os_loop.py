"""AI-OS loop: goals (declared intentions), feedback (learning signal),
plan draft snapshots (what the AI originally wrote).

Defensive DDL, same reason as 0005: dev --reload plus the startup drift-repair
can materialize model tables before this migration runs.
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_ai_os_loop"
down_revision = "0005_intelligence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("goals"):
        op.create_table(
            "goals",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("detail", sa.Text(), nullable=False, server_default=""),
            sa.Column("target_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(), nullable=False, server_default="open"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    if not inspector.has_table("feedback"):
        op.create_table(
            "feedback",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
            sa.Column("customer_id", sa.String(), nullable=True),
            sa.Column("plan_id", sa.String(), nullable=True),
            sa.Column("section", sa.String(), nullable=False),
            sa.Column("field", sa.String(), nullable=False),
            sa.Column("before", sa.Text(), nullable=False, server_default=""),
            sa.Column("after", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_feedback_section", "feedback", ["section"])
    if "draft_snapshot" not in {c["name"] for c in inspector.get_columns("projects")}:
        with op.batch_alter_table("projects") as batch:
            batch.add_column(sa.Column("draft_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("draft_snapshot")
    op.drop_index("ix_feedback_section", "feedback")
    op.drop_table("feedback")
    op.drop_table("goals")
