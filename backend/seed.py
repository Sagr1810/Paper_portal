"""
Seed script: creates the default owner user and seeds Bloom's taxonomy levels.
Run: python seed.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app import models
from app.auth import hash_password

db = SessionLocal()

# ── Bloom's Levels ──────────────────────────────────────────────────────────
blooms = [
    ("R",  "Remember",  "remember",  1),
    ("U",  "Understand","understand", 2),
    ("Ap", "Apply",     "apply",      3),
    ("An", "Analyze",   "analyze",    4),
    ("E",  "Evaluate",  "evaluate",   5),
    ("C",  "Create",    "create",     6),
]
for code, name, cat, order in blooms:
    existing = db.query(models.BloomsLevel).filter(models.BloomsLevel.level_code == code).first()
    if not existing:
        db.add(models.BloomsLevel(level_code=code, level_name=name, category=cat, order_num=order))

db.commit()
print("[OK] Bloom's levels seeded")

# ── Default college + department ───────────────────────────────────────────
college = db.query(models.College).first()
if not college:
    college = models.College(name="Default College")
    db.add(college)
    db.commit()
    db.refresh(college)
    print("[OK] Default college seeded (rename it in Admin -> Colleges)")

dept = db.query(models.Department).filter(models.Department.name == "Computer Science").first()
if not dept:
    dept = models.Department(name="Computer Science", program_type="bachelor", college_id=college.id)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    print("[OK] Default department seeded")

# ── Owner user ──────────────────────────────────────────────────────────────
owner_email = os.getenv("OWNER_EMAIL", "admin@portal.edu")
owner_pass  = os.getenv("OWNER_PASSWORD", "Admin@1234")
existing_owner = db.query(models.User).filter(models.User.email == owner_email).first()
if not existing_owner:
    owner = models.User(
        email=owner_email,
        name="System Owner",
        hashed_password=hash_password(owner_pass),
        role="owner",
    )
    db.add(owner)
    db.commit()
    print(f"[OK] Owner user created: {owner_email} / {owner_pass}")
else:
    print(f"[OK] Owner user already exists: {owner_email}")

# ── Default Exam Configuration Templates ────────────────────────────────────
owner_user = db.query(models.User).filter(models.User.email == owner_email).first()
if not owner_user:
    owner_user = db.query(models.User).filter(models.User.role == "owner").first()

templates = [
    {
        "name": "Mid Semester (30 Marks)",
        "exam_type": "mid_semester",
        "total_marks": 30.0,
        "duration_minutes": 60,
        "instructions": "Attempt all questions.",
        "sections_config": [
            {"name": "Section A", "marks_per_question": 2, "questions_required": 5, "allow_choice": False, "question_type": "short", "difficulty": "easy"},
            {"name": "Section B", "marks_per_question": 4, "questions_required": 4, "allow_choice": True, "choice_extra": 1, "question_type": "long", "difficulty": "medium"},
            {"name": "Section C", "marks_per_question": 6, "questions_required": 1, "allow_choice": True, "choice_extra": 1, "question_type": "long", "difficulty": "hard"},
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
            {"name": "Section A", "marks_per_question": 2, "questions_required": 10, "allow_choice": False, "question_type": "short", "difficulty": "easy"},
            {"name": "Section B", "marks_per_question": 5, "questions_required": 4, "allow_choice": True, "choice_extra": 1, "question_type": "long", "difficulty": "medium"},
            {"name": "Section C", "marks_per_question": 10, "questions_required": 1, "allow_choice": True, "choice_extra": 1, "question_type": "long", "difficulty": "hard"},
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
            {"name": "Section A", "marks_per_question": 2, "questions_required": 5, "allow_choice": False, "question_type": "short", "difficulty": "easy"},
            {"name": "Section B", "marks_per_question": 5, "questions_required": 2, "allow_choice": False, "question_type": "long", "difficulty": "medium"},
        ],
        "co_targets": {"CO1": 25.0, "CO2": 25.0, "CO3": 25.0, "CO4": 25.0},
        "blooms_targets": {"R": 20.0, "U": 30.0, "Ap": 30.0, "An": 20.0},
    },
]

for t in templates:
    existing_t = db.query(models.ExamConfiguration).filter(
        models.ExamConfiguration.name == t["name"]
    ).first()
    if not existing_t and owner_user:
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
        print(f"[OK] Template created: {t['name']}")
    else:
        print(f"[--] Template already exists: {t['name']}")

db.commit()
db.close()
print("\nSeed complete.")
