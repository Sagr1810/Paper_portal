from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.dependencies import require_roles
from app.syllabus_parser import SyllabusError, parse_syllabus

router = APIRouter(prefix="/api/syllabus", tags=["syllabus"])

MAX_BYTES = 10 * 1024 * 1024


@router.post("/parse")
async def parse(file: UploadFile = File(...), current_user=Depends(require_roles("owner", "faculty"))):
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "The PDF is larger than 10 MB")
    try:
        return parse_syllabus(data)
    except SyllabusError as e:
        raise HTTPException(422, str(e))


class UnitIn(BaseModel):
    unit_code: str
    unit_name: str
    weight_percent: float = Field(0.0, ge=0, le=100)
    description: Optional[str] = None


class CoIn(BaseModel):
    co_code: str
    description: str
    po_mapping: Optional[str] = None


class ImportBody(BaseModel):
    subject_code: str
    subject_name: str
    semester: Optional[int] = None
    program: Optional[str] = None
    department_id: Optional[int] = None  # only used when the user has no department of their own (owner)
    units: List[UnitIn] = []
    cos: List[CoIn] = []


@router.post("/import")
def import_syllabus(
    body: ImportBody,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles("owner", "faculty")),
):
    code = body.subject_code.strip()
    name = body.subject_name.strip()
    if not code or not name:
        raise HTTPException(422, "Subject code and subject name are required")
    dept_id = getattr(current_user, "department_id", None) or body.department_id
    if not dept_id:
        raise HTTPException(422, "Your account has no department assigned")
    keys = [u.unit_code.strip().lower() for u in body.units]
    if any(not k for k in keys) or any(not u.unit_name.strip() for u in body.units):
        raise HTTPException(422, "Every unit needs a code and a name")
    if len(set(keys)) != len(keys):
        raise HTTPException(422, "Two units have the same code")

    subject = (
        db.query(models.Subject)
        .filter(models.Subject.department_id == dept_id, func.lower(models.Subject.subject_code) == code.lower())
        .first()
    )
    created = False
    restored = False
    if not subject:
        subject = models.Subject(department_id=dept_id, subject_code=code, subject_name=name, semester=body.semester,
                                 created_by=(current_user.id if current_user.role == "faculty" else None))
        db.add(subject)
        db.flush()
        created = True
    elif not subject.is_active:
        subject.is_active = True
        subject.subject_name = name
        if body.semester:
            subject.semester = body.semester
        restored = True

    if body.semester:
        subject.semester = body.semester
    if body.program and body.program.strip() and hasattr(models.Subject, "program"):
        subject.program = body.program.strip()

    existing = {
        (u.unit_code or "").lower(): u
        for u in db.query(models.SyllabusUnit).filter(models.SyllabusUnit.subject_id == subject.id)
    }
    added = updated = 0
    for u, key in zip(body.units, keys):
        row = existing.get(key)
        if row:
            row.unit_name = u.unit_name.strip()
            row.weight_percent = u.weight_percent
            if u.description:
                row.description = u.description
            updated += 1
        else:
            db.add(models.SyllabusUnit(
                subject_id=subject.id, unit_code=u.unit_code.strip(), unit_name=u.unit_name.strip(),
                weight_percent=u.weight_percent, description=u.description,
            ))
            added += 1
    co_existing = {
        (c.co_code or "").lower(): c
        for c in db.query(models.CourseOutcome).filter(models.CourseOutcome.subject_id == subject.id)
    }
    cos_added = cos_updated = 0
    for c in body.cos:
        k = c.co_code.strip().lower()
        if not k or not c.description.strip():
            continue
        row = co_existing.get(k)
        if row:
            row.description = c.description.strip()
            if c.po_mapping:
                row.po_mapping = c.po_mapping.strip()
            cos_updated += 1
        else:
            row = models.CourseOutcome(subject_id=subject.id, co_code=c.co_code.strip(),
                                       description=c.description.strip(), po_mapping=c.po_mapping)
            db.add(row)
            co_existing[k] = row
            cos_added += 1
    if current_user.role == "faculty":
        from sqlalchemy import text as _sqltext
        db.execute(_sqltext("INSERT IGNORE INTO subject_faculty (subject_id, user_id) VALUES (:s, :u)"),
                   {"s": subject.id, "u": current_user.id})
    db.commit()
    return {
        "subject": {"id": subject.id, "subject_code": subject.subject_code, "subject_name": subject.subject_name},
        "created": created, "restored": restored, "added": added, "updated": updated,
        "cos_added": cos_added, "cos_updated": cos_updated,
    }
