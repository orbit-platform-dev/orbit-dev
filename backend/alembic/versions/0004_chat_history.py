"""Persistent Ask-Orbit conversations (chat history)."""
from alembic import op
import sqlalchemy as sa

revision = "0004_chat_history"
down_revision = "0003_pgvector_embeddings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_conversations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
        sa.Column("customer_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=False, server_default="New conversation"),
        sa.Column("messages", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_chat_conversations_customer_id", "chat_conversations", ["customer_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_conversations_customer_id", "chat_conversations")
    op.drop_table("chat_conversations")
