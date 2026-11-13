"""Rebuild questions table with correct portal schema.

The existing questions table is from a different project (MCQ exam table).
This migration drops it and recreates it with the portal schema.

Revision ID: 0003_rebuild_questions
Revises: 0002_missing_tables
Create Date: 2025-01-01 00:02:00
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_rebuild_questions"
down_revision = "0002_missing_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from sqlalchemy import inspect
    bind = op.get_bind()
    existing = inspect(bind).get_table_names()

    # Drop old dependent tables (PostgreSQL requires CASCADE for FK-referenced tables)
    for tbl in ["responses", "question_tags", "paper_questions", "questions"]:
        if tbl in existing:
            op.execute(f"DROP TABLE IF EXISTS {tbl} CASCADE")

    # 2. Recreate questions with portal schema
    op.create_table(
        "questions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("subject_id", sa.Integer, sa.ForeignKey("subjects.id"), nullable=False),
        sa.Column("unit_id", sa.Integer, sa.ForeignKey("syllabus_units.id"), nullable=True),
        sa.Column("co_id", sa.Integer, sa.ForeignKey("course_outcomes.id"), nullable=True),
        sa.Column("blooms_id", sa.Integer, sa.ForeignKey("blooms_levels.id"), nullable=True),
        sa.Column("question_text", sa.Text, nullable=False),
        sa.Column("question_type", sa.Enum("mcq","short","long","numerical","case_study", name="question_type_enum"), nullable=False, server_default="short"),
        sa.Column("difficulty", sa.Enum("easy","medium","hard", name="difficulty_enum"), nullable=False, server_default="medium"),
        sa.Column("default_marks", sa.Float, nullable=False, server_default="1.0"),
        sa.Column("image_path", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("import_batch_id", sa.Integer, sa.ForeignKey("csv_imports.id"), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    # 3. Recreate question_tags
    op.create_table(
        "question_tags",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("question_id", sa.Integer, sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag", sa.String(100), nullable=False),
    )

    # 4. Recreate paper_questions
    op.create_table(
        "paper_questions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("paper_id", sa.Integer, sa.ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section_id", sa.Integer, sa.ForeignKey("paper_sections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.Integer, sa.ForeignKey("questions.id"), nullable=True),
        sa.Column("assigned_marks", sa.Float, nullable=False),
        sa.Column("question_order", sa.Integer, server_default="1"),
        sa.Column("is_optional", sa.Boolean, server_default="false"),
        sa.Column("choice_group", sa.String(50), nullable=True),
        sa.Column("is_subquestion", sa.Boolean, server_default="false"),
        sa.Column("parent_question_id", sa.Integer, sa.ForeignKey("paper_questions.id"), nullable=True),
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS paper_questions CASCADE")
    op.execute("DROP TABLE IF EXISTS question_tags CASCADE")
    op.execute("DROP TABLE IF EXISTS questions CASCADE")
