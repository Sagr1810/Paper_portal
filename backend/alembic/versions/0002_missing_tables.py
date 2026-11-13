"""Add missing portal tables (exam_papers, paper_sections, paper_questions,
paper_analysis, workflow_history, audit_logs, question_tags).

Revision ID: 0002_missing_tables
Revises: 0001_initial
Create Date: 2025-01-01 00:01:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0002_missing_tables"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # All tables in this migration were already created in 0001_initial.
    # This migration is kept as a no-op to preserve the revision chain.
    bind = op.get_bind()
    existing = inspect(bind).get_table_names()

    tables_to_create = {
        "question_tags": lambda: op.create_table(
            "question_tags",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("question_id", sa.Integer, sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("tag", sa.String(100), nullable=False),
        ),
        "exam_papers": lambda: op.create_table(
            "exam_papers",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("subject_id", sa.Integer, sa.ForeignKey("subjects.id"), nullable=False),
            sa.Column("exam_type", sa.Enum("mid_semester", "remedial", "end_semester", name="exam_type_enum2"), nullable=False),
            sa.Column("configuration_id", sa.Integer, sa.ForeignKey("exam_configurations.id"), nullable=True),
            sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
            sa.Column("title", sa.String(500), nullable=False),
            sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
            sa.Column("version", sa.Integer, default=1, server_default="1"),
            sa.Column("locked_at", sa.DateTime, nullable=True),
            sa.Column("academic_year", sa.String(20), nullable=True),
            sa.Column("generation_params", sa.JSON, nullable=True),
            sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        ),
        "paper_sections": lambda: op.create_table(
            "paper_sections",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("paper_id", sa.Integer, sa.ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False),
            sa.Column("section_name", sa.String(100), nullable=False),
            sa.Column("instructions", sa.Text, nullable=True),
            sa.Column("marks_allocated", sa.Float, nullable=False, server_default="0"),
            sa.Column("order_num", sa.Integer, default=1, server_default="1"),
        ),
        "paper_questions": lambda: op.create_table(
            "paper_questions",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("paper_id", sa.Integer, sa.ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False),
            sa.Column("section_id", sa.Integer, sa.ForeignKey("paper_sections.id", ondelete="CASCADE"), nullable=False),
            sa.Column("question_id", sa.Integer, sa.ForeignKey("questions.id"), nullable=False),
            sa.Column("assigned_marks", sa.Float, nullable=False),
            sa.Column("question_order", sa.Integer, default=1, server_default="1"),
                sa.Column("is_optional", sa.Boolean, default=False, server_default="false"),
                sa.Column("choice_group", sa.String(50), nullable=True),
                sa.Column("is_subquestion", sa.Boolean, default=False, server_default="false"),
            sa.Column("parent_question_id", sa.Integer, sa.ForeignKey("paper_questions.id"), nullable=True),
        ),
        "paper_analysis": lambda: op.create_table(
            "paper_analysis",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("paper_id", sa.Integer, sa.ForeignKey("exam_papers.id", ondelete="CASCADE"), unique=True, nullable=False),
            sa.Column("total_marks_calculated", sa.Float, nullable=False, server_default="0"),
            sa.Column("co_distribution", sa.JSON, nullable=True),
            sa.Column("blooms_distribution", sa.JSON, nullable=True),
            sa.Column("unit_distribution", sa.JSON, nullable=True),
            sa.Column("difficulty_distribution", sa.JSON, nullable=True),
            sa.Column("validation_errors", sa.JSON, nullable=True),
            sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        ),
        "workflow_history": lambda: op.create_table(
            "workflow_history",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("paper_id", sa.Integer, sa.ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False),
            sa.Column("from_status", sa.String(50), nullable=True),
            sa.Column("to_status", sa.String(50), nullable=False),
            sa.Column("actor_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
            sa.Column("comments", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        ),
        "audit_logs": lambda: op.create_table(
            "audit_logs",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
            sa.Column("action", sa.String(100), nullable=False),
            sa.Column("resource_type", sa.String(100), nullable=True),
            sa.Column("resource_id", sa.Integer, nullable=True),
            sa.Column("detail_json", sa.JSON, nullable=True),
            sa.Column("ip_address", sa.String(50), nullable=True),
            sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        ),
    }

    for table_name, create_fn in tables_to_create.items():
        if table_name not in existing:
            create_fn()


def downgrade() -> None:
    bind = op.get_bind()
    existing = inspect(bind).get_table_names()
    for table in ["audit_logs", "workflow_history", "paper_analysis", "paper_questions", "paper_sections", "exam_papers", "question_tags"]:
        if table in existing:
            op.drop_table(table)
