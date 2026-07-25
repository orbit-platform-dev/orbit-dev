"""Execution platform: Customer / Knowledge / Approval / SyncJob / workspaces.

Adds the entities behind the review-and-approval-layer product: a real Customer,
approval-gated KnowledgeItems, Approval audit rows, SyncJobs, workspace tenancy
columns, and the CRM-update / internal-notes sections on execution plans
(table `projects`).
"""

import sqlalchemy as sa

from alembic import op

revision = "0002_execution_platform"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "customers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("normalized_name", sa.String(), nullable=False),
        sa.Column("domains", sa.JSON(), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=False),
        sa.Column("meta", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_customers_normalized_name", "customers", ["normalized_name"])
    op.create_table(
        "approvals",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
        sa.Column("plan_id", sa.String(), nullable=False),
        sa.Column("meeting_id", sa.String(), nullable=True),
        sa.Column("customer_id", sa.String(), nullable=True),
        sa.Column("approved_by", sa.JSON(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sections", sa.JSON(), nullable=False),
    )
    op.create_index("ix_approvals_plan_id", "approvals", ["plan_id"])
    op.create_table(
        "knowledge_items",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
        sa.Column("customer_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("source_meeting_id", sa.String(), nullable=True),
        sa.Column("source_plan_id", sa.String(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_knowledge_items_customer_id", "knowledge_items", ["customer_id"])
    op.create_index("ix_knowledge_items_kind", "knowledge_items", ["kind"])
    op.create_table(
        "sync_jobs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"),
        sa.Column("plan_id", sa.String(), nullable=False),
        sa.Column("customer_id", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("destination", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sync_jobs_plan_id", "sync_jobs", ["plan_id"])

    with op.batch_alter_table("meetings") as batch:
        batch.add_column(sa.Column("customer_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"))
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("customer_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("workspace_id", sa.String(), nullable=False, server_default="ws_default"))
        batch.add_column(sa.Column("crm_update", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("internal_notes", sa.Text(), nullable=True))
    op.create_index("ix_meetings_customer_id", "meetings", ["customer_id"])
    op.create_index("ix_projects_customer_id", "projects", ["customer_id"])


def downgrade() -> None:
    op.drop_index("ix_projects_customer_id", "projects")
    op.drop_index("ix_meetings_customer_id", "meetings")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("internal_notes")
        batch.drop_column("crm_update")
        batch.drop_column("workspace_id")
        batch.drop_column("customer_id")
    with op.batch_alter_table("meetings") as batch:
        batch.drop_column("workspace_id")
        batch.drop_column("customer_id")
    op.drop_table("sync_jobs")
    op.drop_table("knowledge_items")
    op.drop_table("approvals")
    op.drop_table("customers")
    op.drop_table("workspaces")
