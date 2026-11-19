"""
Parse university exam mark-scheme CSV files into structured sections_config JSON.

CSV format:
  Que, Mark, [Q label col], [sub label col], OR/blank, MARKS, CO, BLOOM'S

Rules:
- Q1 rows (labels like 1A, 1B … 1L or Roman numerals) = flat 1-mark questions
- Q2-Q5 rows = sub-questions (a), (b), (c) with optional OR alternatives
- A row with "OR" in column 4 (0-indexed) marks the start of an alternative group
- Empty rows are spacers
- Total marks appear as a lone numeric in column 1 at the bottom
"""
from __future__ import annotations
import csv
import io
import re
from typing import Optional


def _num(val: str) -> Optional[float]:
    """Parse a string to float, return None if not numeric."""
    try:
        return float(str(val).strip())
    except (ValueError, TypeError):
        return None


def parse_exam_csv(content: str) -> dict:
    """
    Parse exam-format CSV text and return a structured dict:
    {
        "total_marks": float,
        "sections": [
            {
                "name": str,                  # "Q1", "Q2", …
                "label": str,                 # display label
                "mandatory": bool,
                "questions": [
                    {
                        "slot_id": str,       # "Q1A", "Q2a", …
                        "label": str,         # "(a)", "I", …
                        "marks": float,
                        "is_or": bool,        # True = alternative (OR) of previous
                        "or_group": str|None  # e.g. "Q2b_or" groups Q2b + its OR
                    }
                ]
            }
        ]
    }
    """
    # Strip BOM
    content = content.lstrip('\ufeff')
    reader = csv.reader(io.StringIO(content))
    rows = [row for row in reader]

    total_marks: Optional[float] = None
    sections: list[dict] = []

    # Detect Q1 block vs Q2+ blocks
    # Q1 block: rows where Que col matches e.g. "1A","1B","1C" or just Roman numerals appear in col 2
    # Q2+ block: rows where Que col matches "2A","2B","3A" etc.

    q1_rows = []
    qn_rows_by_q: dict[int, list] = {}  # q_num -> list of raw rows
    current_q: Optional[int] = None

    for row in rows:
        # Pad row to at least 8 cols
        while len(row) < 8:
            row.append('')

        que_raw = row[0].strip()
        mark_raw = row[1].strip()
        label_col3 = row[2].strip()  # "Q.2", "Q.3", …
        sub_col4 = row[3].strip()    # "(a)", "(b)", "I", "II", …
        or_col5 = row[4].strip().upper()  # "OR" or blank
        marks_col6 = row[5].strip()   # numeric marks (duplicate of col 1)

        # Skip header row
        if que_raw.lower() == 'que':
            continue

        # Detect total row: blank que, numeric mark, AND no sub-label in col3/col4.
        # Must NOT fire for Q1 continuation rows like ,2,,XI,,2,, (which have sub_col4='XI').
        if not que_raw and _num(mark_raw) is not None and not sub_col4.strip():
            total_marks = _num(mark_raw)
            continue

        # OR separator row — must check BEFORE blank-row filter
        # because OR rows have: que='', mark='', marks_col6='' but col4='OR'
        if or_col5 == 'OR':
            if current_q is not None:
                qn_rows_by_q.setdefault(current_q, []).append(row)
            continue

        # Skip blank rows (no OR, no marks)
        if not que_raw and not mark_raw and not marks_col6:
            continue

        # Q1 sub-rows: que matches:
        #   "1A"  (simple form)
        #   "Q1. A"  (Masters format with dot+space)
        #   blank que but we're already in Q1 and there's a mark + sub-label
        #   (e.g. the ,2,,XI,,2,, rows in the 80-marks CSV for 1K/1L)
        m1 = re.match(r'^1([A-Za-z])$', que_raw)
        m1_dot = re.match(r'^Q1\.\s*([A-Za-z])$', que_raw)
        m1_cont = (
            not que_raw
            and current_q == 1
            and _num(mark_raw) is not None
            and sub_col4.strip()  # has a sub-label like "XI", "XII"
        )
        if m1 or m1_dot or m1_cont:
            if m1_cont:
                # Auto-generate slot_id based on existing Q1 count: 1K, 1L, …
                idx = len(q1_rows)  # 0-based count of Q1 rows so far
                letter = chr(ord('A') + idx)
                row[0] = f'1{letter}'   # patch que_raw in-place so downstream uses it
            q1_rows.append(row)
            current_q = 1
            continue

        # Q2-Q5 sub-rows: que matches e.g. "2A","2B","3A"
        mn = re.match(r'^([2-9])([A-Za-z])$', que_raw)
        if mn:
            current_q = int(mn.group(1))
            qn_rows_by_q.setdefault(current_q, []).append(row)
            continue

        # Blank que but we're in a Q2+ block (sub-question continuation / OR alternative)
        if current_q and current_q >= 2 and marks_col6:
            qn_rows_by_q.setdefault(current_q, []).append(row)
            continue

    # Build Q1 section
    if q1_rows:
        q1_questions = []
        for row in q1_rows:
            que_raw = row[0].strip()
            mark_raw = _num(row[1].strip()) or _num(row[5].strip()) or 1.0
            sub_label = row[3].strip() or que_raw
            q1_questions.append({
                "slot_id": que_raw,
                "label": sub_label,
                "marks": mark_raw,
                "is_or": False,
                "or_group": None,
            })
        sections.append({
            "name": "Q1",
            "label": "Question 1",
            "mandatory": True,
            "questions": q1_questions,
        })

    # Build Q2-Q5 sections
    #
    # Two OR patterns appear in the CSVs:
    #
    # PATTERN A — per-subquestion OR (Q2):
    #   2A,3  → mandatory (a)
    #   2B,4  → mandatory (b)
    #   ,,OR  → choice group for (b) only
    #   2B,4  → OR alt for (b)
    #   2C,5  → mandatory (c)          ← new slot, ends the OR group
    #   ,,OR  → choice group for (c) only
    #   2C,5  → OR alt for (c)
    #   Result: 2A has or_group=None; 2B and its alt share "2B_or"; 2C and its alt share "2C_or"
    #
    # PATTERN B — whole-question OR (Q4, Q5):
    #   4A,3  → mandatory (a)
    #   4B,4  → mandatory (b)
    #   4C,5  → mandatory (c)
    #   ,,OR  → choice group for the ENTIRE question
    #   4A,3  → OR alt (a)
    #   4B,4  → OR alt (b)
    #   4C,5  → OR alt (c)
    #   Result: 4A, 4B, 4C all share or_group="Q4_or"; all three alts share "Q4_or"
    #
    # PATTERN B-partial — partial-group OR (Q3):
    #   3A,3  → mandatory (a)           ← always answered, not in any OR group
    #   3B,4  → mandatory (b)           ← in choice group
    #   3C,5  → mandatory (c)           ← in choice group
    #   ,,OR  → choice group for (b)+(c)
    #   3B,4  → OR alt (b)
    #   3C,5  → OR alt (c)
    #   Result: 3A has or_group=None; 3B, 3C, and their alts share "Q3_or"
    #
    # Algorithm:
    # Phase 1: collect all rows, using a simple "any mandatory already seen" heuristic
    #          to detect OR alts. Assign a tentative or_group to OR alts.
    # Phase 2: retroactively assign or_group to mandatory slots that have a matching OR alt
    #          (i.e., mandatory slot_id appears as the base of an OR alt in the same group).

    for q_num in sorted(qn_rows_by_q.keys()):
        raw_rows = qn_rows_by_q[q_num]
        questions: list[dict] = []
        pending_or_group: Optional[str] = None
        or_trigger_slot: Optional[str] = None

        # ── Phase 1: parse rows ──────────────────────────────────────────────
        for row in raw_rows:
            que_raw = row[0].strip()
            mark_raw = _num(row[1].strip()) or _num(row[5].strip())
            sub_col = row[3].strip()
            or_col = row[4].strip().upper()
            marks6 = _num(row[5].strip())

            if or_col == 'OR':
                # Name the group after the last mandatory slot seen
                last_mandatory = next(
                    (q for q in reversed(questions) if not q['is_or']), None
                )
                or_trigger_slot = last_mandatory['slot_id'] if last_mandatory else f"Q{q_num}"
                pending_or_group = f"{or_trigger_slot}_or"
                continue

            marks = mark_raw if mark_raw is not None else (marks6 if marks6 is not None else 0.0)

            sub_letter = sub_col.strip('()').upper() if sub_col else ''
            if que_raw:
                slot_id = que_raw
            else:
                slot_id = f"Q{q_num}{sub_letter}"
            label = sub_col or slot_id

            if pending_or_group is not None:
                existing_mandatory_slots = {q['slot_id'] for q in questions if not q['is_or']}
                existing_or_base_slots = {
                    re.sub(r'_alt\d+$', '', q['slot_id'])
                    for q in questions if q['is_or'] and q['or_group'] == pending_or_group
                }

                # OR alt if slot_id matches a previously-seen mandatory OR trigger OR
                # already used as OR alt base in this group
                is_or_alt = (
                    slot_id in existing_mandatory_slots
                    or slot_id == or_trigger_slot
                    or slot_id in existing_or_base_slots
                )

                if not is_or_alt:
                    # New mandatory sub-question — close the OR group
                    pending_or_group = None
                    or_trigger_slot = None
                    questions.append({
                        "slot_id": slot_id,
                        "label": label,
                        "marks": marks,
                        "is_or": False,
                        "or_group": None,
                    })
                else:
                    existing_alts = sum(
                        1 for q in questions
                        if q['is_or'] and q['or_group'] == pending_or_group
                    )
                    questions.append({
                        "slot_id": f"{slot_id}_alt{existing_alts}",
                        "label": f"{label} (OR)",
                        "marks": marks,
                        "is_or": True,
                        "or_group": pending_or_group,
                    })
            else:
                questions.append({
                    "slot_id": slot_id,
                    "label": label,
                    "marks": marks,
                    "is_or": False,
                    "or_group": None,
                })

        # ── Phase 2: retroactive grouping ────────────────────────────────────
        # For each OR group, find mandatory slots whose slot_id matches the base
        # of an OR alt in that group, and assign them the same or_group.
        #
        # Additionally, if the OR alts cover ALL ungrouped mandatory slots in the
        # block (Pattern B whole-question OR), rename the group to "Q{q_num}_or"
        # for clarity.
        #
        # Handles:
        #   Pattern B      (Q4/Q5): 4A,4B,4C all get "Q4_or"
        #   Pattern B-partial (Q3): 3B,3C get "Q3_or" but 3A stays None
        #   Pattern A         (Q2): 2B gets "2B_or", 2C gets "2C_or", 2A stays None
        or_groups_present = {q['or_group'] for q in questions if q['is_or'] and q['or_group']}
        for grp in or_groups_present:
            # Collect base slot_ids of OR alts in this group
            or_alt_bases = {
                re.sub(r'_alt\d+$', '', q['slot_id'])
                for q in questions if q['is_or'] and q['or_group'] == grp
            }
            # Ungrouped mandatory slots whose slot_id is in or_alt_bases
            matching_mandatories = [
                q for q in questions
                if not q['is_or'] and q['or_group'] is None and q['slot_id'] in or_alt_bases
            ]

            # Determine the final group name:
            # If this group's OR alts cover more than one mandatory slot, use "Q{q_num}_or"
            # (whole-question or partial-group OR — both get the question-level name).
            # For single-slot per-subquestion OR (Pattern A), keep the original trigger name.
            final_group = f"Q{q_num}_or" if len(or_alt_bases) > 1 else grp

            # Assign or_group to matching mandatory slots
            for q in matching_mandatories:
                q['or_group'] = final_group

            # If the group was renamed, update all OR alts in this group too
            if final_group != grp:
                for q in questions:
                    if q['is_or'] and q['or_group'] == grp:
                        q['or_group'] = final_group

        sections.append({
            "name": f"Q{q_num}",
            "label": f"Question {q_num}",
            "mandatory": False,
            "questions": questions,
        })

    return {
        "total_marks": total_marks or 0.0,
        "sections": sections,
    }


