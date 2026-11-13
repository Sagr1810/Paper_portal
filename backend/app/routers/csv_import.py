"""
CSV import pipeline: upload, column mapping, preview, validate, import.
"""
import os
import uuid
import io
import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from typing import Any, List, Optional
from app.database import get_db
from app import models, schemas
from app.dependencies import get_current_user, require_roles
from app.config import settings
from app.audit import log_audit

router = APIRouter(prefix="/api/imports", tags=["csv-imports"])

ALLOWED_CATEGORIES = {"questions", "sample_papers", "units", "co", "blooms", "exam_config"}

# Required fields per category
REQUIRED_FIELDS = {
    "questions": ["question_text", "question_type", "difficulty", "default_marks"],
    "units": ["unit_code", "unit_name"],
    "co": ["co_code", "description"],
    "blooms": ["level_code", "level_name", "category"],
    "exam_config": ["exam_type", "name", "total_marks"],
    "sample_papers": ["question_text"],
}


@router.post("/upload", status_code=201)
async def upload_csv(
    file: UploadFile = File(...),
    category: str = Form(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("owner", "faculty")),
):
    if category not in ALLOWED_CATEGORIES:
        raise HTTPException(400, f"category must be one of {ALLOWED_CATEGORIES}")

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    content = await file.read()
    if len(content) > max_bytes:
        raise HTTPException(413, f"File exceeds {settings.MAX_UPLOAD_SIZE_MB}MB limit")

    # Parse headers
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Could not parse CSV: {e}")

    # Save file
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}_{file.filename}"
    stored_path = os.path.join(settings.UPLOAD_DIR, stored_name)
    with open(stored_path, "wb") as f:
        f.write(content)

    # Suggest column mapping (simple fuzzy match)
    suggested_mapping = _suggest_mapping(list(df.columns), category)

    imp = models.CsvImport(
        uploaded_by=current_user.id,
        category=category,
        original_filename=file.filename,
        stored_filename=stored_name,
        column_mapping=suggested_mapping,
        status="pending",
        rows_total=len(df),
    )
    db.add(imp)
    db.commit()
    db.refresh(imp)

    # pandas uses float('nan') for empty cells — replace with None so JSON serialises cleanly
    preview_records = df.head(10).where(pd.notnull(df.head(10)), other=None).to_dict(orient="records")

    return {
        "import_id": imp.id,
        "rows_total": len(df),
        "csv_columns": list(df.columns),
        "suggested_mapping": suggested_mapping,
        "preview": preview_records,
    }


@router.post("/confirm-mapping")
def confirm_mapping(
    body: schemas.ColumnMappingRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("owner", "faculty")),
):
    imp = db.query(models.CsvImport).filter(models.CsvImport.id == body.import_id).first()
    if not imp:
        raise HTTPException(404, "Import record not found")
    if imp.uploaded_by != current_user.id and current_user.role != "owner":
        raise HTTPException(403, "Access denied")
    imp.column_mapping = body.mapping
    imp.status = "mapping_confirmed"
    db.commit()
    return {"import_id": imp.id, "status": imp.status, "mapping": body.mapping}


@router.post("/{import_id}/validate")
def validate_import(
    import_id: int,
    subject_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("owner", "faculty")),
):
    imp, df = _load_import(import_id, current_user, db)
    errors = _validate_rows(df, imp.column_mapping, imp.category, db, subject_id)
    imp.status = "validated" if not errors else "validation_failed"
    imp.errors_json = errors
    db.commit()
    return {
        "import_id": imp.id,
        "valid": len(errors) == 0,
        "error_count": len(errors),
        "errors": errors[:50],  # cap at 50 for response
    }


@router.post("/{import_id}/import")
def run_import(
    import_id: int,
    subject_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("owner", "faculty")),
):
    imp, df = _load_import(import_id, current_user, db)

    if imp.status not in ("validated", "mapping_confirmed", "validation_failed"):
        raise HTTPException(400, "Run /validate before importing")

    imported, skipped, errors = _do_import(df, imp, db, current_user, subject_id)
    imp.rows_imported = imported
    imp.rows_skipped = skipped
    imp.status = "imported"
    imp.errors_json = errors
    db.commit()

    log_audit(db, current_user.id, "csv_imported", "csv_import", imp.id,
              {"category": imp.category, "imported": imported, "skipped": skipped})

    return {
        "import_id": imp.id,
        "rows_imported": imported,
        "rows_skipped": skipped,
        "errors": errors[:50],
    }


