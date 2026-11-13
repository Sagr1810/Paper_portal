from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app import models, schemas
from app.dependencies import get_current_user, get_owner, require_roles

router = APIRouter(prefix="/api/master", tags=["master-data"])


# ── Departments ────────────────────────────────────────────────────────────

@router.get("/departments", response_model=List[schemas.DepartmentOut])
def list_departments(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(models.Department).filter(models.Department.is_active == True).all()


@router.post("/departments", response_model=schemas.DepartmentOut, status_code=201)
def create_department(body: schemas.DepartmentCreate, db: Session = Depends(get_db), _=Depends(get_owner)):
    dept = models.Department(name=body.name, program_type=body.program_type)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return dept


@router.delete("/departments/{dept_id}", status_code=204)
def delete_department(dept_id: int, db: Session = Depends(get_db), _=Depends(get_owner)):
    dept = db.query(models.Department).filter(models.Department.id == dept_id).first()
    if not dept:
        raise HTTPException(404, "Department not found")
    dept.is_active = False
    db.commit()


# ── Subjects ───────────────────────────────────────────────────────────────

@router.get("/subjects", response_model=List[schemas.SubjectOut])
def list_subjects(
    department_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(models.Subject).filter(models.Subject.is_active == True)
    if department_id:
        q = q.filter(models.Subject.department_id == department_id)
    return q.all()


@router.post("/subjects", response_model=schemas.SubjectOut, status_code=201)
def create_subject(
    body: schemas.SubjectCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("owner", "faculty")),
):
    subj = models.Subject(**body.model_dump())
    db.add(subj)
    db.commit()
    db.refresh(subj)
    return subj


@router.patch("/subjects/{subject_id}", response_model=schemas.SubjectOut)
def update_subject(
    subject_id: int,
    body: schemas.SubjectUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("owner", "faculty")),
):
    subj = db.query(models.Subject).filter(models.Subject.id == subject_id, models.Subject.is_active == True).first()
    if not subj:
        raise HTTPException(404, "Subject not found")
    if body.subject_code is not None:
        subj.subject_code = body.subject_code
    if body.subject_name is not None:
        subj.subject_name = body.subject_name
    if body.semester is not None:
        subj.semester = body.semester
    db.commit()
    db.refresh(subj)
    return subj


@router.delete("/subjects/{subject_id}", status_code=204)
def delete_subject(
    subject_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_roles("owner", "faculty")),
):
    subj = db.query(models.Subject).filter(models.Subject.id == subject_id).first()
    if not subj:
        raise HTTPException(404, "Subject not found")
    subj.is_active = False
    db.commit()


# ── Syllabus Units ─────────────────────────────────────────────────────────

@router.get("/units", response_model=List[schemas.UnitOut])
def list_units(
    subject_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(models.SyllabusUnit)
    if subject_id:
        q = q.filter(models.SyllabusUnit.subject_id == subject_id)
    return q.all()


@router.post("/units", response_model=schemas.UnitOut, status_code=201)
def create_unit(body: schemas.UnitCreate, db: Session = Depends(get_db), _=Depends(get_owner)):
    unit = models.SyllabusUnit(**body.model_dump())
    db.add(unit)
    db.commit()
    db.refresh(unit)
    return unit


# ── Course Outcomes ────────────────────────────────────────────────────────

@router.get("/cos", response_model=List[schemas.COOut])
def list_cos(
    subject_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(models.CourseOutcome)
    if subject_id:
        q = q.filter(models.CourseOutcome.subject_id == subject_id)
    return q.all()


@router.post("/cos", response_model=schemas.COOut, status_code=201)
def create_co(
    body: schemas.COCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("owner", "faculty")),
):
    co = models.CourseOutcome(**body.model_dump())
    db.add(co)
    db.commit()
    db.refresh(co)
    return co


@router.patch("/cos/{co_id}", response_model=schemas.COOut)
def update_co(
    co_id: int,
    body: schemas.COUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("owner", "faculty")),
):
    co = db.query(models.CourseOutcome).filter(models.CourseOutcome.id == co_id).first()
    if not co:
        raise HTTPException(404, "CO not found")
    if body.co_code is not None:
        co.co_code = body.co_code
    if body.description is not None:
        co.description = body.description
    if body.po_mapping is not None:
        co.po_mapping = body.po_mapping
    db.commit()
    db.refresh(co)
    return co


@router.delete("/cos/{co_id}", status_code=204)
def delete_co(
    co_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_roles("owner", "faculty")),
):
    co = db.query(models.CourseOutcome).filter(models.CourseOutcome.id == co_id).first()
    if not co:
        raise HTTPException(404, "CO not found")
    db.delete(co)
    db.commit()


# ── Bloom's Levels ─────────────────────────────────────────────────────────

@router.get("/blooms", response_model=List[schemas.BloomsOut])
def list_blooms(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(models.BloomsLevel).order_by(models.BloomsLevel.order_num).all()


@router.post("/blooms", response_model=schemas.BloomsOut, status_code=201)
def create_blooms(body: schemas.BloomsCreate, db: Session = Depends(get_db), _=Depends(get_owner)):
    bl = models.BloomsLevel(**body.model_dump())
    db.add(bl)
    db.commit()
    db.refresh(bl)
    return bl


# ── Exam Configurations ────────────────────────────────────────────────────

@router.get("/exam-configs", response_model=List[schemas.ExamConfigOut])
def list_exam_configs(
    exam_type: Optional[str] = None,
    department_id: Optional[int] = None,
    program_type: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(models.ExamConfiguration).filter(models.ExamConfiguration.is_active == True)
    if exam_type:
        q = q.filter(models.ExamConfiguration.exam_type == exam_type)
    if department_id:
        q = q.filter(models.ExamConfiguration.department_id == department_id)
    return q.all()


@router.get("/exam-configs/{config_id}", response_model=schemas.ExamConfigOut)
def get_exam_config(
    config_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    config = db.query(models.ExamConfiguration).filter(
        models.ExamConfiguration.id == config_id,
        models.ExamConfiguration.is_active == True,
    ).first()
    if not config:
        raise HTTPException(404, "Exam configuration not found")
    return config


@router.post("/exam-configs", response_model=schemas.ExamConfigOut, status_code=201)
def create_exam_config(
    body: schemas.ExamConfigCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_owner),
):
    config = models.ExamConfiguration(
        exam_type=body.exam_type,
        department_id=body.department_id,
        subject_id=body.subject_id,
        name=body.name,
        total_marks=body.total_marks,
        duration_minutes=body.duration_minutes,
        instructions=body.instructions,
        sections_config=[s.model_dump() for s in body.sections_config],
        co_targets=body.co_targets,
        blooms_targets=body.blooms_targets,
        created_by=current_user.id,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@router.patch("/exam-configs/{config_id}/targets", response_model=schemas.ExamConfigOut)
def update_exam_config_targets(
    config_id: int,
    body: schemas.ExamConfigTargetsUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_owner),
):
    """Update only the co_targets and blooms_targets of an existing exam configuration."""
    config = db.query(models.ExamConfiguration).filter(
        models.ExamConfiguration.id == config_id,
        models.ExamConfiguration.is_active == True,
    ).first()
    if not config:
        raise HTTPException(404, "Exam configuration not found")
    if body.co_targets is not None:
        config.co_targets = body.co_targets
    if body.blooms_targets is not None:
        config.blooms_targets = body.blooms_targets
    db.commit()
    db.refresh(config)
    return config
