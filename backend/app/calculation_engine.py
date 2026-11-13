"""
Marks-based calculation engine for exam paper distributions.

Rules:
- Unit coverage %  = marks assigned to the unit ÷ total paper marks × 100
- CO coverage %    = marks mapped to that CO ÷ total paper marks × 100
- Bloom's level %  = marks mapped to that level ÷ total paper marks × 100
- Questions in the same choice_group are mutually exclusive; only one set of
  marks is counted (the first/representative question's marks).
- Subquestion marks roll up to parent.
- Shared CO / Bloom's across multiple questions is explicitly allowed.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import math


@dataclass
class QuestionEntry:
    question_id: int
    assigned_marks: float
    is_optional: bool = False
    choice_group: Optional[str] = None   # questions sharing choice_group are alternatives
    is_subquestion: bool = False
    parent_question_id: Optional[int] = None

    unit_code: Optional[str] = None
    co_code: Optional[str] = None
    blooms_code: Optional[str] = None
    difficulty: Optional[str] = None
    question_type: Optional[str] = None


@dataclass
class DistributionResult:
    total_marks: float = 0.0
    co_distribution: dict = field(default_factory=dict)        # {co_code: {"marks": x, "percent": y}}
    blooms_distribution: dict = field(default_factory=dict)
    unit_distribution: dict = field(default_factory=dict)
    difficulty_distribution: dict = field(default_factory=dict)
    type_distribution: dict = field(default_factory=dict)
    validation_errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


def _round2(val: float) -> float:
    return round(val, 2)


def calculate_distributions(
    questions: list[QuestionEntry],
    total_marks_target: float,
    tolerance: float = 0.5,
) -> DistributionResult:
    """
    Calculate all distributions from a list of QuestionEntry objects.

    Handles:
    - choice_groups: marks from that group are counted once (the max assigned_marks
      within the group, representing what any student would answer).
    - subquestions: only leaf nodes contribute marks (parents are structural).
    - optional questions that are NOT in a choice_group still contribute marks
      (optional does not mean excluded from paper analysis — it means the student
      may skip it, but the paper has those marks allocated).
    """
    result = DistributionResult()

    # Step 1: resolve choice groups — mark which question_ids are "representatives"
    # Within each choice_group, count the maximum assigned_marks (typically all
    # options have the same marks; if not, use max as the representative mark).
    seen_choice_groups: dict[str, float] = {}
    effective_marks: dict[int, float] = {}

    # Subquestions: exclude from top-level accumulation; their parent is structural
    subquestion_ids = {q.question_id for q in questions if q.is_subquestion}
    parent_ids = {q.parent_question_id for q in questions if q.is_subquestion}

    for q in questions:
        if q.is_subquestion:
            # subquestion marks are counted directly (parent is structural wrapper)
            effective_marks[q.question_id] = q.assigned_marks
        elif q.question_id in parent_ids:
            # Parent of subquestions — it itself has 0 marks (marks come from children)
            effective_marks[q.question_id] = 0.0
        elif q.choice_group:
            if q.choice_group not in seen_choice_groups:
                seen_choice_groups[q.choice_group] = q.assigned_marks
            # Use the first encountered marks for the whole group (they should be equal)
            effective_marks[q.question_id] = seen_choice_groups[q.choice_group]
        else:
            effective_marks[q.question_id] = q.assigned_marks

    # Step 2: compute total marks and which questions count for distributions.
    # For choice_groups: marks are counted once (one slot worth of marks regardless
    # of how many OR alternatives exist). Only the FIRST question in each group
    # contributes marks to the total AND to distributions.
    choice_group_counted: set[str] = set()
    total_marks = 0.0

    for q in questions:
        if q.is_subquestion:
            total_marks += effective_marks[q.question_id]
        elif q.question_id in parent_ids:
            pass  # structural parent
        elif q.choice_group:
            if q.choice_group not in choice_group_counted:
                choice_group_counted.add(q.choice_group)
                total_marks += effective_marks[q.question_id]
            # subsequent OR alternatives: don't add marks again
        else:
            total_marks += effective_marks[q.question_id]

    result.total_marks = _round2(total_marks)

    # Step 3: attribute marks to CO/Bloom's/unit distributions.
    # For choice_groups: count marks only ONCE per group (same rule as total_marks).
    # This ensures "CO actual %" stays consistent with the paper total.
    def _add_to_dist(dist: dict, key: Optional[str], marks: float):
        if not key:
            key = "unassigned"
        if key not in dist:
            dist[key] = {"marks": 0.0}
        dist[key]["marks"] = _round2(dist[key]["marks"] + marks)

    dist_choice_groups_seen: set[str] = set()

    for q in questions:
        if q.question_id in parent_ids:
            continue  # structural parent, no marks
        if q.choice_group:
            if q.choice_group in dist_choice_groups_seen:
                continue  # OR alternative already counted — skip
            dist_choice_groups_seen.add(q.choice_group)
        marks = effective_marks[q.question_id]
        if marks == 0.0:
            continue
        _add_to_dist(result.unit_distribution, q.unit_code, marks)
        _add_to_dist(result.co_distribution, q.co_code, marks)
        _add_to_dist(result.blooms_distribution, q.blooms_code, marks)
        _add_to_dist(result.difficulty_distribution, q.difficulty, marks)
        _add_to_dist(result.type_distribution, q.question_type, marks)

    # Step 4: compute percentages
    if total_marks > 0:
        for dist in (
            result.co_distribution,
            result.blooms_distribution,
            result.unit_distribution,
            result.difficulty_distribution,
            result.type_distribution,
        ):
            for key in dist:
                dist[key]["percent"] = _round2(dist[key]["marks"] / total_marks * 100)

    # Step 5: validation
    errors = []
    warnings = []

    if total_marks_target > 0:
        diff = abs(total_marks - total_marks_target)
        if diff > tolerance:
            errors.append(
                f"Total marks mismatch: calculated {total_marks} vs target {total_marks_target} "
                f"(tolerance ±{tolerance})"
            )

    if "unassigned" in result.co_distribution:
        warnings.append(
            f"Some questions ({result.co_distribution['unassigned']['marks']} marks) have no CO mapping."
        )
    if "unassigned" in result.blooms_distribution:
        warnings.append(
            f"Some questions ({result.blooms_distribution['unassigned']['marks']} marks) have no Bloom's level."
        )
    if "unassigned" in result.unit_distribution:
        warnings.append(
            f"Some questions ({result.unit_distribution['unassigned']['marks']} marks) have no unit assignment."
        )

    result.validation_errors = errors
    result.warnings = warnings
    return result


def validate_against_targets(
    result: DistributionResult,
    co_targets: Optional[dict[str, float]] = None,
    blooms_targets: Optional[dict[str, float]] = None,
    unit_targets: Optional[dict[str, float]] = None,
    tolerance: float = 5.0,
) -> list[str]:
    """
    Check calculated distributions against target percentages.
    Returns a list of gap messages.
    """
    gaps = []

    def _check(dist: dict, targets: dict, label: str):
        for code, target_pct in targets.items():
            actual_pct = dist.get(code, {}).get("percent", 0.0)
            diff = abs(actual_pct - target_pct)
            if diff > tolerance:
                gaps.append(
                    f"{label} {code}: target {target_pct}% vs actual {actual_pct}% "
                    f"(gap {diff:.1f}%, tolerance ±{tolerance}%)"
                )

    if co_targets:
        _check(result.co_distribution, co_targets, "CO")
    if blooms_targets:
        _check(result.blooms_distribution, blooms_targets, "Bloom's")
    if unit_targets:
        _check(result.unit_distribution, unit_targets, "Unit")

    return gaps
