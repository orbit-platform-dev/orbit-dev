"""Scope integrations to a workspace (tenant isolation).

Before: `integrations` was keyed by `key` alone, so one global connector row and
its credentials were shared across every workspace — a cross-tenant data leak.
After: the primary key is (workspace_id, key), so each workspace has its own
connection and credentials.

The table only holds the connector catalog + credentials; the catalog is
reseeded per workspace at runtime, so we rebuild the table rather than migrate
rows in place (any existing connection must be reconnected once).
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_integration_workspace"
down_revision = "0012_drop_legacy"
branch_labels = None
depends_on = None


def _create(pk_cols: list[str]) -> None:
    op.create_table(
        "integrations",
        sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("last_sync", sa.DateTime(timezone=True), nullable=True),
        sa.Column("account", sa.String(), nullable=True),
        sa.Column("stats", sa.JSON(), nullable=True),
        sa.Column("credentials", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint(*pk_cols),
    )


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "integrations" in inspector.get_table_names():
        op.drop_table("integrations")
    _create(["workspace_id", "key"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "integrations" in inspector.get_table_names():
        op.drop_table("integrations")
    # workspace_id column remains but the PK reverts to key-only.
    op.create_table(
        "integrations",
        sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("last_sync", sa.DateTime(timezone=True), nullable=True),
        sa.Column("account", sa.String(), nullable=True),
        sa.Column("stats", sa.JSON(), nullable=True),
        sa.Column("credentials", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )
