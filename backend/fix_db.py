"""One-time fix: add missing columns + seed exam templates."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import engine, SessionLocal
from app import models
from app.auth import hash_password
import sqlalchemy as sa

# 1. Add missing columns
with engine.connect() as c:
    try:
        c.execute(sa.text("ALTER TABLE exam_configurations ADD COLUMN co_targets JSON"))
        print("[OK] co_targets column added")
    except Exception as e:
        print(f"[--] co_targets: {e}")
    try:
        c.execute(sa.text("ALTER TABLE exam_configurations ADD COLUMN blooms_targets JSON"))
        print("[OK] blooms_targets column added")
    except Exception as e:
        print(f"[--] blooms_targets: {e}")
    c.execute(sa.text("UPDATE alembic_version SET version_num='0005_exam_config_targets'"))
    c.commit()
    print("[OK] Alembic version stamped to 0005")

# 2. Seed templates
db = SessionLocal()
owner_user = db.query(models.User).filter(models.User.role == "owner").first()

templates = [
    {
        "name": "Mid Semester (30 Marks)",
        "exam_type": "mid_semester",
        "total_marks": 30.0,
        "duration_minutes": 60,
        "instructions": "Attempt all questions.",
        "sections_config": [
            {"name": "Section A", "marks_per_question": 2, "questions_required": 5, "allow_choice": False},
            {"name": "Section B", "marks_per_question": 4, "questions_required": 4, "allow_choice": True, "choice_extra": 1},
            {"name": "Section C", "marks_per_question": 6, "questions_required": 1, "allow_choice": True, "choice_extra": 1},
        ],
        "co_targets": {"CO1": 20.0, "CO2": 20.0, "CO3": 20.0, "CO4": 20.0, "CO5": 20.0},
        "blooms_targets": {"R": 15.0, "U": 20.0, "Ap": 30.0, "An": 20.0, "E": 10.0, "C": 5.0},
    },
    {
        "name": "End Semester (60 Marks)",
        "exam_type": "end_semester",
        "total_marks": 60.0,
        "duration_minutes": 180,
        "instructions": "Attempt all questions. Figures in brackets indicate marks.",
        "sections_config": [
            {"name": "Section A", "marks_per_question": 2, "questions_required": 10, "allow_choice": False},
            {"name": "Section B", "marks_per_question": 5, "questions_required": 4, "allow_choice": True, "choice_extra": 1},
            {"name": "Section C", "marks_per_question": 10, "questions_required": 1, "allow_choice": True, "choice_extra": 1},
        ],
        "co_targets": {"CO1": 20.0, "CO2": 20.0, "CO3": 20.0, "CO4": 20.0, "CO5": 20.0},
        "blooms_targets": {"R": 10.0, "U": 15.0, "Ap": 30.0, "An": 25.0, "E": 15.0, "C": 5.0},
    },
    {
        "name": "Remedial Exam (20 Marks)",
        "exam_type": "remedial",
        "total_marks": 20.0,
        "duration_minutes": 45,
        "instructions": "Attempt all questions.",
        "sections_config": [
            {"name": "Section A", "marks_per_question": 2, "questions_required": 5, "allow_choice": False},
            {"name": "Section B", "marks_per_question": 5, "questions_required": 2, "allow_choice": False},
        ],
        "co_targets": {"CO1": 25.0, "CO2": 25.0, "CO3": 25.0, "CO4": 25.0},
        "blooms_targets": {"R": 20.0, "U": 30.0, "Ap": 30.0, "An": 20.0},
    },
]

for t in templates:
    existing = db.query(models.ExamConfiguration).filter(models.ExamConfiguration.name == t["name"]).first()
    if not existing and owner_user:
        cfg = models.ExamConfiguration(
            exam_type=t["exam_type"],
            name=t["name"],
            total_marks=t["total_marks"],
            duration_minutes=t["duration_minutes"],
            instructions=t["instructions"],
            sections_config=t["sections_config"],
            co_targets=t["co_targets"],
            blooms_targets=t["blooms_targets"],
            created_by=owner_user.id,
            is_active=True,
        )
        db.add(cfg)
        print(f"[OK] Template: {t['name']}")
    else:
        print(f"[--] Already exists: {t['name']}")

db.commit()
db.close()
print("\nDone.")
