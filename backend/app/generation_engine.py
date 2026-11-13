"""
Paper generation engine: selects questions from the question bank
to satisfy distribution targets as closely as possible.
"""
from __future__ import annotations
import random
from typing import Optional
from sqlalchemy.orm import Session
from app import models
from app.calculation_engine import QuestionEntry, calculate_distributions, validate_against_targets


class GenerationConfig:
    def __init__(
        self,
        subject_id: int,
        exam_type: str,
        total_marks: float,
        sections: list[dict],
        co_targets: Optional[dict] = None,
        blooms_targets: Optional[dict] = None,
        unit_targets: Optional[dict] = None,
        difficulty_targets: Optional[dict] = None,
        exclude_question_ids: Optional[list[int]] = None,
        seed: Optional[int] = None,
    ):
        self.subject_id = subject_id
        self.exam_type = exam_type
        self.total_marks = total_marks
        self.sections = sections  # List[{name, marks, questions_required, question_type, marks_per_q, allow_choice}]
        self.co_targets = co_targets or {}
        self.blooms_targets = blooms_targets or {}
        self.unit_targets = unit_targets or {}
        self.difficulty_targets = difficulty_targets or {}
        self.exclude_question_ids = set(exclude_question_ids or [])
        self.seed = seed


def generate_paper(config: GenerationConfig, db: Session) -> dict:
    """
    Generate a paper draft as a dict with sections → questions.
    Returns: {sections: [...], analysis: {...}, warnings: [...]}
    """
    if config.seed is not None:
        random.seed(config.seed)

    # Fetch all eligible questions for the subject
    all_questions = (
        db.query(models.Question)
        .filter(
            models.Question.subject_id == config.subject_id,
            models.Question.is_active == True,
            ~models.Question.id.in_(config.exclude_question_ids),
        )
        .all()
    )

    sections_output = []
    used_question_ids = set()
    all_entries: list[QuestionEntry] = []

    for sec in config.sections:
        section_name = sec.get("name", "Section")
        marks_per_q = float(sec.get("marks_per_question", 2.0))
        questions_required = int(sec.get("questions_required", 5))
        allow_choice = sec.get("allow_choice", False)
        choice_extra = int(sec.get("choice_extra", 1)) if allow_choice else 0
        q_type_filter = sec.get("question_type")
        difficulty_filter = sec.get("difficulty")

        # Filter pool for this section
        pool = [
            q for q in all_questions
            if q.id not in used_question_ids
            and (not q_type_filter or q.question_type == q_type_filter)
            and (not difficulty_filter or q.difficulty == difficulty_filter)
        ]

        # Sort pool by target-alignment score
        pool = _score_and_sort(pool, config, marks_per_q)

        total_to_pick = questions_required + choice_extra
        picked = pool[:total_to_pick]

        if len(picked) < questions_required:
            # Fill with any remaining questions regardless of type
            extras = [q for q in all_questions if q.id not in used_question_ids and q not in picked]
            extras = _score_and_sort(extras, config, marks_per_q)
            picked += extras[: (total_to_pick - len(picked))]

        section_questions = []
        for idx, q in enumerate(picked):
            used_question_ids.add(q.id)
            is_opt = allow_choice and idx >= questions_required
            choice_grp = f"{section_name}_choice" if allow_choice else None
            entry = QuestionEntry(
                question_id=q.id,
                assigned_marks=marks_per_q,
                is_optional=is_opt,
                choice_group=choice_grp if is_opt else None,
                unit_code=q.unit.unit_code if q.unit else None,
                co_code=q.co.co_code if q.co else None,
                blooms_code=q.blooms.level_code if q.blooms else None,
                difficulty=q.difficulty,
                question_type=q.question_type,
            )
            all_entries.append(entry)
            section_questions.append({
                "question_id": q.id,
                "question_text": q.question_text,
                "assigned_marks": marks_per_q,
                "is_optional": is_opt,
                "choice_group": choice_grp if is_opt else None,
                "unit_code": q.unit.unit_code if q.unit else None,
                "co_code": q.co.co_code if q.co else None,
                "blooms_code": q.blooms.level_code if q.blooms else None,
                "difficulty": q.difficulty,
                "question_type": q.question_type,
            })

        sections_output.append({
            "name": section_name,
            "questions": section_questions,
            "marks_allocated": questions_required * marks_per_q,
        })

    # Calculate distributions
    analysis = calculate_distributions(all_entries, config.total_marks)
    gaps = validate_against_targets(
        analysis,
        co_targets=config.co_targets,
        blooms_targets=config.blooms_targets,
        unit_targets=config.unit_targets,
    )

    return {
        "sections": sections_output,
        "analysis": {
            "total_marks": analysis.total_marks,
            "co_distribution": analysis.co_distribution,
            "blooms_distribution": analysis.blooms_distribution,
            "unit_distribution": analysis.unit_distribution,
            "difficulty_distribution": analysis.difficulty_distribution,
            "validation_errors": analysis.validation_errors + gaps,
            "warnings": analysis.warnings,
        },
        "warnings": analysis.warnings + gaps,
    }


def _score_and_sort(questions, config: GenerationConfig, marks_per_q: float) -> list:
    """Score questions by how well they match distribution targets; higher = better."""
    def score(q):
        s = 0.0
        if q.co and config.co_targets:
            co_code = q.co.co_code
            s += config.co_targets.get(co_code, 0) * 0.5
        if q.blooms and config.blooms_targets:
            bl_code = q.blooms.level_code
            s += config.blooms_targets.get(bl_code, 0) * 0.5
        if q.unit and config.unit_targets:
            un_code = q.unit.unit_code
            s += config.unit_targets.get(un_code, 0) * 0.3
        return s

    scored = [(score(q), random.random(), q) for q in questions]
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [q for _, _, q in scored]
