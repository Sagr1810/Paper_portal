from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Literal
from pydantic import BaseModel, Field
import io
import csv
import pandas as pd
from app.database import get_db
from app import models, schemas
from app.auth import hash_password
from app.dependencies import get_current_user, get_owner
from app.audit import log_audit

router = APIRouter(prefix="/api/users", tags=["users"])


COLLEGE_ONLY_ROLES = {"principal", "exam_cell"}      # college, no department
COLLEGE_DEPT_ROLES = {"hod", "faculty"}              # college + department


def resolve_scope(db: Session, role: str, college_id, department_id):
    """
    Enforce the college / department rules for a role and return the
    (college_id, department_id) pair to store.

      owner      -> no requirement
      principal  -> college only (department is cleared)
      exam_cell  -> college only (department is cleared)
      hod        -> college + department of that college
      faculty    -> college + department of that college
    """
    if role == "owner":
        return college_id, department_id

    if not college_id:
        raise HTTPException(422, f"A college is required for role '{role}'")
    college = db.query(models.College).filter(
        models.College.id == college_id, models.College.is_active == True
    ).first()
    if not college:
        raise HTTPException(404, "College not found")

    if role in COLLEGE_ONLY_ROLES:
        return college.id, None

    # hod / faculty
    if not department_id:
        raise HTTPException(422, f"A department is required for role '{role}'")
    dept = db.query(models.Department).filter(
        models.Department.id == department_id, models.Department.is_active == True
    ).first()
    if not dept:
        raise HTTPException(404, "Department not found")
    if dept.college_id != college.id:
        raise HTTPException(422, f"Department '{dept.name}' does not belong to college '{college.name}'")
    return college.id, dept.id


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
    college_id, department_id = resolve_scope(db, body.role, body.college_id, body.department_id)
    user = models.User(
        email=body.email,
        name=body.name,
        hashed_password=hash_password(body.password),
        role=body.role,
        college_id=college_id,
        department_id=department_id,
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
    fields = body.model_fields_set
    if {"role", "college_id", "department_id"} & fields:
        new_role = body.role if body.role is not None else user.role
        new_college = body.college_id if "college_id" in fields else user.college_id
        new_dept = body.department_id if "department_id" in fields else user.department_id
        user.college_id, user.department_id = resolve_scope(db, new_role, new_college, new_dept)
        user.role = new_role
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
# Permanent delete + bulk actions (owner only)
#
# A user can only be deleted for good if they own no records we must keep
# (papers, questions, exam templates, CSV imports, workflow actions).
# Otherwise they are "blocked" and should be deactivated instead, which keeps
# all of their history.
# ---------------------------------------------------------------------------

def _delete_blockers(db: Session, user: models.User) -> list:
    checks = [
        ("paper", models.ExamPaper, models.ExamPaper.created_by),
        ("question", models.Question, models.Question.created_by),
        ("exam template", models.ExamConfiguration, models.ExamConfiguration.created_by),
        ("CSV import", models.CsvImport, models.CsvImport.uploaded_by),
        ("workflow action", models.WorkflowHistory, models.WorkflowHistory.actor_id),
    ]
    reasons = []
    for label, model, col in checks:
        n = db.query(model).filter(col == user.id).count()
        if n:
            reasons.append(f"{n} {label}{'s' if n != 1 else ''}")
    return reasons


def _hard_delete_user(db: Session, user: models.User, actor: models.User) -> None:
    detail = {
        "email": user.email,
        "name": user.name,
        "role": str(user.role),
        "college_id": user.college_id,
        "department_id": user.department_id,
    }
    uid = user.id
    # keep audit rows, just detach them from the deleted account
    db.query(models.AuditLog).filter(models.AuditLog.user_id == uid).update({"user_id": None})
    db.query(models.RefreshToken).filter(models.RefreshToken.user_id == uid).delete()
    db.delete(user)
    db.commit()
    log_audit(db, actor.id, "user_deleted", "user", uid, detail)


@router.delete("/{user_id}/permanent", status_code=204)
def delete_user_permanently(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_owner),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't delete your own account")
    if user.role == "owner":
        raise HTTPException(status_code=400, detail="Owner accounts can't be deleted here")
    reasons = _delete_blockers(db, user)
    if reasons:
        raise HTTPException(
            status_code=409,
            detail=f"{user.name} can't be deleted because they have {', '.join(reasons)}. "
                   "Deactivate the account instead to keep that history.",
        )
    _hard_delete_user(db, user, current_user)


# ---------------------------------------------------------------------------
# "Delete with data": remove a user AND the papers they created (owner only)
#
#  * the user's papers go, together with their sections, questions, analysis and history
#  * what the user did on OTHER people's papers stays (comments, status changes) but loses the name
#  * questions, exam templates and CSV imports are never removed automatically, because other
#    people's papers may be built on them. A user who owns any of those is blocked.
# ---------------------------------------------------------------------------

def _footprint(db: Session, user: models.User) -> dict:
    papers = db.query(models.ExamPaper).filter(models.ExamPaper.created_by == user.id).all()
    by_status: dict = {}
    for p in papers:
        by_status[p.status] = by_status.get(p.status, 0) + 1
    history_kept = (
        db.query(models.WorkflowHistory)
        .join(models.ExamPaper, models.WorkflowHistory.paper_id == models.ExamPaper.id)
        .filter(models.WorkflowHistory.actor_id == user.id, models.ExamPaper.created_by != user.id)
        .count()
    )
    blockers = []
    for label, model, col in (
        ("question", models.Question, models.Question.created_by),
        ("exam template", models.ExamConfiguration, models.ExamConfiguration.created_by),
        ("CSV import", models.CsvImport, models.CsvImport.uploaded_by),
    ):
        n = db.query(model).filter(col == user.id).count()
        if n:
            blockers.append(f"{n} {label}{'s' if n != 1 else ''}")
    return {
        "user_id": user.id, "name": user.name, "email": user.email, "role": str(user.role),
        "papers": len(papers), "papers_by_status": by_status, "history_kept": history_kept,
        "blockers": blockers, "can_purge": not blockers,
    }


def _purge_user(db: Session, user: models.User, actor: models.User) -> dict:
    info = _footprint(db, user)
    uid = user.id
    for paper in db.query(models.ExamPaper).filter(models.ExamPaper.created_by == uid).all():
        db.delete(paper)                                  # sections, questions, analysis, history go with it
    db.flush()
    db.query(models.WorkflowHistory).filter(models.WorkflowHistory.actor_id == uid).update({"actor_id": None})
    db.query(models.AuditLog).filter(models.AuditLog.user_id == uid).update({"user_id": None})
    db.query(models.RefreshToken).filter(models.RefreshToken.user_id == uid).delete()
    db.delete(user)
    db.commit()
    log_audit(db, actor.id, "user_purged", "user", uid, {
        "email": info["email"], "name": info["name"], "role": info["role"],
        "papers_deleted": info["papers"], "papers_by_status": info["papers_by_status"],
        "history_kept": info["history_kept"],
    })
    return info


@router.get("/{user_id}/footprint")
def user_footprint(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_owner),
):
    """What would be lost if this user were deleted together with their data."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id or user.role == "owner":
        raise HTTPException(status_code=400, detail="Owner accounts can't be deleted here")
    return _footprint(db, user)


@router.delete("/{user_id}/purge")
def purge_user(
    user_id: int,
    confirm: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_owner),
):
    if not confirm:
        raise HTTPException(status_code=400, detail="Confirmation required (confirm=true)")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id or user.role == "owner":
        raise HTTPException(status_code=400, detail="Owner accounts can't be deleted here")
    info = _footprint(db, user)
    if info["blockers"]:
        raise HTTPException(
            status_code=409,
            detail=f"{user.name} has {', '.join(info['blockers'])} that other papers may use. Remove or reassign them first.",
        )
    _purge_user(db, user, current_user)
    return {"papers_deleted": info["papers"], "history_kept": info["history_kept"]}


class BulkUserAction(BaseModel):
    action: Literal["delete", "purge", "deactivate", "activate"]
    user_ids: List[int] = Field(min_length=1, max_length=500)
    confirm: bool = False                       # required for "purge"


@router.post("/bulk/action")
def bulk_user_action(
    body: BulkUserAction,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_owner),
):
    """Delete, deactivate or activate several users at once. Returns one result per user."""
    if body.action == "purge":
        if not body.confirm:
            raise HTTPException(status_code=400, detail="Confirmation required (confirm=true)")
        if len(set(body.user_ids)) > 50:
            raise HTTPException(status_code=422, detail="Delete at most 50 users with their data at a time")
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(body.user_ids)).all()}
    results = []

    for uid in dict.fromkeys(body.user_ids):          # de-duplicate, keep order
        u = users.get(uid)
        if u is None:
            results.append({"id": uid, "email": None, "name": None, "status": "skipped", "message": "User not found"})
            continue
        email, name = u.email, u.name

        def add(status, message=""):
            results.append({"id": uid, "email": email, "name": name, "status": status, "message": message})

        if u.id == current_user.id or u.role == "owner":
            add("skipped", "Owner accounts are protected")
            continue
        try:
            if body.action == "purge":
                info = _footprint(db, u)
                if info["blockers"]:
                    add("blocked", f"has {', '.join(info['blockers'])} that other papers may use. Remove or reassign them first")
                else:
                    _purge_user(db, u, current_user)
                    add("purged", f"{info['papers']} paper{'s' if info['papers'] != 1 else ''} deleted")
            elif body.action == "delete":
                reasons = _delete_blockers(db, u)
                if reasons:
                    add("blocked", f"has {', '.join(reasons)}. Deactivate instead to keep that history")
                else:
                    _hard_delete_user(db, u, current_user)
                    add("deleted")
            elif body.action == "deactivate":
                if not u.is_active:
                    add("skipped", "Already inactive")
                else:
                    u.is_active = False
                    db.commit()
                    add("deactivated")
            else:  # activate
                if u.is_active:
                    add("skipped", "Already active")
                else:
                    u.is_active = True
                    db.commit()
                    add("activated")
        except Exception:
            db.rollback()
            add("error", "Could not update this user")

    summary: dict = {}
    for r in results:
        summary[r["status"]] = summary.get(r["status"], 0) + 1
    log_audit(db, current_user.id, f"bulk_user_{body.action}", "user", None,
              {"summary": summary, "user_ids": list(dict.fromkeys(body.user_ids))})
    return {"results": results, "summary": summary}


# ---------------------------------------------------------------------------
# Bulk CSV upload
# ---------------------------------------------------------------------------

@router.get("/bulk/template")
def download_user_template(_=Depends(get_owner)):
    """Download a CSV template for bulk user upload."""
    headers = ["name", "email", "password", "role", "college_name", "department_name"]
    sample_rows = [
        ["Alice Johnson",  "alice@college.edu",   "Alice@1234",   "faculty",   "Demo College", "Computer Science"],
        ["Bob Smith",      "bob@college.edu",      "Bob@1234",     "hod",       "Demo College", "Information Technology"],
        ["Carol White",    "carol@college.edu",    "Carol@1234",   "principal", "Demo College", ""],
        ["David Brown",    "david@college.edu",    "David@1234",   "exam_cell", "Demo College", ""],
        ["Eve Davis",      "eve@college.edu",      "Eve@1234",     "faculty",   "Demo College", "MCA"],
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
    Required columns: name, email, password, role, college_name
    department_name is required for hod and faculty, ignored for principal / exam_cell
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

    required = {"name", "email", "password", "role", "college_name"}
    missing_cols = required - set(df.columns)
    if missing_cols:
        raise HTTPException(400, f"Missing required columns: {', '.join(sorted(missing_cols))}")

    # Pre-load colleges and departments for fast lookup
    college_map: dict[str, int] = {
        c.name.strip().lower(): c.id
        for c in db.query(models.College).filter(models.College.is_active == True).all()
    }
    dept_map: dict[tuple, int] = {
        (d.college_id, d.name.strip().lower()): d.id
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
        raw_college = row.get("college_name", "")
        college_name = "" if (raw_college is None or str(raw_college).strip().lower() in ("", "nan", "none")) else str(raw_college).strip()
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

        # --- College / department lookup ---
        college_id = None
        department_id = None
        if role != "owner":
            if not college_name:
                results.append({"row": row_num, "email": email, "status": "error",
                                "message": f"college_name is required for role '{role}'"})
                errors += 1
                continue
            college_id = college_map.get(college_name.lower())
            if college_id is None:
                results.append({"row": row_num, "email": email, "status": "error",
                                "message": f"College '{college_name}' not found. Create it first."})
                errors += 1
                continue
            if role in COLLEGE_DEPT_ROLES:
                if not dept_name:
                    results.append({"row": row_num, "email": email, "status": "error",
                                    "message": f"department_name is required for role '{role}'"})
                    errors += 1
                    continue
                department_id = dept_map.get((college_id, dept_name.lower()))
                if department_id is None:
                    results.append({"row": row_num, "email": email, "status": "error",
                                    "message": f"Department '{dept_name}' not found in college '{college_name}'."})
                    errors += 1
                    continue

        # --- Create user ---
        try:
            user = models.User(
                email=email,
                name=name,
                hashed_password=hash_password(password),
                role=role,
                college_id=college_id,
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
