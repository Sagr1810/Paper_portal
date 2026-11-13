"""Seed the 5 exam templates from sample_data CSVs.

Uses parse_exam_csv + build_sections_config so each ExamConfiguration gets
the real per-question slot structure (Q1/Q2/Q3/Q4/Q5 with explicit slot IDs
like Q1. A, 2A, 2B, 2B_alt0, 3A, 3B … 5C_alt2) instead of the flat
"Q2–Q5 (b)" super-sections that produced s4_q1/s5_or1 style slot IDs.

Deletes old templates and recreates them from scratch on every run.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app import models
from app.csv_exam_parser import parse_exam_csv, build_sections_config

db = SessionLocal()

owner_user = db.query(models.User).filter(models.User.role == "owner").first()
if not owner_user:
    print("ERROR: No owner user found. Run seed.py first.")
    sys.exit(1)

SAMPLE_DIR = os.path.join(os.path.dirname(__file__), '..', 'sample_data')

# ─────────────────────────────────────────────────────────────────────────────
# Default CO & Bloom's targets (equal 5-CO distribution)
# ─────────────────────────────────────────────────────────────────────────────
CO5         = {"CO1": 20.0, "CO2": 20.0, "CO3": 20.0, "CO4": 20.0, "CO5": 20.0}
BLOOMS_ESE  = {"R": 10.0, "U": 15.0, "Ap": 30.0, "An": 25.0, "E": 15.0, "C": 5.0}
BLOOMS_MID  = {"R": 15.0, "U": 20.0, "Ap": 30.0, "An": 20.0, "E": 10.0, "C": 5.0}

# ─────────────────────────────────────────────────────────────────────────────
# Template definitions — csv_file drives the sections_config slot structure
# ─────────────────────────────────────────────────────────────────────────────
TEMPLATES = [
    {
        "csv_file":         "BACHELORS_ESE_102_MARKS.csv",
        "name":             "Bachelor's ESE – 102 Marks",
        "exam_type":        "end_semester",
        "program_type":     "bachelor",
        "total_marks":      102.0,
        "duration_minutes": 180,
        "instructions":     "Q.1 is compulsory. Attempt any ONE from each OR in Q.2–Q.5.",
        "co_targets":       CO5,
        "blooms_targets":   BLOOMS_ESE,
    },
    {
        "csv_file":         "BACHELORS_ESE_86_MARKS.csv",
        "name":             "Bachelor's ESE – 86 Marks",
        "exam_type":        "end_semester",
        "program_type":     "bachelor",
        "total_marks":      86.0,
        "duration_minutes": 180,
        "instructions":     "Q.1 is compulsory. Attempt any ONE from each OR in Q.2–Q.5.",
        "co_targets":       CO5,
        "blooms_targets":   BLOOMS_ESE,
    },
    {
        "csv_file":         "MASTERS_ESE_102_MARKS.csv",
        "name":             "Master's ESE – 102 Marks",
        "exam_type":        "end_semester",
        "program_type":     "master",
        "total_marks":      102.0,
        "duration_minutes": 180,
        "instructions":     "Q.1 is compulsory. Attempt any ONE from each OR in Q.2–Q.5.",
        "co_targets":       CO5,
        "blooms_targets":   BLOOMS_ESE,
    },
    {
        "csv_file":         "MASTERS_ESE_88_MARKS.csv",
        "name":             "Master's ESE – 88 Marks",
        "exam_type":        "end_semester",
        "program_type":     "master",
        "total_marks":      88.0,
        "duration_minutes": 180,
        "instructions":     "Q.1 is compulsory. Attempt any ONE from each OR in Q.2–Q.5.",
        "co_targets":       CO5,
        "blooms_targets":   BLOOMS_ESE,
    },
    {
        "csv_file":         "MIDSEM_REMEDIAL_BACHLORS_MASTER_80_MARKS.csv",
        "name":             "Mid-Sem / Remedial – 80 Marks",
        "exam_type":        "mid_semester",
        "program_type":     "bachelor",
        "total_marks":      80.0,
        "duration_minutes": 120,
        "instructions":     "Q.1 is compulsory. Attempt any ONE from each OR in Q.2–Q.4.",
        "co_targets":       CO5,
        "blooms_targets":   BLOOMS_MID,
    },
]

# ─────────────────────────────────────────────────────────────────────────────
# Seed
# ─────────────────────────────────────────────────────────────────────────────
for t in TEMPLATES:
    # Parse CSV → sections_config with explicit slot lists
    csv_path = os.path.join(SAMPLE_DIR, t["csv_file"])
    if not os.path.exists(csv_path):
        print(f"[SKIP] CSV not found: {csv_path}")
        continue

    with open(csv_path, encoding="utf-8-sig") as f:
        content = f.read()

    parsed          = parse_exam_csv(content)
    sections_config = build_sections_config(parsed)

    # Delete old template with the same name (full replacement)
    existing = db.query(models.ExamConfiguration).filter(
        models.ExamConfiguration.name == t["name"]
    ).first()
    if existing:
        db.delete(existing)
        db.flush()
        print(f"[DEL] Removed old: {t['name']}")

    cfg = models.ExamConfiguration(
        exam_type        = t["exam_type"],
        name             = t["name"],
        total_marks      = t["total_marks"],
        duration_minutes = t["duration_minutes"],
        instructions     = t["instructions"],
        sections_config  = sections_config,
        co_targets       = t["co_targets"],
        blooms_targets   = t["blooms_targets"],
        created_by       = owner_user.id,
        is_active        = True,
    )
    db.add(cfg)

    # Print the slot structure for verification
    print(f"\n[OK] {t['name']} ({t['total_marks']}m) — {len(sections_config)} sections:")
    for sec in sections_config:
        slots     = sec.get("slots", [])
        mandatory = [s for s in slots if not s.get("is_or")]
        or_alts   = [s for s in slots if s.get("is_or")]
        print(f"       {sec['name']:35s}  {len(mandatory)} mandatory, {len(or_alts)} OR alts")
        for s in slots:
            tag = "OR " if s.get("is_or") else "    "
            print(f"         {tag} slot_id={s['slot_id']!r:20s} label={s['label']!r:12s} marks={s['marks']}  or_group={s.get('or_group')!r}")

db.commit()
db.close()
print("\nDone — 5 templates seeded with correct per-question slot structure.")

# ─────────────────────────────────────────────────────────────────────────────
# Also remove old placeholder templates created before the CSV-based seeding
# ─────────────────────────────────────────────────────────────────────────────
db2 = SessionLocal()
old_names = [
    "Mid Semester (30 Marks)",
    "End Semester (60 Marks)",
    "Remedial Exam (20 Marks)",
]
removed = 0
for name in old_names:
    t = db2.query(models.ExamConfiguration).filter(models.ExamConfiguration.name == name).first()
    if t:
        db2.delete(t)
        removed += 1
        print(f"[DEL] Removed old placeholder: {name}")
if removed:
    db2.commit()
db2.close()
