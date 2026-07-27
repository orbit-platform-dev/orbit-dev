"""Beta chat credits: `user_credits` + `workspaces.credit_default`.

One credit = one answered chat question, metered per person per workspace so a
single member running out never blocks their team. The grant lives in the DB (not
in code) so a workspace can be raised without a deploy.
"""

import sqlalchemy as sa

from alembic import op

revision = "0019_user_credits"
down_revision = "0018_workspace_mcp_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("workspaces"):
        cols = {c["name"] for c in inspector.get_columns("workspaces")}
        if "credit_default" not in cols:
            op.add_column(
                "workspaces",
                sa.Column("credit_default", sa.Integer(), nullable=False, server_default="5"),
            )

    if not inspector.has_table("user_credits"):
        op.create_table(
            "user_credits",
            sa.Column("workspace_id", sa.String(), primary_key=True, server_default="ws_default"),
            sa.Column("user_id", sa.String(), primary_key=True),
            sa.Column("granted", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("user_credits"):
        op.drop_table("user_credits")
    if inspector.has_table("workspaces"):
        cols = {c["name"] for c in inspector.get_columns("workspaces")}
        if "credit_default" in cols:
            op.drop_column("workspaces", "credit_default")
