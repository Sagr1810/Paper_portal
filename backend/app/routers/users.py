from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List
import io
import csv
import pandas as pd
from app.database import get_db
from app import models, schemas
from app.auth import hash_password
from app.dependencies import get_current_user, get_owner
from app.audit import log_audit

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=schemas.UserOut)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user


@router.get("", response_model=List[schemas.UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_owner),
):
    return db.query(models.User).all()


@router.post("", response_model=schemas.UserOut, status_code=201)
def create_user(
    body: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_owner),
):
    existing = db.query(models.User).filter(models.User.email == body.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = models.User(
        email=body.email,
        name=body.name,
        hashed_password=hash_password(body.password),
        role=body.role,
        department_id=body.department_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    body: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_owner),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.name is not None:
        user.name = body.name
    if body.role is not None:
        user.role = body.role
    if body.department_id is not None:
        user.department_id = body.department_id
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password is not None:
        user.hashed_password = hash_password(body.password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=204)
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_owner),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
    user.is_active = False
    db.commit()


# ---------------------------------------------------------------------------
# Bulk CSV upload
# ---------------------------------------------------------------------------

@router.get("/bulk/template")
def download_user_template(_=Depends(get_owner)):
    """Download a CSV template for bulk user upload."""
    headers = ["name", "email", "password", "role", "department_name"]
    sample_rows = [
        ["Alice Johnson",  "alice@college.edu",   "Alice@1234",   "faculty",   "Computer Science"],
        ["Bob Smith",      "bob@college.edu",      "Bob@1234",     "hod",       "Information Technology"],
        ["Carol White",    "carol@college.edu",    "Carol@1234",   "principal", ""],
        ["David Brown",    "david@college.edu",    "David@1234",   "exam_cell", "Computer Science"],
        ["Eve Davis",      "eve@college.edu",      "Eve@1234",     "faculty",   "MCA"],
    ]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(sample_rows)
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=users_template.csv"},
    )


@router.post("/bulk/upload")
async def bulk_upload_users(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_owner),
):
    """
    Bulk-create users from a CSV file.
    Required columns: name, email, password, role
    Optional columns: department_name
    Returns a summary with per-row results (created / skipped / error).
    """
    VALID_ROLES = {"owner", "principal", "hod", "faculty", "exam_cell"}

    content = await file.read()
    if not content:
        raise HTTPException(400, "Uploaded file is empty")

    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Cannot parse CSV: {e}")

    # Normalise column names: strip whitespace, lowercase
    df.columns = [c.strip().lower() for c in df.columns]

    required = {"name", "email", "password", "role"}
    missing_cols = required - set(df.columns)
    if missing_cols:
        raise HTTPException(400, f"Missing required columns: {', '.join(sorted(missing_cols))}")

    # Pre-load departments for fast lookup
    dept_map: dict[str, int] = {
        d.name.strip().lower(): d.id
        for d in db.query(models.Department).filter(models.Department.is_active == True).all()
    }

    results = []
    created = skipped = errors = 0

    for idx, row in df.iterrows():
        row_num = idx + 2  # 1-based + header row

        name     = str(row.get("name", "")).strip()
        email    = str(row.get("email", "")).strip().lower()
        password = str(row.get("password", "")).strip()
        role     = str(row.get("role", "")).strip().lower()
        raw_dept = row.get("department_name", "")
        dept_name = "" if (raw_dept is None or str(raw_dept).strip().lower() in ("", "nan", "none")) else str(raw_dept).strip()

        # --- Validate ---
        if not name or not email or not password or not role:
            results.append({"row": row_num, "email": email, "status": "error",
                            "message": "name, email, password, role are all required"})
            errors += 1
            continue

        if role not in VALID_ROLES:
            results.append({"row": row_num, "email": email, "status": "error",
                            "message": f"Invalid role '{role}'. Must be one of: {', '.join(sorted(VALID_ROLES))}"})
            errors += 1
            continue

        if len(password) < 8:
            results.append({"row": row_num, "email": email, "status": "error",
                            "message": "Password must be at least 8 characters"})
            errors += 1
            continue

        # --- Duplicate check ---
        if db.query(models.User).filter(models.User.email == email).first():
            results.append({"row": row_num, "email": email, "status": "skipped",
                            "message": "Email already registered"})
            skipped += 1
            continue

        # --- Department lookup (optional) ---
        department_id = None
        if dept_name:
            department_id = dept_map.get(dept_name.lower())
            if department_id is None:
                results.append({"row": row_num, "email": email, "status": "error",
                                "message": f"Department '{dept_name}' not found. Leave blank or use exact name."})
                errors += 1
                continue

        # --- Create user ---
        try:
            user = models.User(
                email=email,
                name=name,
                hashed_password=hash_password(password),
                role=role,
                department_id=department_id,
            )
            db.add(user)
            db.flush()
            results.append({"row": row_num, "email": email, "status": "created",
                            "message": f"Created with role={role}"})
            created += 1
        except Exception as e:
            db.rollback()
            results.append({"row": row_num, "email": email, "status": "error",
                            "message": str(e)})
            errors += 1
            continue

    db.commit()
    log_audit(db, current_user.id, "bulk_user_upload", "user", None,
              {"created": created, "skipped": skipped, "errors": errors,
               "filename": file.filename})

    return {
        "total_rows": len(df),
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "results": results,
    }
