"""MCP query log: `mcp_queries`.

The MCP surface follows the OS loop like every other sensor: agent questions
are observed, and questions memory could not answer feed the reasoner's
memory-gap detector. This is observation only — no agent ever writes memory
directly (proposals go through human approval on the feed).
"""
from alembic import op
import sqlalchemy as sa

revision = "0017_mcp_queries"
down_revision = "0016_workspace_embedding_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("mcp_queries"):
        return
    op.create_table(
        "mcp_queries",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default", index=True),
        sa.Column("tool", sa.String(), nullable=False),
        sa.Column("query", sa.Text(), nullable=False, server_default=""),
        sa.Column("hits", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, index=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("mcp_queries"):
        op.drop_table("mcp_queries")