@router.get("", response_model=List[schemas.CsvImportOut])
def list_imports(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("owner", "faculty")),
):
    q = db.query(models.CsvImport)
    if current_user.role != "owner":
        q = q.filter(models.CsvImport.uploaded_by == current_user.id)
    return q.order_by(models.CsvImport.created_at.desc()).all()


@router.get("/templates/{category}")
def download_template(category: str, _=Depends(get_current_user)):
    from fastapi.responses import StreamingResponse
    if category not in ALLOWED_CATEGORIES:
        raise HTTPException(400, "Invalid category")
    headers_map = {
        "questions": ["question_text", "unit_code", "co_code", "blooms_code", "question_type", "difficulty", "default_marks", "tags"],
        "units": ["unit_code", "unit_name", "weight_percent", "description"],
        "co": ["co_code", "description", "po_mapping"],
        "blooms": ["level_code", "level_name", "category", "order_num"],
        "exam_config": ["exam_type", "name", "total_marks", "duration_minutes", "section_name", "marks_per_question", "questions_required", "allow_choice"],
        "sample_papers": ["question_text", "unit_code", "co_code", "blooms_code", "marks"],
    }
    cols = headers_map.get(category, [])
    buf = io.StringIO()
    buf.write(",".join(cols) + "\n")
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=template_{category}.csv"},
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _suggest_mapping(columns: list, category: str) -> dict:
    """Simple fuzzy column mapping suggestion."""
    known = {
        "question_text": ["question", "text", "question_text", "q_text", "question text"],
        "unit_code": ["unit", "unit_code", "unitcode", "unit code"],
        "unit_name": ["unit_name", "unitname", "name"],
        "co_code": ["co", "co_code", "course_outcome", "outcome"],
        "blooms_code": ["blooms", "bloom", "blooms_code", "level", "taxonomy"],
        "question_type": ["type", "q_type", "question_type"],
        "difficulty": ["difficulty", "level", "hardness"],
        "default_marks": ["marks", "mark", "score", "default_marks", "points"],
        "description": ["description", "desc", "detail"],
        "po_mapping": ["po", "po_mapping", "program_outcome"],
        "level_code": ["level_code", "code"],
        "level_name": ["level_name", "blooms_level"],
        "category": ["category", "type"],
        "order_num": ["order", "order_num", "seq"],
        "weight_percent": ["weight", "percent", "weight_percent", "%"],
        "exam_type": ["exam_type", "type", "exam"],
        "name": ["name", "config_name"],
        "total_marks": ["total_marks", "total", "marks"],
        "duration_minutes": ["duration", "minutes", "duration_minutes"],
    }
    mapping = {}
    for col in columns:
        col_lower = col.lower().strip()
        for system_field, aliases in known.items():
            if col_lower in aliases or col_lower == system_field:
                mapping[col] = system_field
                break
    return mapping


def _load_import(import_id: int, current_user, db: Session):
    imp = db.query(models.CsvImport).filter(models.CsvImport.id == import_id).first()
    if not imp:
        raise HTTPException(404, "Import record not found")
    if imp.uploaded_by != current_user.id and current_user.role != "owner":
        raise HTTPException(403, "Access denied")
    filepath = os.path.join(settings.UPLOAD_DIR, imp.stored_filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "Uploaded file not found on server")
    df = pd.read_csv(filepath)
    return imp, df


def _validate_rows(df: pd.DataFrame, mapping: dict, category: str, db: Session, subject_id: Optional[int]) -> list:
    errors = []
    required = REQUIRED_FIELDS.get(category, [])
    # Check required mapped fields exist
    mapped_to_sys = {v: k for k, v in (mapping or {}).items()}  # system_field -> csv_col
    for sys_field in required:
        if sys_field not in mapped_to_sys:
            errors.append({"row": 0, "field": sys_field, "error": f"Required field '{sys_field}' not mapped"})

    if errors:
        return errors

    for idx, row in df.iterrows():
        row_num = idx + 2  # 1-based + header
        for sys_field in required:
            csv_col = mapped_to_sys[sys_field]
            val = row.get(csv_col)
            if pd.isna(val) or str(val).strip() == "":
                errors.append({"row": row_num, "field": sys_field, "error": f"'{sys_field}' is required"})

        if category == "questions":
            marks_col = mapped_to_sys.get("default_marks")
            if marks_col:
                try:
                    val = float(row.get(marks_col, 0))
                    if val <= 0:
                        errors.append({"row": row_num, "field": "default_marks", "error": "Marks must be positive"})
                except (ValueError, TypeError):
                    errors.append({"row": row_num, "field": "default_marks", "error": "Marks must be a number"})

    return errors


