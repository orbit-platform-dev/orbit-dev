"""Drop chat conversations (product simplification 2026-07-11).

The chat surface was removed entirely; company intelligence lives on the
dashboard (brief + insights). Defensive DDL as usual for --reload drift.
"""

import sqlalchemy as sa

from alembic import op

revision = "0008_drop_chat"
down_revision = "0007_drop_graph"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("chat_conversations"):
        op.drop_table("chat_conversations")


def downgrade() -> None:
    # Chat is gone from the codebase; nothing meaningful to restore.
    pass