def _sub_letter_from_slot_id(slot_id: str) -> str:
    """
    Extract a lowercase sub-question letter from a slot_id.
    Examples:
      '2A'     → 'a'
      '2B_alt0' → 'b'
      'Q1. A'  → 'a'
      '1A'     → 'a'
    Returns '' if nothing can be extracted.
    """
    sid = re.sub(r'_alt\d+$', '', slot_id)   # strip _alt0 suffix
    m = re.search(r'([A-Za-z])$', sid)
    return m.group(1).lower() if m else ''


def _make_slot_label(q_num: int, slot: dict) -> str:
    """
    Return a display label of the form  "Q{n} ({letter})"  for every slot.

    For mandatory slots the raw label from the CSV is e.g. "(a)", "I", "1A".
    For OR-alt slots the raw label ends with " (OR)".
    We strip those and rebuild from the slot_id letter instead so the label
    is always consistent: Q2 (a), Q2 (b), Q3 (c), etc.
    """
    letter = _sub_letter_from_slot_id(slot['slot_id'])
    if not letter:
        # Fallback: try to extract from the raw label "(a)" → "a"
        raw = re.sub(r'\s*\(OR\)\s*$', '', slot['label'], flags=re.IGNORECASE).strip()
        m = re.search(r'([A-Za-z])', raw)
        letter = m.group(1).lower() if m else '?'
    return f"Q{q_num} ({letter})"


