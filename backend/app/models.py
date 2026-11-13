"""
SQLAlchemy ORM models for the Exam Paper Maker & Moderation Portal.
"""
import json
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Enum, Float, ForeignKey,
    Integer, JSON, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import relationship
from app.database import Base

# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

RoleEnum = Enum("owner", "principal", "hod", "faculty", "exam_cell", name="role_enum")
ExamTypeEnum = Enum("mid_semester", "remedial", "end_semester", name="exam_type_enum")
PaperStatusEnum = Enum(
    "draft", "submitted", "hod_review", "hod_approved", "hod_returned",
    "principal_review", "principal_approved", "principal_returned",
    "exam_cell_review", "finalized", "returned",
    name="paper_status_enum",
)
ProgramTypeEnum = Enum("bachelor", "master", name="program_type_enum")
DifficultyEnum = Enum("easy", "medium", "hard", name="difficulty_enum")
QuestionTypeEnum = Enum("mcq", "short", "long", "numerical", "case_study", name="question_type_enum")
BloomsCategory = Enum("remember", "understand", "apply", "analyze", "evaluate", "create", name="blooms_category_enum")


# ---------------------------------------------------------------------------
# Helper mixin
# ---------------------------------------------------------------------------

class TimestampMixin:
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)


# ---------------------------------------------------------------------------
# Users & Auth
# ---------------------------------------------------------------------------

