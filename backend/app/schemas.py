"""
Pydantic schemas for request/response validation.
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    user_id: int
    name: str
    college_id: Optional[int] = None
    department_id: Optional[int] = None


class RefreshRequest(BaseModel):
    refresh_token: str


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=8)
    role: str
    college_id: Optional[int] = None
    department_id: Optional[int] = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        allowed = {"owner", "principal", "hod", "faculty", "exam_cell"}
        if v not in allowed:
            raise ValueError(f"Role must be one of {allowed}")
        return v


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    college_id: Optional[int] = None
    department_id: Optional[int] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8)


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    college_id: Optional[int] = None
    department_id: Optional[int]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Departments
# ---------------------------------------------------------------------------

class CollegeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class CollegeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)


class CollegeOut(BaseModel):
    id: int
    name: str
    is_active: bool

    model_config = {"from_attributes": True}


class DepartmentCreate(BaseModel):
    college_id: int
    name: str = Field(min_length=1, max_length=255)
    program_type: str = "bachelor"


class DepartmentOut(BaseModel):
    id: int
    college_id: Optional[int] = None
    name: str
    program_type: str
    is_active: bool

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Subjects
# ---------------------------------------------------------------------------

class SubjectCreate(BaseModel):
    department_id: int
    subject_code: str
    subject_name: str
    semester: Optional[int] = None
    program: Optional[str] = None


class SubjectUpdate(BaseModel):
    subject_code: Optional[str] = None
    subject_name: Optional[str] = None
    semester: Optional[int] = None
    program: Optional[str] = None


class SubjectOut(BaseModel):
    id: int
    department_id: int
    subject_code: str
    subject_name: str
    semester: Optional[int]
    program: Optional[str] = None
    is_active: bool

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Syllabus Units
# ---------------------------------------------------------------------------

class UnitCreate(BaseModel):
    subject_id: int
    unit_code: str
    unit_name: str
    weight_percent: float = 0.0
    description: Optional[str] = None


class UnitOut(BaseModel):
    id: int
    subject_id: int
    unit_code: str
    unit_name: str
    weight_percent: float
    description: Optional[str]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Course Outcomes
# ---------------------------------------------------------------------------

class COCreate(BaseModel):
    subject_id: int
    co_code: str
    description: str
    po_mapping: Optional[str] = None


class COUpdate(BaseModel):
    co_code: Optional[str] = None
    description: Optional[str] = None
    po_mapping: Optional[str] = None


class COOut(BaseModel):
    id: int
    subject_id: int
    co_code: str
    description: str
    po_mapping: Optional[str]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Bloom's Levels
# ---------------------------------------------------------------------------

class BloomsCreate(BaseModel):
    level_code: str
    level_name: str
    category: str
    order_num: int = 1


class BloomsOut(BaseModel):
    id: int
    level_code: str
    level_name: str
    category: str
    order_num: int

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Exam Configurations
# ---------------------------------------------------------------------------

class SectionConfig(BaseModel):
    name: str
    marks_per_question: float
    questions_required: int
    allow_choice: bool = False
    choice_extra: int = 0
    question_type: Optional[str] = None
    difficulty: Optional[str] = None
    instructions: Optional[str] = None


class ExamConfigCreate(BaseModel):
    exam_type: str
    department_id: Optional[int] = None
    subject_id: Optional[int] = None
    name: str
    total_marks: float
    duration_minutes: Optional[int] = None
    instructions: Optional[str] = None
    sections_config: list[SectionConfig]
    # Default target distributions stored in the template
    co_targets: Optional[dict[str, float]] = None      # {co_code: percent}
    blooms_targets: Optional[dict[str, float]] = None  # {blooms_code: percent}


class ExamConfigOut(BaseModel):
    id: int
    exam_type: str
    department_id: Optional[int]
    subject_id: Optional[int]
    name: str
    total_marks: float
    duration_minutes: Optional[int]
    instructions: Optional[str]
    sections_config: Any
    co_targets: Optional[Any] = None
    blooms_targets: Optional[Any] = None
    is_active: bool

    model_config = {"from_attributes": True}


class ExamConfigTargetsUpdate(BaseModel):
    """Partial update — only co_targets and/or blooms_targets."""
    co_targets: Optional[dict[str, float]] = None
    blooms_targets: Optional[dict[str, float]] = None




# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------

class QuestionCreate(BaseModel):
    subject_id: int
    unit_id: Optional[int] = None
    co_id: Optional[int] = None
    blooms_id: Optional[int] = None
    question_text: str
    question_type: str = "short"
    difficulty: str = "medium"
    default_marks: float = 1.0
    tags: list[str] = []


class QuestionUpdate(BaseModel):
    unit_id: Optional[int] = None
    co_id: Optional[int] = None
    blooms_id: Optional[int] = None
    question_text: Optional[str] = None
    question_type: Optional[str] = None
    difficulty: Optional[str] = None
    default_marks: Optional[float] = None
    tags: Optional[list[str]] = None
    is_active: Optional[bool] = None


class QuestionOut(BaseModel):
    id: int
    subject_id: int
    unit_id: Optional[int]
    co_id: Optional[int]
    blooms_id: Optional[int]
    question_text: str
    question_type: str
    difficulty: str
    default_marks: float
    is_active: bool
    unit_code: Optional[str] = None
    co_code: Optional[str] = None
    blooms_code: Optional[str] = None
    tags: list[str] = []

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Paper Generation
# ---------------------------------------------------------------------------

class GeneratePaperRequest(BaseModel):
    subject_id: int
    exam_type: str
    configuration_id: Optional[int] = None
    title: str
    academic_year: Optional[str] = None
    sections: list[SectionConfig]
    total_marks: float
    co_targets: dict[str, float] = {}
    blooms_targets: dict[str, float] = {}
    unit_targets: dict[str, float] = {}
    difficulty_targets: dict[str, float] = {}
    seed: Optional[int] = None


class SlotAssignmentRequest(BaseModel):
    question_text: Optional[str] = None
    co_id: Optional[int] = None
    blooms_id: Optional[int] = None
    unit_id: Optional[int] = None
    difficulty: Optional[str] = None
    question_id: Optional[int] = None


class SlotUpdate(BaseModel):
    slot_id: int
    question_text: Optional[str] = None
    co_id: Optional[int] = None
    blooms_id: Optional[int] = None
    unit_id: Optional[int] = None
    difficulty: Optional[str] = None
    question_id: Optional[int] = None


class BulkSlotAssignmentRequest(BaseModel):
    slots: list[SlotUpdate]


class CreatePaperFromTemplateRequest(BaseModel):
    subject_id: int
    configuration_id: int
    title: str
    academic_year: Optional[str] = None


class PaperQuestionOut(BaseModel):
    id: int
    question_id: Optional[int]
    assigned_marks: float
    question_order: int
    is_optional: bool
    choice_group: Optional[str]
    slot_id: Optional[str] = None
    slot_label: Optional[str] = None
    slot_question_text: Optional[str] = None
    slot_co_id: Optional[int] = None
    slot_blooms_id: Optional[int] = None
    slot_unit_id: Optional[int] = None
    slot_difficulty: Optional[str] = None
    # Derived fields — resolved by @property on the ORM model
    # question_text: slot_question_text if set, else question bank text
    # co_code / blooms_code: slot assignment if set, else from linked question
    question_text: Optional[str] = None
    co_code: Optional[str] = None
    blooms_code: Optional[str] = None
    unit_code: Optional[str] = None
    difficulty: Optional[str] = None
    question_type: Optional[str] = None

    model_config = {"from_attributes": True}


class PaperSectionOut(BaseModel):
    id: int
    section_name: str
    instructions: Optional[str]
    marks_allocated: float
    order_num: int
    questions: list[PaperQuestionOut] = []

    model_config = {"from_attributes": True}


class PaperOut(BaseModel):
    id: int
    subject_id: int
    exam_type: str
    title: str
    status: str
    version: int
    academic_year: Optional[str]
    created_by: int
    created_at: datetime
    sections: list[PaperSectionOut] = []
    configuration_total_marks: Optional[float] = None
    configuration_instructions: Optional[str] = None
    duration_minutes: Optional[int] = None

    model_config = {"from_attributes": True}


class PaperDirectoryRow(BaseModel):
    id: int
    title: str
    status: str
    exam_type: Optional[str] = None
    academic_year: Optional[str] = None
    created_at: datetime
    faculty_id: int
    faculty_name: Optional[str] = None
    subject_id: int
    subject_code: Optional[str] = None
    subject_name: Optional[str] = None
    program: Optional[str] = None
    semester: Optional[int] = None
    subject_program: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    latest_comment: Optional[str] = None
    latest_comment_by: Optional[str] = None
    latest_comment_at: Optional[datetime] = None
    comment_count: int = 0


class PaperAnalysisOut(BaseModel):
    total_marks_calculated: float
    co_distribution: Optional[Any]
    blooms_distribution: Optional[Any]
    unit_distribution: Optional[Any]
    difficulty_distribution: Optional[Any]
    validation_errors: Optional[Any]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------

class WorkflowActionRequest(BaseModel):
    action: str   # submit, hod_approve, hod_return, principal_approve, principal_return, finalize, return_paper
    comments: Optional[str] = None


# ---------------------------------------------------------------------------
# Auto-assign schemas
# ---------------------------------------------------------------------------

class AutoAssignRequest(BaseModel):
    co_targets: dict[str, float]      # { "CO1": 25.0, "CO2": 30.0, ... }  values = %
    blooms_targets: dict[str, float]  # { "R": 15.0, "U": 20.0, ... }
    save: bool = True                 # if False, preview only (do not persist)


class PreviewSlot(BaseModel):
    slot_id: str
    marks: float
    is_or: bool = False
    or_group: Optional[str] = None


class PreviewDistributionRequest(BaseModel):
    slots: list[dict]        # list of {slot_id, marks, is_or, or_group}
    total_marks: float
    co_targets: dict[str, float]
    blooms_targets: dict[str, float]


class WorkflowHistoryOut(BaseModel):
    id: int
    from_status: Optional[str]
    to_status: str
    actor_id: Optional[int]
    comments: Optional[str]
    created_at: datetime
    actor_name: Optional[str] = None
    actor_role: Optional[str] = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# CSV Import
# ---------------------------------------------------------------------------

class CsvImportOut(BaseModel):
    id: int
    category: str
    original_filename: str
    status: str
    rows_total: int
    rows_imported: int
    rows_skipped: int
    errors_json: Optional[Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class ColumnMappingRequest(BaseModel):
    import_id: int
    mapping: dict[str, str]  # {csv_column: system_field}


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------

class AuditLogOut(BaseModel):
    id: int
    user_id: Optional[int]
    action: str
    resource_type: Optional[str]
    resource_id: Optional[int]
    detail_json: Optional[Any]
    ip_address: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}
