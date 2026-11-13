"""
Migrate existing papers that use the old flat section structure (s4_q1, s5_or1 etc.)
to be deleted so users can recreate them from the updated templates.

Run ONCE after seed_templates.py has been run.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app import models

db = SessionLocal()

# Find all papers whose PaperQuestion rows have old-style slot_ids like s1_q1, s4_or1
old_papers = []
all_papers = db.query(models.ExamPaper).all()

for paper in all_papers:
    for sec in paper.sections:
        for pq in sec.questions:
            sid = pq.slot_id or ''
            # Old format: s1_q1, s4_q2, s5_or1, sec1_or1
            if sid.startswith('s') and ('_q' in sid or '_or' in sid):
                old_papers.append(paper)
                break
        else:
            continue
        break

if not old_papers:
    print("No old-format papers found. Nothing to do.")
    db.close()
    sys.exit(0)

print(f"Found {len(old_papers)} paper(s) with old slot structure:")
for p in old_papers:
    print(f"  [{p.id}] {p.title!r}  status={p.status}")

confirm = input("\nDelete these papers? (yes/no): ").strip().lower()
if confirm != 'yes':
    print("Aborted.")
    db.close()
    sys.exit(0)

for p in old_papers:
    db.delete(p)
    print(f"  [DEL] Paper {p.id}: {p.title!r}")

db.commit()
db.close()
print(f"\nDone — {len(old_papers)} paper(s) deleted. Recreate them from the updated templates.")