def build_sections_config(parsed: dict) -> list[dict]:
    """
    Convert the parsed CSV structure into the sections_config JSON format
    used by ExamConfiguration.sections_config.

    Returns a list of section dicts compatible with the generation engine.
    The slot-based detail is preserved in the 'slots' key for faculty CO/Bloom's assignment.
    Slot labels are normalised to "Q{n} (a)", "Q{n} (b)", … for every question.
    """
    result = []
    for sec in parsed["sections"]:
        q_num_str = sec["name"]  # "Q1", "Q2", …
        m = re.match(r'^Q(\d+)$', q_num_str)
        q_num = int(m.group(1)) if m else 0

        # Rewrite every slot's label to "Q{n} (letter)" form
        slots_out = []
        for slot in sec["questions"]:
            slots_out.append({
                **slot,
                "label": _make_slot_label(q_num, slot) if q_num else slot["label"],
            })

        # Count mandatory (non-OR) questions
        mandatory_slots = [q for q in slots_out if not q["is_or"]]
        or_slots        = [q for q in slots_out if q["is_or"]]

        total_marks_for_section = sum(q["marks"] for q in mandatory_slots)
        marks_per_q_values = list({q["marks"] for q in mandatory_slots})
        marks_per_q = marks_per_q_values[0] if len(marks_per_q_values) == 1 else (
            total_marks_for_section / len(mandatory_slots) if mandatory_slots else 1.0
        )

        result.append({
            "name": sec["name"],
            "label": sec["label"],
            "mandatory": sec["mandatory"],
            "questions_required": len(mandatory_slots),
            "marks_per_question": marks_per_q,
            "total_section_marks": total_marks_for_section,
            "allow_choice": len(or_slots) > 0,
            "choice_extra": len({q["or_group"] for q in or_slots if q["or_group"]}),
            "slots": slots_out,  # detailed per-slot info for CO/Bloom's assignment
        })
    return result


