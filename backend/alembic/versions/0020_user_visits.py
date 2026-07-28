"""Feed visit tracking: `user_visits` powers the login briefing's delta.

`anchor_at` marks where "while you were away" starts; it advances only when a
new session begins, so refreshes within a session keep the same delta.
"""

import sqlalchemy as sa

from alembic import op

revision = "0020_user_visits"
down_revision = "0019_user_credits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("user_visits"):
        op.create_table(
            "user_visits",
            sa.Column("workspace_id", sa.String(), primary_key=True, server_default="ws_default"),
            sa.Column("user_id", sa.String(), primary_key=True),
            sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("anchor_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("user_visits"):
        op.drop_table("user_visits")
