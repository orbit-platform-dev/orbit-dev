"""Artifact memory: the unified observed-memory substrate for the MVP loop.

On Postgres the embedding is a real pgvector column with an HNSW cosine index;
on SQLite it is plain JSON ranked in Python (dev-scale). Defensive DDL, same
reason as 0005/0006: dev --reload plus the startup drift-repair can materialize
the model table before this migration runs.
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "0009_artifact_memory"
down_revision = "0008_drop_chat"
branch_labels = None
depends_on = None

_DIM = 768  # keep in sync with app.models.EMBEDDING_DIM


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    is_pg = bind.dialect.name == "postgresql"
    if is_pg:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    if not inspector.has_table("artifacts"):
        op.create_table(
            "artifacts",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
            sa.Column("source", sa.String(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False, server_default=""),
            sa.Column("external_ref", sa.String(), nullable=True),
            sa.Column("url", sa.String(), nullable=True),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column("extracted", sa.JSON(), nullable=True),
            sa.Column("status", sa.String(), nullable=False, server_default="observed"),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("embedding", sa.JSON().with_variant(Vector(_DIM), "postgresql"), nullable=True),
        )
        op.create_index("ix_artifacts_workspace_id", "artifacts", ["workspace_id"])
        op.create_index("ix_artifacts_source", "artifacts", ["source"])
        op.create_index("ix_artifacts_external_ref", "artifacts", ["external_ref"])
        if is_pg:
            op.execute("CREATE INDEX ix_artifacts_embedding ON artifacts "
                       "USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_artifacts_embedding")
    op.drop_index("ix_artifacts_external_ref", "artifacts")
    op.drop_index("ix_artifacts_source", "artifacts")
    op.drop_index("ix_artifacts_workspace_id", "artifacts")
    op.drop_table("artifacts")
