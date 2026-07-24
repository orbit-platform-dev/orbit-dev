"""Per-workspace MCP key: `workspaces.mcp_key_hash`.

The shared MCP_API_KEY + client-chosen workspace header could not be handed to
customers (any key-holder could name any workspace). Now each workspace owns a
key (stored hashed); /mcp resolves the tenant FROM the key.
"""
from alembic import op
import sqlalchemy as sa

revision = "0018_workspace_mcp_key"
down_revision = "0017_mcp_queries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("workspaces"):
        return
    cols = {c["name"] for c in inspector.get_columns("workspaces")}
    if "mcp_key_hash" not in cols:
        op.add_column("workspaces", sa.Column("mcp_key_hash", sa.String(), nullable=True))
        op.create_index("ix_workspaces_mcp_key_hash", "workspaces", ["mcp_key_hash"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("workspaces"):
        cols = {c["name"] for c in inspector.get_columns("workspaces")}
        if "mcp_key_hash" in cols:
            op.drop_index("ix_workspaces_mcp_key_hash", "workspaces")
            op.drop_column("workspaces", "mcp_key_hash")