def parse_csv_file(filepath: str) -> dict:
    """Read a CSV file and parse it."""
    with open(filepath, encoding='utf-8-sig') as f:
        content = f.read()
    return parse_exam_csv(content)


def csv_to_exam_config(filepath: str, exam_type: str, program_type: str, name: str) -> dict:
    """
    Parse a CSV file and return a complete exam configuration dict.
    
    Returns:
    {
        "name": str,
        "exam_type": str,         # "end_semester" | "mid_semester" | "remedial"
        "program_type": str,      # "bachelor" | "master"
        "total_marks": float,
        "sections_config": list[dict]
    }
    """
    parsed = parse_csv_file(filepath)
    sections_config = build_sections_config(parsed)
    return {
        "name": name,
        "exam_type": exam_type,
        "program_type": program_type,
        "total_marks": parsed["total_marks"],
        "sections_config": sections_config,
        "raw_parsed": parsed,
    }


# ── Pre-defined configurations for the 5 uploaded CSVs ──────────────────────

EXAM_CSV_CONFIGS = [
    {
        "csv_filename": "BACHELORS_ESE_102_MARKS.csv",
        "exam_type": "end_semester",
        "program_type": "bachelor",
        "name": "Bachelor's ESE — 102 Marks",
    },
    {
        "csv_filename": "BACHELORS_ESE_86_MARKS.csv",
        "exam_type": "end_semester",
        "program_type": "bachelor",
        "name": "Bachelor's ESE — 86 Marks",
    },
    {
        "csv_filename": "MASTERS_ESE_102_MARKS.csv",
        "exam_type": "end_semester",
        "program_type": "master",
        "name": "Master's ESE — 102 Marks",
    },
    {
        "csv_filename": "MASTERS_ESE_88_MARKS.csv",
        "exam_type": "end_semester",
        "program_type": "master",
        "name": "Master's ESE — 88 Marks",
    },
    {
        "csv_filename": "MIDSEM_REMEDIAL_BACHLORS_MASTER_80_MARKS.csv",
        "exam_type": "mid_semester",
        "program_type": "bachelor",
        "name": "Mid-Sem / Remedial — 80 Marks",
    },
]
