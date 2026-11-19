from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from app.database import get_db
from app import models, schemas
from app.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/api/questions", tags=["questions"])

ALLOWED_ROLES = ("owner", "faculty")


@router.get("", response_model=List[schemas.QuestionOut])
def list_questions(
    subject_id: Optional[int] = None,
    unit_id: Optional[int] = None,
    co_id: Optional[int] = None,
    blooms_id: Optional[int] = None,
    difficulty: Optional[str] = None,
    question_type: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = (
        db.query(models.Question)
        .options(
            joinedload(models.Question.unit),
            joinedload(models.Question.co),
            joinedload(models.Question.blooms),
            joinedload(models.Question.tags),
        )
        .filter(models.Question.is_active == True)
    )
    if subject_id:
        q = q.filter(models.Question.subject_id == subject_id)
    if unit_id:
        q = q.filter(models.Question.unit_id == unit_id)
    if co_id:
        q = q.filter(models.Question.co_id == co_id)
    if blooms_id:
        q = q.filter(models.Question.blooms_id == blooms_id)
    if difficulty:
        q = q.filter(models.Question.difficulty == difficulty)
    if question_type:
        q = q.filter(models.Question.question_type == question_type)
    if search:
        q = q.filter(models.Question.question_text.ilike(f"%{search}%"))

    questions = q.offset(skip).limit(limit).all()

    # Enrich with codes
    result = []
    for question in questions:
        out = schemas.QuestionOut.model_validate(question)
        out.unit_code = question.unit.unit_code if question.unit else None
        out.co_code = question.co.co_code if question.co else None
        out.blooms_code = question.blooms.level_code if question.blooms else None
        out.tags = [t.tag for t in question.tags]
        result.append(out)
    return result


@router.get("/{question_id}", response_model=schemas.QuestionOut)
def get_question(
    question_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = (
        db.query(models.Question)
        .options(
            joinedload(models.Question.unit),
            joinedload(models.Question.co),
            joinedload(models.Question.blooms),
            joinedload(models.Question.tags),
        )
        .filter(models.Question.id == question_id)
        .first()
    )
    if not q:
        raise HTTPException(404, "Question not found")
    out = schemas.QuestionOut.model_validate(q)
    out.unit_code = q.unit.unit_code if q.unit else None
    out.co_code = q.co.co_code if q.co else None
    out.blooms_code = q.blooms.level_code if q.blooms else None
    out.tags = [t.tag for t in q.tags]
    return out


@router.post("", response_model=schemas.QuestionOut, status_code=201)
def create_question(
    body: schemas.QuestionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles(*ALLOWED_ROLES)),
):
    q = models.Question(
        subject_id=body.subject_id,
        unit_id=body.unit_id,
        co_id=body.co_id,
        blooms_id=body.blooms_id,
        question_text=body.question_text,
        question_type=body.question_type,
        difficulty=body.difficulty,
        default_marks=body.default_marks,
        created_by=current_user.id,
    )
    db.add(q)
    db.flush()
    for tag in body.tags:
        db.add(models.QuestionTag(question_id=q.id, tag=tag))
    db.commit()
    db.refresh(q)
    out = schemas.QuestionOut.model_validate(q)
    out.tags = body.tags
    return out


@router.patch("/{question_id}", response_model=schemas.QuestionOut)
def update_question(
    question_id: int,
    body: schemas.QuestionUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles(*ALLOWED_ROLES)),
):
    q = db.query(models.Question).filter(models.Question.id == question_id).first()
    if not q:
        raise HTTPException(404, "Question not found")

    for field, val in body.model_dump(exclude_none=True).items():
        if field == "tags":
            db.query(models.QuestionTag).filter(models.QuestionTag.question_id == q.id).delete()
            for tag in val:
                db.add(models.QuestionTag(question_id=q.id, tag=tag))
        else:
            setattr(q, field, val)
    db.commit()
    db.refresh(q)
    out = schemas.QuestionOut.model_validate(q)
    out.tags = [t.tag for t in q.tags]
    return out


@router.delete("/{question_id}", status_code=204)
def delete_question(
    question_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*ALLOWED_ROLES)),
):
    q = db.query(models.Question).filter(models.Question.id == question_id).first()
    if not q:
        raise HTTPException(404, "Question not found")
    q.is_active = False
    db.commit()
