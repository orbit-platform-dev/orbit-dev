"""Findings over the company model (Reason + Recommend) + artifact source meta.

Extends `insights` into the finding/recommendation table (evidence links, a
prepared action, origin + dedupe key) and adds `artifacts.meta` for
source-specific fields (Linear issue state). Defensive DDL, same reason as prior
migrations: dev --reload + startup drift-repair can add the columns first.
"""
from alembic import op
import sqlalchemy as sa

revision = "0011_findings"
down_revision = "0010_company_model"
branch_labels = None
depends_on = None


def _has(inspector, table: str, col: str) -> bool:
    return col in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    with op.batch_alter_table("insights") as batch:
        if not _has(inspector, "insights", "origin"):
            batch.add_column(sa.Column("origin", sa.String(), nullable=False, server_default=""))
        if not _has(inspector, "insights", "entity_ids"):
            batch.add_column(sa.Column("entity_ids", sa.JSON(), nullable=False, server_default="[]"))
        if not _has(inspector, "insights", "artifact_ids"):
            batch.add_column(sa.Column("artifact_ids", sa.JSON(), nullable=False, server_default="[]"))
        if not _has(inspector, "insights", "action"):
            batch.add_column(sa.Column("action", sa.JSON(), nullable=True))
        if not _has(inspector, "insights", "dedupe_key"):
            batch.add_column(sa.Column("dedupe_key", sa.String(), nullable=True))
    if not _has(inspector, "artifacts", "meta"):
        with op.batch_alter_table("artifacts") as batch:
            batch.add_column(sa.Column("meta", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    with op.batch_alter_table("artifacts") as batch:
        batch.drop_column("meta")
    with op.batch_alter_table("insights") as batch:
        for col in ("dedupe_key", "action", "artifact_ids", "entity_ids", "origin"):
            batch.drop_column(col)
