"""Company model: entities (resolved nodes) + links (typed relationships).

The Understand layer over observed memory. Defensive DDL, same reason as
0005/0006/0009: dev --reload plus the startup drift-repair can materialize the
model tables before this migration runs.
"""

import sqlalchemy as sa

from alembic import op

revision = "0010_company_model"
down_revision = "0009_artifact_memory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("entities"):
        op.create_table(
            "entities",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("normalized_name", sa.String(), nullable=False),
            sa.Column("aliases", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("identifiers", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("meta", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("state", sa.String(), nullable=False, server_default="open"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_entities_workspace_id", "entities", ["workspace_id"])
        op.create_index("ix_entities_kind", "entities", ["kind"])
        op.create_index("ix_entities_normalized_name", "entities", ["normalized_name"])
    if not inspector.has_table("links"):
        op.create_table(
            "links",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
            sa.Column("from_type", sa.String(), nullable=False),
            sa.Column("from_id", sa.String(), nullable=False),
            sa.Column("to_type", sa.String(), nullable=False),
            sa.Column("to_id", sa.String(), nullable=False),
            sa.Column("type", sa.String(), nullable=False),
            sa.Column("source_artifact_id", sa.String(), nullable=True),
            sa.Column("meta", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_links_workspace_id", "links", ["workspace_id"])
        op.create_index("ix_links_from_id", "links", ["from_id"])
        op.create_index("ix_links_to_id", "links", ["to_id"])


def downgrade() -> None:
    op.drop_index("ix_links_to_id", "links")
    op.drop_index("ix_links_from_id", "links")
    op.drop_index("ix_links_workspace_id", "links")
    op.drop_table("links")
    op.drop_index("ix_entities_normalized_name", "entities")
    op.drop_index("ix_entities_kind", "entities")
    op.drop_index("ix_entities_workspace_id", "entities")
    op.drop_table("entities")