def _do_import(df: pd.DataFrame, imp: models.CsvImport, db: Session, current_user, subject_id: Optional[int]) -> tuple:
    mapping = imp.column_mapping or {}
    mapped_to_sys = {v: k for k, v in mapping.items()}
    imported = 0
    skipped = 0
    errors = []

    def get_val(row, sys_field, default=None):
        col = mapped_to_sys.get(sys_field)
        if not col:
            return default
        val = row.get(col)
        if pd.isna(val):
            return default
        return val

    if imp.category == "questions":
        for idx, row in df.iterrows():
            row_num = idx + 2
            try:
                q_text = str(get_val(row, "question_text", "")).strip()
                if not q_text:
                    skipped += 1
                    continue

                # Resolve FKs
                unit_id = None
                unit_code = str(get_val(row, "unit_code", "") or "").strip()
                if unit_code and subject_id:
                    unit = db.query(models.SyllabusUnit).filter(
                        models.SyllabusUnit.subject_id == subject_id,
                        models.SyllabusUnit.unit_code == unit_code,
                    ).first()
                    if unit:
                        unit_id = unit.id

                co_id = None
                co_code = str(get_val(row, "co_code", "") or "").strip()
                if co_code and subject_id:
                    co = db.query(models.CourseOutcome).filter(
                        models.CourseOutcome.subject_id == subject_id,
                        models.CourseOutcome.co_code == co_code,
                    ).first()
                    if co:
                        co_id = co.id

                blooms_id = None
                blooms_code = str(get_val(row, "blooms_code", "") or "").strip()
                if blooms_code:
                    bl = db.query(models.BloomsLevel).filter(
                        models.BloomsLevel.level_code == blooms_code
                    ).first()
                    if bl:
                        blooms_id = bl.id

                q = models.Question(
                    subject_id=subject_id,
                    unit_id=unit_id,
                    co_id=co_id,
                    blooms_id=blooms_id,
                    question_text=q_text,
                    question_type=str(get_val(row, "question_type", "short")),
                    difficulty=str(get_val(row, "difficulty", "medium")),
                    default_marks=float(get_val(row, "default_marks", 1.0)),
                    created_by=current_user.id,
                    import_batch_id=imp.id,
                )
                db.add(q)
                db.flush()

                tags_raw = str(get_val(row, "tags", "") or "")
                for tag in [t.strip() for t in tags_raw.split(",") if t.strip()]:
                    db.add(models.QuestionTag(question_id=q.id, tag=tag))

                imported += 1
            except Exception as e:
                errors.append({"row": row_num, "error": str(e)})
                skipped += 1

        db.commit()

    elif imp.category == "units":
        for idx, row in df.iterrows():
            row_num = idx + 2
            try:
                unit_code = str(get_val(row, "unit_code", "")).strip()
                unit_name = str(get_val(row, "unit_name", "")).strip()
                if not unit_code or not unit_name or not subject_id:
                    skipped += 1
                    continue
                existing = db.query(models.SyllabusUnit).filter(
                    models.SyllabusUnit.subject_id == subject_id,
                    models.SyllabusUnit.unit_code == unit_code,
                ).first()
                if existing:
                    skipped += 1
                    continue
                u = models.SyllabusUnit(
                    subject_id=subject_id,
                    unit_code=unit_code,
                    unit_name=unit_name,
                    weight_percent=float(get_val(row, "weight_percent", 0.0) or 0.0),
                    description=str(get_val(row, "description", "") or ""),
                )
                db.add(u)
                imported += 1
            except Exception as e:
                errors.append({"row": row_num, "error": str(e)})
                skipped += 1
        db.commit()

    elif imp.category == "co":
        for idx, row in df.iterrows():
            row_num = idx + 2
            try:
                co_code = str(get_val(row, "co_code", "")).strip()
                desc = str(get_val(row, "description", "")).strip()
                if not co_code or not desc or not subject_id:
                    skipped += 1
                    continue
                existing = db.query(models.CourseOutcome).filter(
                    models.CourseOutcome.subject_id == subject_id,
                    models.CourseOutcome.co_code == co_code,
                ).first()
                if existing:
                    skipped += 1
                    continue
                co = models.CourseOutcome(
                    subject_id=subject_id,
                    co_code=co_code,
                    description=desc,
                    po_mapping=str(get_val(row, "po_mapping", "") or ""),
                )
                db.add(co)
                imported += 1
            except Exception as e:
                errors.append({"row": row_num, "error": str(e)})
                skipped += 1
        db.commit()

    return imported, skipped, errors
