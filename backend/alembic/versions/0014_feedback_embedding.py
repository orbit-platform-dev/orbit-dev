"""Vectorize the feedback loop: a per-correction embedding on `feedback`.

This turns the feedback table into a repository of *behavioral preferences &
rules* that can be retrieved by semantic relevance (native pgvector `<=>`), not
just recency. On Postgres it is a real pgvector column (the extension is ensured
in database._migrate); on SQLite it is plain JSON. Defensive/idempotent so it is
safe on dev DBs that may have materialized the column via startup drift-repair.
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "0014_feedback_embedding"
down_revision = "0013_integration_workspace"
branch_labels = None
depends_on = None

_DIM = 768  # keep in sync with app.models.EMBEDDING_DIM


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    if not inspector.has_table("feedback"):
        return
    cols = {c["name"] for c in inspector.get_columns("feedback")}
    if "embedding" not in cols:
        op.add_column(
            "feedback",
            sa.Column("embedding", sa.JSON().with_variant(Vector(_DIM), "postgresql"), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("feedback"):
        cols = {c["name"] for c in inspector.get_columns("feedback")}
        if "embedding" in cols:
            op.drop_column("feedback", "embedding")
