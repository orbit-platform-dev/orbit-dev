"""Semantic retrieval: embedding columns for meetings + knowledge items.

On Postgres this enables the pgvector extension and creates real vector
columns with HNSW cosine indexes — similarity search stays fast at thousands+
of rows. On SQLite the same columns are plain JSON and ranking happens in
Python (dev-scale only).
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "0003_pgvector_embeddings"
down_revision = "0002_execution_platform"
branch_labels = None
depends_on = None

_DIM = 768  # keep in sync with app.models.EMBEDDING_DIM


def _col() -> sa.Column:
    return sa.Column("embedding", sa.JSON().with_variant(Vector(_DIM), "postgresql"), nullable=True)


def upgrade() -> None:
    is_pg = op.get_bind().dialect.name == "postgresql"
    if is_pg:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    with op.batch_alter_table("meetings") as batch:
        batch.add_column(_col())
    with op.batch_alter_table("knowledge_items") as batch:
        batch.add_column(_col())
    if is_pg:
        op.execute("CREATE INDEX ix_meetings_embedding ON meetings "
                   "USING hnsw (embedding vector_cosine_ops)")
        op.execute("CREATE INDEX ix_knowledge_items_embedding ON knowledge_items "
                   "USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_knowledge_items_embedding")
        op.execute("DROP INDEX IF EXISTS ix_meetings_embedding")
    with op.batch_alter_table("knowledge_items") as batch:
        batch.drop_column("embedding")
    with op.batch_alter_table("meetings") as batch:
        batch.drop_column("embedding")
