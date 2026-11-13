"""Initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2025-01-01 00:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enum types (MySQL uses VARCHAR for enums in SQLAlchemy; explicit CREATE TYPE not needed)
    op.create_table(
        "departments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("program_type", sa.Enum("bachelor", "master", name="program_type_enum"), nullable=False, server_default="bachelor"),
        sa.Column("is_active", sa.Boolean, default=True, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", sa.Enum("owner", "principal", "hod", "faculty", "exam_cell", name="role_enum"), nullable=False),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("departments.id"), nullable=True),
        sa.Column("is_active", sa.Boolean, default=True, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(255), unique=True, nullable=False),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.Column("revoked", sa.Boolean, default=False, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "subjects",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("departments.id"), nullable=False),
        sa.Column("subject_code", sa.String(50), nullable=False),
        sa.Column("subject_name", sa.String(255), nullable=False),
        sa.Column("semester", sa.Integer, nullable=True),
        sa.Column("is_active", sa.Boolean, default=True, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        sa.UniqueConstraint("department_id", "subject_code", name="uq_dept_subject_code"),
    )

    op.create_table(
        "syllabus_units",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("subject_id", sa.Integer, sa.ForeignKey("subjects.id"), nullable=False),
        sa.Column("unit_code", sa.String(50), nullable=False),
        sa.Column("unit_name", sa.String(255), nullable=False),
        sa.Column("weight_percent", sa.Float, default=0.0),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        sa.UniqueConstraint("subject_id", "unit_code", name="uq_subj_unit_code"),
    )

    op.create_table(
        "course_outcomes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("subject_id", sa.Integer, sa.ForeignKey("subjects.id"), nullable=False),
        sa.Column("co_code", sa.String(20), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("po_mapping", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        sa.UniqueConstraint("subject_id", "co_code", name="uq_subj_co_code"),
    )

    op.create_table(
        "blooms_levels",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("level_code", sa.String(10), unique=True, nullable=False),
        sa.Column("level_name", sa.String(50), nullable=False),
        sa.Column("category", sa.Enum("remember","understand","apply","analyze","evaluate","create", name="blooms_category_enum"), nullable=False),
        sa.Column("order_num", sa.Integer, default=1),
    )

    op.create_table(
        "exam_configurations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("exam_type", sa.Enum("mid_semester","remedial","end_semester", name="exam_type_enum"), nullable=False),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("departments.id"), nullable=True),
        sa.Column("subject_id", sa.Integer, sa.ForeignKey("subjects.id"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("total_marks", sa.Float, nullable=False),
        sa.Column("duration_minutes", sa.Integer, nullable=True),
        sa.Column("instructions", sa.Text, nullable=True),
        sa.Column("sections_config", sa.JSON, nullable=False),
        sa.Column("is_active", sa.Boolean, default=True, server_default="true"),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "csv_imports",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("uploaded_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column("stored_filename", sa.String(500), nullable=True),
        sa.Column("column_mapping", sa.JSON, nullable=True),
        sa.Column("status", sa.String(50), default="pending", server_default="pending"),
        sa.Column("rows_total", sa.Integer, default=0, server_default="0"),
        sa.Column("rows_imported", sa.Integer, default=0, server_default="0"),
        sa.Column("rows_skipped", sa.Integer, default=0, server_default="0"),
        sa.Column("errors_json", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "questions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("subject_id", sa.Integer, sa.ForeignKey("subjects.id"), nullable=False),
        sa.Column("unit_id", sa.Integer, sa.ForeignKey("syllabus_units.id"), nullable=True),
        sa.Column("co_id", sa.Integer, sa.ForeignKey("course_outcomes.id"), nullable=True),
        sa.Column("blooms_id", sa.Integer, sa.ForeignKey("blooms_levels.id"), nullable=True),
        sa.Column("question_text", sa.Text, nullable=False),
        sa.Column("question_type", sa.Enum("mcq","short","long","numerical","case_study", name="question_type_enum"), nullable=False, server_default="short"),
        sa.Column("difficulty", sa.Enum("easy","medium","hard", name="difficulty_enum"), nullable=False, server_default="medium"),
        sa.Column("default_marks", sa.Float, nullable=False, server_default="1.0"),
        sa.Column("image_path", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean, default=True, server_default="true"),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("import_batch_id", sa.Integer, sa.ForeignKey("csv_imports.id"), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "question_tags",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("question_id", sa.Integer, sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag", sa.String(100), nullable=False),
    )

    op.create_table(
        "exam_papers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("subject_id", sa.Integer, sa.ForeignKey("subjects.id"), nullable=False),
        sa.Column("exam_type", sa.Enum("mid_semester","remedial","end_semester", name="exam_type_enum"), nullable=False),
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
    )

    op.create_table(
        "paper_sections",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("paper_id", sa.Integer, sa.ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section_name", sa.String(100), nullable=False),
        sa.Column("instructions", sa.Text, nullable=True),
        sa.Column("marks_allocated", sa.Float, nullable=False, server_default="0"),
        sa.Column("order_num", sa.Integer, default=1, server_default="1"),
    )

    op.create_table(
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
    )

    op.create_table(
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
    )

    op.create_table(
        "workflow_history",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("paper_id", sa.Integer, sa.ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(50), nullable=True),
        sa.Column("to_status", sa.String(50), nullable=False),
        sa.Column("actor_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("comments", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(100), nullable=True),
        sa.Column("resource_id", sa.Integer, nullable=True),
        sa.Column("detail_json", sa.JSON, nullable=True),
        sa.Column("ip_address", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("workflow_history")
    op.drop_table("paper_analysis")
    op.drop_table("paper_questions")
    op.drop_table("paper_sections")
    op.drop_table("exam_papers")
    op.drop_table("question_tags")
    op.drop_table("questions")
    op.drop_table("csv_imports")
    op.drop_table("exam_configurations")
    op.drop_table("blooms_levels")
    op.drop_table("course_outcomes")
    op.drop_table("syllabus_units")
    op.drop_table("subjects")
    op.drop_table("refresh_tokens")
    op.drop_table("users")
    op.drop_table("departments")
