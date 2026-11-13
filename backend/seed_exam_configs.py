"""
Seed exam configurations from the 5 uploaded CSV files.
Run: python seed_exam_configs.py
"""
import os
import sys
import json

# Allow running from backend/ directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app import models
from app.csv_exam_parser import EXAM_CSV_CONFIGS, csv_to_exam_config

SAMPLE_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sample_data')

# Default Bloom's taxonomy distribution — same for all exam types
DEFAULT_BLOOMS_TARGETS = {'R': 15, 'U': 20, 'Ap': 30, 'An': 20, 'E': 10, 'C': 5}

# Default CO distribution targets (equal split by number of theory sections)
# ESE: Q1=MCQ, Q2-Q5=theory → 4 COs at 25% each
DEFAULT_CO_TARGETS_ESE = {'CO1': 25, 'CO2': 25, 'CO3': 25, 'CO4': 25}
# Mid/Remedial: Q1=MCQ, Q2-Q4=theory → 3 COs (34+33+33=100)
DEFAULT_CO_TARGETS_MID = {'CO1': 34, 'CO2': 33, 'CO3': 33}


def _default_co_targets(total_marks: float) -> dict:
    """Return the appropriate default CO targets based on exam marks."""
    return DEFAULT_CO_TARGETS_MID if total_marks == 80.0 else DEFAULT_CO_TARGETS_ESE


def seed_exam_configs(force_update: bool = False):
    db = SessionLocal()
    try:
        # Get or create owner user for created_by
        owner = db.query(models.User).filter(models.User.role == 'owner').first()
        if not owner:
            print("ERROR: No owner user found. Run seed.py first.")
            return

        seeded = 0
        updated = 0
        skipped = 0

        for cfg in EXAM_CSV_CONFIGS:
            csv_path = os.path.join(SAMPLE_DATA_DIR, cfg["csv_filename"])
            if not os.path.exists(csv_path):
                print(f"  SKIP (file not found): {cfg['csv_filename']}")
                skipped += 1
                continue

            # Check if already seeded
            existing = db.query(models.ExamConfiguration).filter(
                models.ExamConfiguration.name == cfg["name"]
            ).first()
            if existing and not force_update:
                print(f"  ALREADY EXISTS: {cfg['name']}")
                skipped += 1
                continue

            # Parse CSV
            parsed_config = csv_to_exam_config(
                csv_path,
                cfg["exam_type"],
                cfg["program_type"],
                cfg["name"],
            )

            # Determine exam_type for DB enum
            # mid_semester CSV covers both mid_semester and remedial
            exam_type = cfg["exam_type"]

            tm = parsed_config["total_marks"]
            if existing and force_update:
                # Update existing record with new sections_config and targets
                existing.sections_config = parsed_config["sections_config"]
                existing.total_marks = tm
                existing.instructions = _build_instructions(parsed_config)
                existing.co_targets = _default_co_targets(tm)
                existing.blooms_targets = DEFAULT_BLOOMS_TARGETS
                db.flush()
                print(f"  UPDATED: {cfg['name']} | {tm} marks | id={existing.id}")
                updated += 1
            else:
                config = models.ExamConfiguration(
                    exam_type=exam_type,
                    department_id=None,   # global default
                    subject_id=None,      # applies to all subjects
                    name=parsed_config["name"],
                    total_marks=tm,
                    duration_minutes=180 if exam_type == "end_semester" else 120,
                    instructions=_build_instructions(parsed_config),
                    sections_config=parsed_config["sections_config"],
                    co_targets=_default_co_targets(tm),
                    blooms_targets=DEFAULT_BLOOMS_TARGETS,
                    is_active=True,
                    created_by=owner.id,
                )
                db.add(config)
                db.flush()
                print(f"  SEEDED: {cfg['name']} | {parsed_config['total_marks']} marks | "
                      f"{len(parsed_config['sections_config'])} sections | id={config.id}")
                seeded += 1

        db.commit()
        print(f"\nDone. Seeded={seeded}, Updated={updated}, Skipped={skipped}")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


def _build_instructions(parsed_config: dict) -> str:
    sections = parsed_config["sections_config"]
    lines = [f"Total Marks: {parsed_config['total_marks']}"]
    for sec in sections:
        or_note = " (with OR choice)" if sec.get("allow_choice") else ""
        lines.append(f"  {sec['name']}: {sec['questions_required']} question(s) x {sec['marks_per_question']} marks = {sec['total_section_marks']} marks{or_note}")
    return "\n".join(lines)


def also_seed_remedial(force_update: bool = False):
    """The MIDSEM_REMEDIAL CSV covers both mid_semester and remedial — seed a copy for remedial."""
    db = SessionLocal()
    try:
        owner = db.query(models.User).filter(models.User.role == 'owner').first()
        if not owner:
            print("ERROR: No owner user found.")
            return

        csv_path = os.path.join(SAMPLE_DATA_DIR, 'MIDSEM_REMEDIAL_BACHLORS_MASTER_80_MARKS.csv')
        if not os.path.exists(csv_path):
            print("SKIP: MIDSEM_REMEDIAL CSV not found")
            return

        remedial_name = "Remedial Exam \u2014 80 Marks"
        existing = db.query(models.ExamConfiguration).filter(
            models.ExamConfiguration.name == remedial_name
        ).first()

        parsed_config = csv_to_exam_config(csv_path, "remedial", "bachelor", remedial_name)

        tm = parsed_config["total_marks"]
        if existing and force_update:
            existing.sections_config = parsed_config["sections_config"]
            existing.total_marks = tm
            existing.instructions = _build_instructions(parsed_config)
            existing.co_targets = _default_co_targets(tm)
            existing.blooms_targets = DEFAULT_BLOOMS_TARGETS
            db.commit()
            print(f"  UPDATED remedial copy: {remedial_name} | id={existing.id}")
        elif existing:
            print(f"  ALREADY EXISTS: {remedial_name}")
            db.close()
            return
        else:
            config = models.ExamConfiguration(
                exam_type="remedial",
                department_id=None,
                subject_id=None,
                name=remedial_name,
                total_marks=tm,
                duration_minutes=120,
                instructions=_build_instructions(parsed_config),
                sections_config=parsed_config["sections_config"],
                co_targets=_default_co_targets(tm),
                blooms_targets=DEFAULT_BLOOMS_TARGETS,
                is_active=True,
                created_by=owner.id,
            )
            db.add(config)
            db.commit()
            db.refresh(config)
            print(f"  SEEDED remedial copy: {remedial_name} | id={config.id}")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='Force update existing records')
    args = parser.parse_args()

    print("Seeding exam configurations from CSV files...")
    seed_exam_configs(force_update=args.force)
    print("\nSeeding remedial copy...")
    also_seed_remedial(force_update=args.force)
