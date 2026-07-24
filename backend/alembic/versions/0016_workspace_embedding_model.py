"""Track which embedding model produced each workspace's stored vectors.

NULL on upgraded DBs = gemini-embedding-001 (the only model used before this
column existed). The startup guard compares it with the configured
EMBEDDING_MODEL and nulls + re-embeds all vectors on mismatch, so switching
models can never silently mix incompatible vector spaces.
"""
from alembic import op
import sqlalchemy as sa

revision = "0016_workspace_embedding_model"
down_revision = "0015_workspace_auto_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("workspaces"):
        return
    cols = {c["name"] for c in inspector.get_columns("workspaces")}
    if "embedding_model" not in cols:
        op.add_column("workspaces", sa.Column("embedding_model", sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("workspaces"):
        cols = {c["name"] for c in inspector.get_columns("workspaces")}
        if "embedding_model" in cols:
            op.drop_column("workspaces", "embedding_model")