class User(TimestampMixin, Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(RoleEnum, nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    department = relationship("Department", back_populates="users")
    created_papers = relationship("ExamPaper", back_populates="created_by_user", foreign_keys="ExamPaper.created_by")
    workflow_actions = relationship("WorkflowHistory", back_populates="actor")
    audit_logs = relationship("AuditLog", back_populates="user")
    csv_imports = relationship("CsvImport", back_populates="uploaded_by_user")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(255), unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)

    user = relationship("User")


# ---------------------------------------------------------------------------
# Departments & Subjects
# ---------------------------------------------------------------------------

class Department(TimestampMixin, Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    program_type = Column(ProgramTypeEnum, nullable=False, default="bachelor")
    is_active = Column(Boolean, default=True)

    users = relationship("User", back_populates="department")
    subjects = relationship("Subject", back_populates="department")


class Subject(TimestampMixin, Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    subject_code = Column(String(50), nullable=False)
    subject_name = Column(String(255), nullable=False)
    semester = Column(Integer, nullable=True)
    is_active = Column(Boolean, default=True)

    __table_args__ = (UniqueConstraint("department_id", "subject_code"),)

    department = relationship("Department", back_populates="subjects")
    units = relationship("SyllabusUnit", back_populates="subject")
    course_outcomes = relationship("CourseOutcome", back_populates="subject")
    questions = relationship("Question", back_populates="subject")
    papers = relationship("ExamPaper", back_populates="subject")


# ---------------------------------------------------------------------------
# Syllabus & Academic Mappings
# ---------------------------------------------------------------------------

class SyllabusUnit(TimestampMixin, Base):
    __tablename__ = "syllabus_units"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    unit_code = Column(String(50), nullable=False)
    unit_name = Column(String(255), nullable=False)
    weight_percent = Column(Float, default=0.0)
    description = Column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("subject_id", "unit_code"),)

    subject = relationship("Subject", back_populates="units")
    questions = relationship("Question", back_populates="unit")


class CourseOutcome(TimestampMixin, Base):
    __tablename__ = "course_outcomes"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    co_code = Column(String(20), nullable=False)
    description = Column(Text, nullable=False)
    po_mapping = Column(String(255), nullable=True)  # comma-separated PO codes

    __table_args__ = (UniqueConstraint("subject_id", "co_code"),)

    subject = relationship("Subject", back_populates="course_outcomes")
    questions = relationship("Question", back_populates="co")


class BloomsLevel(Base):
    __tablename__ = "blooms_levels"

    id = Column(Integer, primary_key=True)
    level_code = Column(String(10), unique=True, nullable=False)  # R, U, Ap, An, E, C
    level_name = Column(String(50), nullable=False)
    category = Column(BloomsCategory, nullable=False)
    order_num = Column(Integer, default=1)

    questions = relationship("Question", back_populates="blooms")


# ---------------------------------------------------------------------------
# Exam Configuration
# ---------------------------------------------------------------------------

class ExamConfiguration(TimestampMixin, Base):
    __tablename__ = "exam_configurations"

    id = Column(Integer, primary_key=True)
    exam_type = Column(ExamTypeEnum, nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)  # null = global default
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True)  # null = applies to all subjects
    name = Column(String(255), nullable=False)
    total_marks = Column(Float, nullable=False)
    duration_minutes = Column(Integer, nullable=True)
    instructions = Column(Text, nullable=True)
    sections_config = Column(JSON, nullable=False)  # List[SectionConfig]
    # Default CO and Bloom's target % for papers created from this template.
    # Stored as {code: percent} dicts, e.g. {"CO1": 25, "CO2": 30, ...}
    co_targets = Column(JSON, nullable=True)       # default CO distribution targets
    blooms_targets = Column(JSON, nullable=True)   # default Bloom's distribution targets
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    papers = relationship("ExamPaper", back_populates="configuration")


# ---------------------------------------------------------------------------
# Question Bank
# ---------------------------------------------------------------------------

class Question(TimestampMixin, Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    unit_id = Column(Integer, ForeignKey("syllabus_units.id"), nullable=True)
    co_id = Column(Integer, ForeignKey("course_outcomes.id"), nullable=True)
    blooms_id = Column(Integer, ForeignKey("blooms_levels.id"), nullable=True)
    question_text = Column(Text, nullable=False)
    question_type = Column(QuestionTypeEnum, nullable=False, default="short")
    difficulty = Column(DifficultyEnum, nullable=False, default="medium")
    default_marks = Column(Float, nullable=False, default=1.0)
    image_path = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    import_batch_id = Column(Integer, ForeignKey("csv_imports.id"), nullable=True)

    subject = relationship("Subject", back_populates="questions")
    unit = relationship("SyllabusUnit", back_populates="questions")
    co = relationship("CourseOutcome", back_populates="questions")
    blooms = relationship("BloomsLevel", back_populates="questions")
    tags = relationship("QuestionTag", back_populates="question", cascade="all, delete-orphan")
    paper_questions = relationship("PaperQuestion", back_populates="question")


class QuestionTag(Base):
    __tablename__ = "question_tags"

    id = Column(Integer, primary_key=True)
    question_id = Column(Integer, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    tag = Column(String(100), nullable=False)

    question = relationship("Question", back_populates="tags")


# ---------------------------------------------------------------------------
# Exam Papers
# ---------------------------------------------------------------------------

class ExamPaper(TimestampMixin, Base):
    __tablename__ = "exam_papers"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    exam_type = Column(ExamTypeEnum, nullable=False)
    configuration_id = Column(Integer, ForeignKey("exam_configurations.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(500), nullable=False)
    status = Column(PaperStatusEnum, nullable=False, default="draft")
    version = Column(Integer, default=1, nullable=False)
    locked_at = Column(DateTime, nullable=True)
    academic_year = Column(String(20), nullable=True)
    generation_params = Column(JSON, nullable=True)  # store original generation config

    subject = relationship("Subject", back_populates="papers")
    configuration = relationship("ExamConfiguration", back_populates="papers")
    created_by_user = relationship("User", back_populates="created_papers", foreign_keys=[created_by])
    sections = relationship("PaperSection", back_populates="paper", cascade="all, delete-orphan", order_by="PaperSection.order_num")
    analysis = relationship("PaperAnalysis", back_populates="paper", uselist=False, cascade="all, delete-orphan")
    workflow_history = relationship("WorkflowHistory", back_populates="paper", cascade="all, delete-orphan", order_by="WorkflowHistory.created_at")

    @property
    def is_locked(self):
        return self.status in ("principal_approved", "exam_cell_review", "finalized")

    @property
    def configuration_total_marks(self):
        return self.configuration.total_marks if self.configuration else None

    @property
    def configuration_instructions(self):
        return self.configuration.instructions if self.configuration else None

    @property
    def duration_minutes(self):
        return self.configuration.duration_minutes if self.configuration else None


class PaperSection(Base):
    __tablename__ = "paper_sections"

    id = Column(Integer, primary_key=True)
    paper_id = Column(Integer, ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    section_name = Column(String(100), nullable=False)
    instructions = Column(Text, nullable=True)
    marks_allocated = Column(Float, nullable=False, default=0.0)
    order_num = Column(Integer, default=1)

    paper = relationship("ExamPaper", back_populates="sections")
    questions = relationship("PaperQuestion", back_populates="section", cascade="all, delete-orphan", order_by="PaperQuestion.question_order")


class PaperQuestion(Base):
    __tablename__ = "paper_questions"

    id = Column(Integer, primary_key=True)
    paper_id = Column(Integer, ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    section_id = Column(Integer, ForeignKey("paper_sections.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=True)  # nullable for template-mode slots
    assigned_marks = Column(Float, nullable=False)
    question_order = Column(Integer, default=1)
    is_optional = Column(Boolean, default=False)
    choice_group = Column(String(100), nullable=True)  # questions with same choice_group are alternatives
    is_subquestion = Column(Boolean, default=False)
    parent_question_id = Column(Integer, ForeignKey("paper_questions.id"), nullable=True)

    # Template-mode slot fields (faculty assigns these directly)
    slot_id = Column(String(50), nullable=True)          # e.g. "2A", "Q2b_alt"
    slot_label = Column(String(100), nullable=True)       # display label e.g. "(a)", "I"
    slot_question_text = Column(Text, nullable=True)      # question text typed by faculty
    slot_co_id = Column(Integer, ForeignKey("course_outcomes.id"), nullable=True)
    slot_blooms_id = Column(Integer, ForeignKey("blooms_levels.id"), nullable=True)
    slot_unit_id = Column(Integer, ForeignKey("syllabus_units.id"), nullable=True)
    slot_difficulty = Column(DifficultyEnum, nullable=True)

    paper = relationship("ExamPaper")
    section = relationship("PaperSection", back_populates="questions")
    question = relationship("Question", back_populates="paper_questions")
    sub_questions = relationship("PaperQuestion", foreign_keys=[parent_question_id])
    slot_co = relationship("CourseOutcome", foreign_keys=[slot_co_id])
    slot_blooms = relationship("BloomsLevel", foreign_keys=[slot_blooms_id])
    slot_unit = relationship("SyllabusUnit", foreign_keys=[slot_unit_id])

    @property
    def co_code(self):
        if self.slot_co:
            return self.slot_co.co_code
        if self.question and self.question.co:
            return self.question.co.co_code
        return None

    @property
    def blooms_code(self):
        if self.slot_blooms:
            return self.slot_blooms.level_code
        if self.question and self.question.blooms:
            return self.question.blooms.level_code
        return None

    @property
    def question_text(self):
        if self.slot_question_text:
            return self.slot_question_text
        if self.question:
            return self.question.question_text
        return None


class PaperAnalysis(Base):
    __tablename__ = "paper_analysis"

    id = Column(Integer, primary_key=True)
    paper_id = Column(Integer, ForeignKey("exam_papers.id", ondelete="CASCADE"), unique=True, nullable=False)
    total_marks_calculated = Column(Float, nullable=False, default=0.0)
    co_distribution = Column(JSON, nullable=True)     # {co_code: {marks, percent}}
    blooms_distribution = Column(JSON, nullable=True)  # {level_code: {marks, percent}}
    unit_distribution = Column(JSON, nullable=True)    # {unit_code: {marks, percent}}
    difficulty_distribution = Column(JSON, nullable=True)
    validation_errors = Column(JSON, nullable=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    paper = relationship("ExamPaper", back_populates="analysis")


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------

class WorkflowHistory(Base):
    __tablename__ = "workflow_history"

    id = Column(Integer, primary_key=True)
    paper_id = Column(Integer, ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    from_status = Column(String(50), nullable=True)
    to_status = Column(String(50), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    comments = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)

    paper = relationship("ExamPaper", back_populates="workflow_history")
    actor = relationship("User", back_populates="workflow_actions")


# ---------------------------------------------------------------------------
# CSV Imports
# ---------------------------------------------------------------------------

class CsvImport(TimestampMixin, Base):
    __tablename__ = "csv_imports"

    id = Column(Integer, primary_key=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    category = Column(String(50), nullable=False)  # questions, sample_papers, units, co, blooms, exam_config
    original_filename = Column(String(500), nullable=False)
    stored_filename = Column(String(500), nullable=True)
    column_mapping = Column(JSON, nullable=True)     # {csv_col: system_field}
    status = Column(String(50), default="pending")  # pending, validated, imported, failed
    rows_total = Column(Integer, default=0)
    rows_imported = Column(Integer, default=0)
    rows_skipped = Column(Integer, default=0)
    errors_json = Column(JSON, nullable=True)

    uploaded_by_user = relationship("User", back_populates="csv_imports")
    questions = relationship("Question", back_populates=None, foreign_keys="Question.import_batch_id")


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(100), nullable=False)
    resource_type = Column(String(100), nullable=True)
    resource_id = Column(Integer, nullable=True)
    detail_json = Column(JSON, nullable=True)
    ip_address = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)

    user = relationship("User", back_populates="audit_logs")
