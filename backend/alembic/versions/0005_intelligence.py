"""AI-OS intelligence: insights (risks/gaps/trends/briefs) + integration credentials.

Defensive DDL: dev runs uvicorn --reload, and the startup drift-repair
(create_all) can materialize new model tables BEFORE this migration executes,
leaving the version pointer behind. Skip anything that already exists.
"""

import sqlalchemy as sa

from alembic import op

revision = "0005_intelligence"
down_revision = "0004_chat_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("insights"):
        op.create_table(
            "insights",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
            sa.Column("customer_id", sa.String(), nullable=True),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("detail", sa.Text(), nullable=False, server_default=""),
            sa.Column("evidence", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="open"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_insights_customer_id", "insights", ["customer_id"])
        op.create_index("ix_insights_kind", "insights", ["kind"])
    if "credentials" not in {c["name"] for c in inspector.get_columns("integrations")}:
        with op.batch_alter_table("integrations") as batch:
            batch.add_column(sa.Column("credentials", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("integrations") as batch:
        batch.drop_column("credentials")
    op.drop_index("ix_insights_kind", "insights")
    op.drop_index("ix_insights_customer_id", "insights")
    op.drop_table("insights")
