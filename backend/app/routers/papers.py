"""
Paper creation, generation, retrieval, and workflow transitions.
"""
import io
import os
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from app.database import get_db
from app import models, schemas
from app.dependencies import get_current_user, require_roles
from app.generation_engine import GenerationConfig, generate_paper
from app.calculation_engine import QuestionEntry, calculate_distributions
from app.audit import log_audit
from app.paper_scope import scope_papers

router = APIRouter(prefix="/api/papers", tags=["papers"])

# ---------------------------------------------------------------------------
# Valid workflow transitions per role
# ---------------------------------------------------------------------------
TRANSITIONS = {
    # (current_status, action) -> (new_status, allowed_roles)
    ("draft", "submit"):                        ("submitted",          ["faculty"]),
    ("draft", "submit_to_exam"):                ("exam_cell_review",   ["faculty"]),  # direct to exam cell
    ("submitted", "hod_review"):                ("hod_review",         ["hod"]),
    ("hod_review", "hod_approve"):              ("hod_approved",       ["hod"]),
    ("hod_review", "hod_return"):               ("hod_returned",       ["hod"]),
    ("hod_returned", "submit"):                 ("submitted",          ["faculty"]),
    ("hod_returned", "submit_to_exam"):         ("exam_cell_review",   ["faculty"]),  # direct to exam cell after return
    ("hod_approved", "principal_review"):       ("principal_review",   ["principal"]),
    ("principal_review", "principal_approve"):  ("principal_approved", ["principal"]),
    ("principal_review", "principal_return"):   ("principal_returned", ["principal"]),
    ("principal_returned", "submit"):           ("submitted",          ["faculty"]),
    ("principal_returned", "submit_to_exam"):   ("exam_cell_review",   ["faculty"]),  # direct to exam cell after return
    ("principal_approved", "exam_cell_review"): ("exam_cell_review",   ["exam_cell"]),
    ("exam_cell_review", "finalize"):           ("finalized",          ["exam_cell"]),
    ("exam_cell_review", "return_paper"):       ("hod_review",         ["exam_cell"]),
}


def _get_paper_or_404(paper_id: int, db: Session) -> models.ExamPaper:
    paper = (
        db.query(models.ExamPaper)
        .options(
            joinedload(models.ExamPaper.configuration),
            joinedload(models.ExamPaper.sections).joinedload(
                models.PaperSection.questions
            ).joinedload(models.PaperQuestion.slot_co),
            joinedload(models.ExamPaper.sections).joinedload(
                models.PaperSection.questions
            ).joinedload(models.PaperQuestion.slot_blooms),
            joinedload(models.ExamPaper.sections).joinedload(
                models.PaperSection.questions
            ).joinedload(models.PaperQuestion.question),
            joinedload(models.ExamPaper.analysis),
            joinedload(models.ExamPaper.workflow_history),
        )
        .filter(models.ExamPaper.id == paper_id)
        .first()
    )
    if not paper:
        raise HTTPException(404, "Paper not found")
    return paper


# ---------------------------------------------------------------------------
# List papers
# ---------------------------------------------------------------------------

@router.get("", response_model=List[schemas.PaperOut])
def list_papers(
    status: Optional[str] = None,
    subject_id: Optional[int] = None,
    exam_type: Optional[str] = None,
    department_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.ExamPaper).options(
        joinedload(models.ExamPaper.configuration),
    )
    q = scope_papers(q, current_user, department_id)
    if q is None:
        return []

    if status:
        q = q.filter(models.ExamPaper.status == status)
    if subject_id:
        q = q.filter(models.ExamPaper.subject_id == subject_id)
    if exam_type:
        q = q.filter(models.ExamPaper.exam_type == exam_type)

    return q.order_by(models.ExamPaper.created_at.desc()).all()


# ---------------------------------------------------------------------------
# Paper directory: one lightweight row per paper for the dashboards
# (faculty, subject code, status, latest exam cell comment).
# Registered before any /{paper_id} route.
# ---------------------------------------------------------------------------

@router.get("/directory", response_model=List[schemas.PaperDirectoryRow])
def paper_directory(
    status: Optional[str] = None,
    department_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.ExamPaper).options(
        joinedload(models.ExamPaper.created_by_user),
        joinedload(models.ExamPaper.subject).joinedload(models.Subject.department),
    )
    q = scope_papers(q, current_user, department_id)
    if q is None:
        return []
    if status:
        q = q.filter(models.ExamPaper.status == status)
    papers = q.order_by(models.ExamPaper.created_at.desc()).all()

    # Comments written by the exam cell, oldest -> newest
    notes: dict = {}
    ids = [p.id for p in papers]
    if ids:
        rows = (
            db.query(models.WorkflowHistory, models.User)
            .join(models.User, models.WorkflowHistory.actor_id == models.User.id)
            .filter(
                models.WorkflowHistory.paper_id.in_(ids),
                models.WorkflowHistory.comments.isnot(None),
                models.WorkflowHistory.comments != "",
                models.User.role == "exam_cell",
            )
            .order_by(models.WorkflowHistory.created_at.asc(), models.WorkflowHistory.id.asc())
            .all()
        )
        for h, u in rows:
            notes.setdefault(h.paper_id, []).append((h, u))

    out = []
    for p in papers:
        subj = p.subject
        dept = subj.department if subj else None
        hist = notes.get(p.id, [])
        last = hist[-1] if hist else None
        out.append(schemas.PaperDirectoryRow(
            id=p.id,
            title=p.title,
            status=p.status,
            exam_type=str(p.exam_type) if p.exam_type is not None else None,
            academic_year=p.academic_year,
            created_at=p.created_at,
            faculty_id=p.created_by,
            faculty_name=p.created_by_user.name if p.created_by_user else None,
            subject_id=p.subject_id,
            subject_code=subj.subject_code if subj else None,
            program=getattr(subj, 'program', None) if subj else None,
            semester=subj.semester if subj else None,
            subject_name=subj.subject_name if subj else None,
            department_id=dept.id if dept else None,
            department_name=dept.name if dept else None,
            latest_comment=last[0].comments if last else None,
            latest_comment_by=last[1].name if last else None,
            latest_comment_at=last[0].created_at if last else None,
            comment_count=len(hist),
        ))
    return out


# ---------------------------------------------------------------------------
# Get single paper
# ---------------------------------------------------------------------------
# Slot-template CSV files — list and download
# These MUST be registered before any /{paper_id} route so FastAPI doesn't
# try to coerce "slot-templates" to int and return 422.
# ---------------------------------------------------------------------------

@router.get("/slot-templates")
def list_slot_templates(_=Depends(get_current_user)):
    """Return metadata for the mark-scheme CSV templates."""
    return _SLOT_TEMPLATES


@router.get("/slot-templates/{template_id}/download")
def download_slot_template(template_id: str, _=Depends(get_current_user)):
    """Download one of the mark-scheme CSV template files."""
    tpl = next((t for t in _SLOT_TEMPLATES if t["id"] == template_id), None)
    if not tpl:
        raise HTTPException(404, "Template not found")
    filepath = os.path.join(_SAMPLE_DATA_DIR, tpl["filename"])
    if not os.path.exists(filepath):
        raise HTTPException(404, "Template file not found on server")
    from fastapi.responses import FileResponse
    return FileResponse(
        filepath,
        media_type="text/csv",
        filename=tpl["filename"],
    )


# ---------------------------------------------------------------------------

@router.get("/{paper_id}", response_model=schemas.PaperOut)
def get_paper(
    paper_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)
    return paper


@router.get("/{paper_id}/analysis", response_model=schemas.PaperAnalysisOut)
def get_paper_analysis(
    paper_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)
    if not paper.analysis:
        raise HTTPException(404, "Analysis not yet computed")
    return paper.analysis


@router.get("/{paper_id}/history", response_model=List[schemas.WorkflowHistoryOut])
def get_paper_history(
    paper_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)
    return [
        schemas.WorkflowHistoryOut(
            id=h.id,
            from_status=h.from_status,
            to_status=h.to_status,
            actor_id=h.actor_id,
            comments=h.comments,
            created_at=h.created_at,
            actor_name=h.actor.name if h.actor else None,
            actor_role=h.actor.role if h.actor else None,
        )
        for h in paper.workflow_history
    ]


# ---------------------------------------------------------------------------
# Generate paper
# ---------------------------------------------------------------------------

@router.post("/generate", status_code=201)
def generate_new_paper(
    body: schemas.GeneratePaperRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("faculty", "owner")),
):
    config = GenerationConfig(
        subject_id=body.subject_id,
        exam_type=body.exam_type,
        total_marks=body.total_marks,
        sections=[s.model_dump() for s in body.sections],
        co_targets=body.co_targets,
        blooms_targets=body.blooms_targets,
        unit_targets=body.unit_targets,
        difficulty_targets=body.difficulty_targets,
        seed=body.seed,
    )
    result = generate_paper(config, db)

    # Persist paper
    paper = models.ExamPaper(
        subject_id=body.subject_id,
        exam_type=body.exam_type,
        configuration_id=body.configuration_id,
        created_by=current_user.id,
        title=body.title,
        status="draft",
        version=1,
        academic_year=body.academic_year,
        generation_params=body.model_dump(),
    )
    db.add(paper)
    db.flush()

    all_entries = []
    for sec_idx, sec in enumerate(result["sections"]):
        section = models.PaperSection(
            paper_id=paper.id,
            section_name=sec["name"],
            marks_allocated=sec["marks_allocated"],
            order_num=sec_idx + 1,
        )
        db.add(section)
        db.flush()
        for q_idx, q in enumerate(sec["questions"]):
            pq = models.PaperQuestion(
                paper_id=paper.id,
                section_id=section.id,
                question_id=q["question_id"],
                assigned_marks=q["assigned_marks"],
                question_order=q_idx + 1,
                is_optional=q["is_optional"],
                choice_group=q["choice_group"],
            )
            db.add(pq)
            all_entries.append(
                QuestionEntry(
                    question_id=q["question_id"],
                    assigned_marks=q["assigned_marks"],
                    is_optional=q["is_optional"],
                    choice_group=q["choice_group"],
                    unit_code=q["unit_code"],
                    co_code=q["co_code"],
                    blooms_code=q["blooms_code"],
                    difficulty=q["difficulty"],
                    question_type=q["question_type"],
                )
            )

    # Save analysis
    analysis_data = result["analysis"]
    analysis = models.PaperAnalysis(
        paper_id=paper.id,
        total_marks_calculated=analysis_data["total_marks"],
        co_distribution=analysis_data["co_distribution"],
        blooms_distribution=analysis_data["blooms_distribution"],
        unit_distribution=analysis_data["unit_distribution"],
        difficulty_distribution=analysis_data["difficulty_distribution"],
        validation_errors=analysis_data["validation_errors"],
    )
    db.add(analysis)

    # Workflow entry
    wf = models.WorkflowHistory(
        paper_id=paper.id,
        from_status=None,
        to_status="draft",
        actor_id=current_user.id,
        comments="Paper generated",
    )
    db.add(wf)
    db.commit()

    log_audit(db, current_user.id, "paper_generated", "exam_paper", paper.id,
              {"title": paper.title, "exam_type": paper.exam_type})

    db.refresh(paper)
    return {"paper_id": paper.id, "warnings": result["warnings"], "analysis": analysis_data}


# ---------------------------------------------------------------------------
# Workflow transition
# ---------------------------------------------------------------------------

@router.post("/{paper_id}/transition")
def transition_paper(
    paper_id: int,
    body: schemas.WorkflowActionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)

    key = (paper.status, body.action)
    transition = TRANSITIONS.get(key)
    if not transition:
        raise HTTPException(400, f"Action '{body.action}' is not valid for paper status '{paper.status}'")

    new_status, allowed_roles = transition
    if current_user.role not in allowed_roles:
        raise HTTPException(403, f"Action '{body.action}' requires role: {allowed_roles}")

    # Lock check
    if paper.status in ("finalized",):
        raise HTTPException(403, "Cannot modify a finalized paper")

    from datetime import datetime, timezone
    old_status = paper.status
    paper.status = new_status
    if new_status == "finalized":
        paper.locked_at = datetime.now(timezone.utc).replace(tzinfo=None)

    wf = models.WorkflowHistory(
        paper_id=paper.id,
        from_status=old_status,
        to_status=new_status,
        actor_id=current_user.id,
        comments=body.comments,
    )
    db.add(wf)
    db.commit()

    log_audit(db, current_user.id, f"paper_{body.action}", "exam_paper", paper.id,
              {"from": old_status, "to": new_status, "comments": body.comments})

    return {"paper_id": paper.id, "status": new_status}


# ---------------------------------------------------------------------------
# Export paper
# ---------------------------------------------------------------------------

@router.get("/{paper_id}/export/{fmt}")
def export_paper(
    paper_id: int,
    fmt: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    from app.export import export_paper_file
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)

    # Faculty can download their own paper once submitted; senior roles can always export.
    if paper.status == "draft":
        raise HTTPException(403, "Paper must be submitted before it can be downloaded")

    if fmt not in ("pdf", "docx", "xlsx"):
        raise HTTPException(400, "Supported formats: pdf, docx, xlsx")

    from fastapi.responses import FileResponse
    filepath = export_paper_file(paper, fmt, db)
    media_types = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    return FileResponse(filepath, media_type=media_types[fmt], filename=f"paper_{paper.id}.{fmt}")


# ---------------------------------------------------------------------------
# Duplicate-question check
#
# Mode A (no file):   scans the paper's own assigned question-text slots
# Mode B (with file): parses question texts from an uploaded CSV/XLSX and
#                     checks them against the subject's question bank
# ---------------------------------------------------------------------------

@router.post("/{paper_id}/check-duplicates")
async def check_duplicate_questions(
    paper_id: int,
    file: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Two modes:
    - No file  → read question texts from the paper's own slots (slot_question_text
                 or linked question bank text) and compare against the bank.
    - With file → parse a CSV or XLSX (must have a 'question_text' / 'Question Text'
                 column) and compare those texts against the bank.
    """
    import csv, io, difflib, math

    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)

    # ── Build entries list ────────────────────────────────────────────────────
    # Each entry: { slot_db_id, slot_label, section, question_text, co_code,
    #               blooms_code, is_optional }
    # For file-upload mode the slot fields are None / row-number based.
    slot_entries: list[dict] = []
    skipped_rows = 0
    import re as _re

    def _is_real_question(t):
        t = (t or "").strip()
        if len(t) < 5:
            return False
        if _re.match(r"^(exam type\s*:|academic year\s*:|subject\s*:|total marks)", t, _re.I):
            return False
        if _re.match(r"^(row\s*\d+|slot|section\s*\w*|question\s*\d+|q\s*\d+\s*(\(\w+\))?)$", t, _re.I):
            return False
        return True

    if file and file.filename:
        # ── Mode B: parse uploaded CSV or XLSX ───────────────────────────────
        raw_bytes = await file.read()
        fname = (file.filename or "").lower()

        if fname.endswith(".xlsx") or fname.endswith(".xls"):
            try:
                import openpyxl
                wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), data_only=True)
                ws = wb["Slot Assignments"] if "Slot Assignments" in wb.sheetnames else wb.active

                # Find the "Question Text" column header in the first 20 rows
                qt_col_idx = None
                header_row_idx = None
                for row in ws.iter_rows(min_row=1, max_row=20):
                    for cell in row:
                        val = str(cell.value or "").strip().lower()
                        if val in ("question text", "question_text", "question", "text"):
                            qt_col_idx = int(cell.column)
                            header_row_idx = cell.row
                            break
                    if qt_col_idx:
                        break

                if qt_col_idx is None:
                    raise HTTPException(400, "Could not find a 'Question Text' column in the uploaded XLSX")

                for row in ws.iter_rows(min_row=header_row_idx + 1):
                    cell_val = row[qt_col_idx - 1].value
                    txt = str(cell_val).strip() if cell_val is not None else ""
                    if txt and not _is_real_question(txt):
                        skipped_rows += 1
                        continue
                    if txt and txt not in ("None", "—", "-", ""):
                        slot_entries.append({
                            "slot_db_id":   None,
                            "slot_label":   f"Row {len(slot_entries)+1}",
                            "section":      "",
                            "question_text": txt,
                            "co_code":      None,
                            "blooms_code":  None,
                            "is_optional":  False,
                        })
                wb.close()
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(400, f"Could not parse XLSX file: {exc}")
        else:
            # CSV
            try:
                content = raw_bytes.decode("utf-8-sig", errors="replace")
            except Exception:
                raise HTTPException(400, "Could not read uploaded file")

            _delim = "\t" if content.count("\t") > content.count(",") else ","
            _all = list(csv.reader(io.StringIO(content), delimiter=_delim))
            _hdr_idx = next(
                (i for i, r in enumerate(_all[:30])
                 if any(str(c).strip().lower() in ("question text", "question_text", "question", "text") for c in r)),
                0,
            )
            _buf = io.StringIO()
            csv.writer(_buf).writerows(_all[_hdr_idx:])
            reader = csv.DictReader(io.StringIO(_buf.getvalue()))
            rows_raw = list(reader)
            if not rows_raw:
                raise HTTPException(400, "CSV is empty")

            first_col = reader.fieldnames[0] if reader.fieldnames else None
            def _get_text(row):
                for key in ("question_text", "Question Text", "Question", "question", "text", "Text"):
                    if key in row and str(row[key]).strip():
                        return str(row[key]).strip()
                # Only fall back to first_col if it looks like a question (not a slot label)
                if first_col and first_col.lower() not in ("slot", "slot_id", "slot_label", "#", "no", "num"):
                    v = str(row.get(first_col, "")).strip()
                    if v:
                        return v
                return ""

            for r in rows_raw:
                txt = _get_text(r)
                if txt and not _is_real_question(txt):
                    skipped_rows += 1
                    txt = ""
                if txt:
                    slot_entries.append({
                        "slot_db_id":   None,
                        "slot_label":   f"Row {len(slot_entries)+1}",
                        "section":      "",
                        "question_text": txt,
                        "co_code":      None,
                        "blooms_code":  None,
                        "is_optional":  False,
                    })

        if not slot_entries:
            raise HTTPException(400, f"No question texts found in the uploaded file ({skipped_rows} row(s) were slot labels or titles, not questions). Upload a file with a 'question_text' or 'Question Text' column that contains the question text.")

    else:
        # ── Mode A: scan paper's own slots ───────────────────────────────────
        for sec in paper.sections:
            for pq in sec.questions:
                txt = pq.question_text  # @property: slot_question_text → question bank text
                if txt and txt.strip():
                    slot_entries.append({
                        "slot_db_id":   pq.id,
                        "slot_label":   pq.slot_label or pq.slot_id or f"#{pq.id}",
                        "section":      sec.section_name,
                        "question_text": txt.strip(),
                        "co_code":      pq.co_code,
                        "blooms_code":  pq.blooms_code,
                        "is_optional":  pq.is_optional,
                    })

        if not slot_entries:
            return {
                "rows": [],
                "total_rows": 0,
                "duplicate_count": 0,
                "message": "No question texts have been assigned to this paper's slots yet.",
            }

    # ── Fetch existing question bank for this subject ─────────────────────────
    existing_qs = db.query(models.Question).filter(
        models.Question.subject_id == paper.subject_id,
        models.Question.is_active == True,
    ).all()

    existing_index = [(q.id, (q.question_text or "").lower()) for q in existing_qs]
    existing_map   = {q.id: q for q in existing_qs}

    THRESHOLD = 0.75   # 75 % similarity → flag as duplicate

    # ── Compare each entry against the question bank ──────────────────────────
    result_rows = []
    dup_count   = 0

    _seen_texts = []   # (label, text) of earlier rows in this same list
    for idx, entry in enumerate(slot_entries, start=1):
        txt_lower = entry["question_text"].lower()
        matches = []
        for _lbl, _prev in _seen_texts:
            _r = difflib.SequenceMatcher(None, txt_lower, _prev).ratio()
            if _r >= THRESHOLD:
                matches.append({
                    "question_id":   None,
                    "question_text": f"Same as {_lbl} in this list: " + _prev[:160],
                    "similarity":    round(float(_r), 3),
                    "co_code":       None,
                    "blooms_code":   None,
                })
        _seen_texts.append((entry["slot_label"], txt_lower))
        for qid, ex_lower in existing_index:
            if not ex_lower:
                continue
            ratio = difflib.SequenceMatcher(None, txt_lower, ex_lower).ratio()
            if math.isnan(ratio) or math.isinf(ratio):
                continue
            if ratio >= THRESHOLD:
                q = existing_map[qid]
                matches.append({
                    "question_id":   qid,
                    "question_text": q.question_text,
                    "similarity":    round(float(ratio), 3),
                    "co_code":       q.co.co_code if q.co else None,
                    "blooms_code":   q.blooms.level_code if q.blooms else None,
                })

        matches.sort(key=lambda m: -m["similarity"])
        if matches:
            dup_count += 1
        result_rows.append({
            "row_num":       idx,
            "slot_db_id":    entry["slot_db_id"],
            "slot_label":    entry["slot_label"],
            "section":       entry["section"],
            "question_text": entry["question_text"],
            "co_code":       entry["co_code"],
            "blooms_code":   entry["blooms_code"],
            "is_optional":   entry["is_optional"],
            "duplicates":    matches[:3],
        })

    return {
        "rows":            result_rows,
        "total_rows":      len(result_rows),
        "duplicate_count": dup_count,
        "skipped_rows":    skipped_rows,
    }


# ---------------------------------------------------------------------------
# Template — return blank question slots from an exam configuration
# ---------------------------------------------------------------------------

@router.get("/template/{config_id}")
def get_paper_template(
    config_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Return the structured question slots for an exam configuration.
    Faculty uses this to see the paper structure before assigning CO/Bloom's.
    """
    config = db.query(models.ExamConfiguration).filter(
        models.ExamConfiguration.id == config_id,
        models.ExamConfiguration.is_active == True,
    ).first()
    if not config:
        raise HTTPException(404, "Exam configuration not found")
    return {
        "config_id": config.id,
        "name": config.name,
        "exam_type": config.exam_type,
        "total_marks": config.total_marks,
        "sections_config": config.sections_config,
        "co_targets": config.co_targets or {},
        "blooms_targets": config.blooms_targets or {},
    }


# ---------------------------------------------------------------------------
# Create paper from template (slot-based, no question bank needed)
# ---------------------------------------------------------------------------

@router.post("/from-template", status_code=201)
def create_paper_from_template(
    body: schemas.CreatePaperFromTemplateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("faculty", "owner")),
):
    """
    Create a draft paper using an exam configuration as the template.
    Each slot gets a PaperQuestion row with question_id=None (placeholder).
    Faculty then assigns CO/Bloom's and questions to each slot.
    """
    config = db.query(models.ExamConfiguration).filter(
        models.ExamConfiguration.id == body.configuration_id,
        models.ExamConfiguration.is_active == True,
    ).first()
    if not config:
        raise HTTPException(404, "Exam configuration not found")

    if current_user.role == "faculty":
        subj = db.query(models.Subject).filter(models.Subject.id == body.subject_id).first()
        if not subj or not subj.department or subj.department.college_id != current_user.college_id:
            raise HTTPException(403, "You can only create papers for subjects of your own college")

    paper = models.ExamPaper(
        subject_id=body.subject_id,
        exam_type=config.exam_type,
        configuration_id=config.id,
        created_by=current_user.id,
        title=body.title,
        status="draft",
        version=1,
        academic_year=body.academic_year,
        generation_params={"source": "template", "config_id": config.id},
    )
    db.add(paper)
    db.flush()

    # ── Build sections + slots from sections_config ───────────────────────────
    # sections_config supports two formats:
    #   Format A (slot-list):  { "name": ..., "slots": [{slot_id, marks, is_or, or_group}] }
    #   Format B (count-based): { "name": ..., "marks_per_question": N, "questions_required": Q,
    #                             "allow_choice": bool, "choice_extra": int }
    global_slot_counter = 0
    for sec_idx, sec in enumerate(config.sections_config):
        marks_per_q   = float(sec.get("marks_per_question", 0))
        required      = int(sec.get("questions_required", 0))
        allow_choice  = bool(sec.get("allow_choice", False))
        choice_extra  = int(sec.get("choice_extra", 0))

        # total slots in this section = required + extra (OR options)
        total_slots = required + (choice_extra if allow_choice else 0)

        # if no slots in either format, skip
        explicit_slots = sec.get("slots", [])
        if not explicit_slots and total_slots == 0:
            continue

        # Compute section marks: only required slots count toward total
        section_marks = marks_per_q * required if marks_per_q else float(
            sum(s.get("marks", 0) for s in explicit_slots if not s.get("is_or", False))
        )

        section = models.PaperSection(
            paper_id=paper.id,
            section_name=sec.get("label") or sec.get("name", f"Section {sec_idx+1}"),
            instructions=sec.get("instructions", ""),
            marks_allocated=section_marks,
            order_num=sec_idx + 1,
        )
        db.add(section)
        db.flush()

        if explicit_slots:
            # Format A — use explicit slot list
            for slot_idx, slot in enumerate(explicit_slots):
                global_slot_counter += 1
                pq = models.PaperQuestion(
                    paper_id=paper.id,
                    section_id=section.id,
                    question_id=None,
                    assigned_marks=float(slot.get("marks", 0)),
                    question_order=slot_idx + 1,
                    is_optional=slot.get("is_or", False),
                    choice_group=slot.get("or_group"),
                    slot_label=slot.get("label", ""),
                    slot_id=slot.get("slot_id", str(global_slot_counter)),
                )
                db.add(pq)
        else:
            # Format B — generate slots from counts
            # Required slots (not optional)
            for i in range(required):
                global_slot_counter += 1
                sec_name_short = sec.get("name", f"S{sec_idx+1}")
                pq = models.PaperQuestion(
                    paper_id=paper.id,
                    section_id=section.id,
                    question_id=None,
                    assigned_marks=marks_per_q,
                    question_order=i + 1,
                    is_optional=False,
                    choice_group=None,
                    slot_label=f"{sec_name_short} Q{i+1}",
                    slot_id=f"s{sec_idx+1}_q{i+1}",
                )
                db.add(pq)

            # OR / choice extra slots — grouped together
            if allow_choice and choice_extra > 0:
                or_group = f"sec{sec_idx+1}_or"
                for i in range(choice_extra):
                    global_slot_counter += 1
                    sec_name_short = sec.get("name", f"S{sec_idx+1}")
                    pq = models.PaperQuestion(
                        paper_id=paper.id,
                        section_id=section.id,
                        question_id=None,
                        assigned_marks=marks_per_q,
                        question_order=required + i + 1,
                        is_optional=True,
                        choice_group=or_group,
                        slot_label=f"{sec_name_short} OR-{i+1}",
                        slot_id=f"s{sec_idx+1}_or{i+1}",
                    )
                    db.add(pq)

    db.flush()

    # ── Auto-assign CO & Bloom's using stored targets ────────────────────────
    # This runs immediately so the Summary Table is populated on first open.
    if config.co_targets and config.blooms_targets:
        from app.auto_assign_engine import SlotAssignment, auto_assign_co_blooms as _engine
        db.refresh(paper)
        try:
            # Resolve CO codes → IDs
            co_code_to_id = {co.co_code: co.id for co in db.query(models.CourseOutcome).filter(
                models.CourseOutcome.subject_id == paper.subject_id).all()}
            bl_code_to_id = {bl.level_code: bl.id for bl in db.query(models.BloomsLevel).all()}

            slot_objs = []
            pq_map = {}
            for sec in paper.sections:
                for pq in sec.questions:
                    sa = SlotAssignment(
                        slot_db_id=pq.id,
                        slot_id=pq.slot_id or str(pq.id),
                        marks=float(pq.assigned_marks),
                        is_or=bool(pq.is_optional),
                        or_group=pq.choice_group,
                        section_name=sec.section_name,
                    )
                    slot_objs.append(sa)
                    pq_map[pq.id] = pq

            assigned = _engine(
                slots=slot_objs,
                total_marks=float(config.total_marks),
                co_targets=config.co_targets,
                blooms_targets=config.blooms_targets,
            )
            for sa in assigned:
                pq = pq_map.get(sa.slot_db_id)
                if pq:
                    if sa.assigned_co:
                        pq.slot_co_id = co_code_to_id.get(sa.assigned_co)
                    if sa.assigned_blooms:
                        pq.slot_blooms_id = bl_code_to_id.get(sa.assigned_blooms)
            db.flush()
            analysis_data = _recalculate_paper_analysis(paper, db)
            _save_analysis(paper, analysis_data, db)
        except Exception:
            pass  # non-fatal — faculty can run it manually

    wf = models.WorkflowHistory(
        paper_id=paper.id,
        from_status=None,
        to_status="draft",
        actor_id=current_user.id,
        comments=f"Paper created from template: {config.name}",
    )
    db.add(wf)
    db.commit()

    log_audit(db, current_user.id, "paper_from_template", "exam_paper", paper.id,
              {"title": paper.title, "config_id": config.id})

    db.refresh(paper)
    return {"paper_id": paper.id, "title": paper.title, "total_marks": config.total_marks}


# ---------------------------------------------------------------------------
# Assign CO / Bloom's / question text to a paper slot
# ---------------------------------------------------------------------------

@router.put("/{paper_id}/slots/{slot_id}")
def update_paper_slot(
    paper_id: int,
    slot_id: int,
    body: schemas.SlotAssignmentRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Faculty assigns question_text, CO, Bloom's level, unit, difficulty to a slot.
    """
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)

    if paper.status not in ("draft", "hod_returned", "principal_returned"):
        raise HTTPException(403, "Paper is not editable in its current status")

    pq = db.query(models.PaperQuestion).filter(
        models.PaperQuestion.id == slot_id,
        models.PaperQuestion.paper_id == paper_id,
    ).first()
    if not pq:
        raise HTTPException(404, "Slot not found")

    # Update slot assignments
    if body.question_text is not None:
        pq.slot_question_text = body.question_text
    if body.co_id is not None:
        pq.slot_co_id = body.co_id
    if body.blooms_id is not None:
        pq.slot_blooms_id = body.blooms_id
    if body.unit_id is not None:
        pq.slot_unit_id = body.unit_id
    if body.difficulty is not None:
        pq.slot_difficulty = body.difficulty
    if body.question_id is not None:
        pq.question_id = body.question_id

    db.commit()
    return {"slot_id": slot_id, "updated": True}


# ---------------------------------------------------------------------------
# Bulk assign CO/Bloom's to all slots at once
# ---------------------------------------------------------------------------

@router.put("/{paper_id}/assign-co-blooms")
def bulk_assign_co_blooms(
    paper_id: int,
    body: schemas.BulkSlotAssignmentRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Bulk-assign CO, Bloom's, unit, difficulty, and question text to multiple slots.
    Body: { "slots": [{ "slot_id": int, "co_id": int, "blooms_id": int, ... }] }
    Returns recalculated analysis.
    """
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)

    if paper.status not in ("draft", "hod_returned", "principal_returned"):
        raise HTTPException(403, "Paper is not editable in its current status")

    # Build lookup
    pq_map = {
        pq.id: pq
        for sec in paper.sections
        for pq in sec.questions
    }

    for slot_update in body.slots:
        pq = pq_map.get(slot_update.slot_id)
        if not pq:
            continue
        if slot_update.question_text is not None:
            pq.slot_question_text = slot_update.question_text
        if slot_update.co_id is not None:
            pq.slot_co_id = slot_update.co_id
        if slot_update.blooms_id is not None:
            pq.slot_blooms_id = slot_update.blooms_id
        if slot_update.unit_id is not None:
            pq.slot_unit_id = slot_update.unit_id
        if slot_update.difficulty is not None:
            pq.slot_difficulty = slot_update.difficulty
        if slot_update.question_id is not None:
            pq.question_id = slot_update.question_id

    db.flush()

    # Recalculate analysis
    analysis_data = _recalculate_paper_analysis(paper, db)

    # Persist analysis
    _save_analysis(paper, analysis_data, db)
    db.commit()

    return {"paper_id": paper_id, "analysis": analysis_data}


# ---------------------------------------------------------------------------
# Recalculate analysis on demand
# ---------------------------------------------------------------------------

@router.post("/{paper_id}/recalculate")
def recalculate_paper(
    paper_id: int,
    body: Optional[dict] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)
    analysis_data = _recalculate_paper_analysis(paper, db)
    _save_analysis(paper, analysis_data, db)
    db.commit()

    # Remember the faculty's targets on the paper so reviewers can see the same Target columns.
    _bt = body or {}
    if (isinstance(_bt.get("co_targets"), dict) and _bt["co_targets"]
            and isinstance(_bt.get("blooms_targets"), dict) and _bt["blooms_targets"]
            and current_user.id == paper.created_by):
        _gp = dict(paper.generation_params) if isinstance(paper.generation_params, dict) else {}
        _gp["targets"] = {"co_targets": _bt["co_targets"], "blooms_targets": _bt["blooms_targets"]}
        paper.generation_params = _gp
        db.commit()

    # Build summary_table.
    # Frontend may pass live co_targets/blooms_targets in body so the Summary
    # Table reflects the user's current target sliders even if they haven't
    # run auto-assign yet.
    summary_table = None
    config = paper.configuration
    from app.auto_assign_engine import SlotAssignment, build_summary_table

    # Resolve targets: body overrides > config stored > skip
    request_co_targets = (body or {}).get("co_targets")
    request_bl_targets = (body or {}).get("blooms_targets")
    co_targets_to_use = request_co_targets or (config.co_targets if config else None)
    bl_targets_to_use = request_bl_targets or (config.blooms_targets if config else None)
    if co_targets_to_use and bl_targets_to_use:
        slot_objs = []
        for sec in paper.sections:
            for pq in sec.questions:
                co_code = None
                if pq.slot_co_id and pq.slot_co:
                    co_code = pq.slot_co.co_code
                elif pq.question_id and pq.question and pq.question.co:
                    co_code = pq.question.co.co_code
                bl_code = None
                if pq.slot_blooms_id and pq.slot_blooms:
                    bl_code = pq.slot_blooms.level_code
                elif pq.question_id and pq.question and pq.question.blooms:
                    bl_code = pq.question.blooms.level_code
                sa = SlotAssignment(
                    slot_db_id=pq.id,
                    slot_id=pq.slot_id or str(pq.id),
                    marks=float(pq.assigned_marks or 0),
                    is_or=bool(pq.is_optional),
                    or_group=pq.choice_group,
                    section_name=sec.section_name,
                )
                sa.assigned_co = co_code
                sa.assigned_blooms = bl_code
                slot_objs.append(sa)

        # Use the full paper total (config.total_marks) as the summary denominator
        # so that target marks and actual marks are always shown out of the paper total (e.g. 88m).
        paper_total = float(config.total_marks) if config else float(
            sum(s.marks_allocated for s in paper.sections)
        )
        summary_table = build_summary_table(
            slot_objs, paper_total, co_targets_to_use, bl_targets_to_use
        )

    paper_total = float(config.total_marks) if config else float(
        sum(s.marks_allocated for s in paper.sections)
    )
    if summary_table:
        summary_table["paper_total_marks"] = paper_total
        summary_table["answered_marks"] = paper_total

    return {"paper_id": paper_id, "analysis": analysis_data, "summary_table": summary_table}


# ---------------------------------------------------------------------------
# AUTO-ASSIGN: distribute CO + Bloom's to slots from target percentages
# ---------------------------------------------------------------------------

@router.post("/{paper_id}/auto-assign")
def auto_assign_co_blooms(
    paper_id: int,
    body: schemas.AutoAssignRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Given CO% targets and Bloom's% targets, auto-assign CO and Bloom's
    to every question slot using marks-weighted greedy distribution.

    Body:
    {
      "co_targets":     { "CO1": 25, "CO2": 30, "CO3": 25, "CO4": 20 },
      "blooms_targets": { "R": 15, "U": 20, "Ap": 30, "An": 20, "E": 10, "C": 5 },
      "save": true    // if false, just preview without saving
    }

    Returns:
    {
      "slots": [...],          // each slot with assigned co_code + blooms_code
      "analysis": {...},       // computed distribution
      "gaps": [...]            // list of gap messages vs targets
    }
    """
    from app.auto_assign_engine import SlotAssignment, auto_assign_co_blooms as _engine
    from app.auto_assign_engine import compute_actual_distribution, build_gap_report, build_summary_table

    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)

    if paper.status not in ("draft", "hod_returned", "principal_returned"):
        raise HTTPException(403, "Paper is not editable in its current status")

    # Resolve CO codes → DB IDs
    co_code_to_id: dict[str, int] = {}
    for co in db.query(models.CourseOutcome).filter(
        models.CourseOutcome.subject_id == paper.subject_id
    ).all():
        co_code_to_id[co.co_code] = co.id

    # Resolve Bloom's codes → DB IDs
    bl_code_to_id: dict[str, int] = {}
    for bl in db.query(models.BloomsLevel).all():
        bl_code_to_id[bl.level_code] = bl.id

    # Build SlotAssignment list from paper sections
    slot_objs: list[SlotAssignment] = []
    pq_map: dict[int, models.PaperQuestion] = {}

    for sec in paper.sections:
        for pq in sec.questions:
            sa = SlotAssignment(
                slot_db_id=pq.id,
                slot_id=pq.slot_id or str(pq.id),
                marks=float(pq.assigned_marks),
                is_or=bool(pq.is_optional),
                or_group=pq.choice_group,
                section_name=sec.section_name,
            )
            slot_objs.append(sa)
            pq_map[pq.id] = pq

    # Use mandatory (non-OR) marks as the distribution denominator.
    # config.total_marks counts BOTH sides of every OR pair (mandatory + alternatives),
    # but a student only answers one side — so the correct "student total" is the
    # sum of mandatory (non-OR) slots, which equals what the student actually scores.
    # e.g. 102-mark Bachelors: mandatory=60m, OR_alts=42m → student answers 60m.
    mandatory_marks = sum(s.marks for s in slot_objs if not s.is_or)
    if mandatory_marks <= 0:
        config = paper.configuration
        mandatory_marks = config.total_marks if config else sum(
            s.marks_allocated for s in paper.sections
        )

    # Run auto-assign engine
    assigned_slots = _engine(
        slots=slot_objs,
        total_marks=float(mandatory_marks),
        co_targets=body.co_targets,
        blooms_targets=body.blooms_targets,
    )

    # Compute actual distribution — percent denominator = mandatory marks
    actual = compute_actual_distribution(assigned_slots, float(mandatory_marks))
    gaps = build_gap_report(actual, body.co_targets, body.blooms_targets)

    # Build response slots
    response_slots = []
    for sa in assigned_slots:
        response_slots.append({
            "slot_db_id": sa.slot_db_id,
            "slot_id": sa.slot_id,
            "marks": sa.marks,
            "is_or": sa.is_or,
            "or_group": sa.or_group,
            "section": sa.section_name,
            "assigned_co": sa.assigned_co,
            "assigned_blooms": sa.assigned_blooms,
            "co_id": co_code_to_id.get(sa.assigned_co) if sa.assigned_co else None,
            "blooms_id": bl_code_to_id.get(sa.assigned_blooms) if sa.assigned_blooms else None,
        })

    # Persist to DB if requested
    if body.save:
        for sa in assigned_slots:
            pq = pq_map.get(sa.slot_db_id)
            if not pq:
                continue
            if sa.assigned_co:
                pq.slot_co_id = co_code_to_id.get(sa.assigned_co)
            if sa.assigned_blooms:
                pq.slot_blooms_id = bl_code_to_id.get(sa.assigned_blooms)

        db.flush()
        analysis_data = _recalculate_paper_analysis(paper, db)
        _save_analysis(paper, analysis_data, db)
        db.commit()

        from app.audit import log_audit
        log_audit(db, current_user.id, "auto_assign_co_blooms", "exam_paper", paper.id,
                  {"co_targets": body.co_targets, "blooms_targets": body.blooms_targets})
    else:
        def _normalise_dist(dist):
            return {k: {"marks": v["raw_marks"], "percent": v["percent"]} for k, v in dist.items()}

        analysis_data = {
            "co_distribution": _normalise_dist(actual["co_distribution"]),
            "blooms_distribution": _normalise_dist(actual["blooms_distribution"]),
            "total_marks": actual["total_marks_counted"],
            "validation_errors": gaps,
            "warnings": [],
        }

    # Build summary table using full paper total as denominator (e.g. 88m, not mandatory-only 50m)
    config = paper.configuration
    paper_total = float(config.total_marks) if config else float(mandatory_marks)
    summary = build_summary_table(
        assigned_slots,
        paper_total,
        body.co_targets,
        body.blooms_targets,
    )

    # Attach paper_total_marks to summary
    if summary:
        summary["paper_total_marks"] = paper_total
        summary["answered_marks"] = paper_total

    return {
        "paper_id": paper_id,
        "slots": response_slots,
        "analysis": analysis_data,
        "gaps": gaps,
        "saved": body.save,
        "summary_table": summary,
    }


# ---------------------------------------------------------------------------
# PREVIEW distribution for given targets (no paper needed — pure calculation)
# ---------------------------------------------------------------------------

@router.post("/preview-distribution")
def preview_distribution(
    body: schemas.PreviewDistributionRequest,
    _=Depends(get_current_user),
):
    """
    Given a list of slot marks and CO/Bloom's targets, compute and return
    the expected distribution WITHOUT touching any paper in the database.
    Used for real-time chart preview in the frontend.
    """
    from app.auto_assign_engine import SlotAssignment, auto_assign_co_blooms as _engine
    from app.auto_assign_engine import compute_actual_distribution, build_gap_report

    slots = [
        SlotAssignment(
            slot_db_id=i,
            slot_id=s.get("slot_id", str(i)),
            marks=float(s.get("marks", 0)),
            is_or=bool(s.get("is_or", False)),
            or_group=s.get("or_group"),
        )
        for i, s in enumerate(body.slots)
    ]

    total_marks = float(body.total_marks)
    assigned = _engine(slots, total_marks, body.co_targets, body.blooms_targets)
    actual = compute_actual_distribution(assigned, total_marks)
    gaps = build_gap_report(actual, body.co_targets, body.blooms_targets)

    def _normalise_dist(dist):
        return {k: {"marks": v["raw_marks"], "percent": v["percent"]} for k, v in dist.items()}

    return {
        "co_distribution": _normalise_dist(actual["co_distribution"]),
        "blooms_distribution": _normalise_dist(actual["blooms_distribution"]),
        "total_marks": total_marks,
        "gaps": gaps,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@router.get("/{paper_id}/summary")
def paper_summary_table(
    paper_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Read-only: the same summary_table the editor shows. Never writes anything."""
    from app.auto_assign_engine import SlotAssignment, build_summary_table
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)
    config = paper.configuration

    gp = paper.generation_params if isinstance(paper.generation_params, dict) else {}
    saved = gp.get("targets") or {}
    co_t = saved.get("co_targets")
    bl_t = saved.get("blooms_targets")
    source = "paper"
    if not (co_t and bl_t):
        co_t = (config.co_targets if config else None)
        bl_t = (config.blooms_targets if config else None)
        source = "template"
    if not co_t:
        cos = (db.query(models.CourseOutcome)
               .filter(models.CourseOutcome.subject_id == paper.subject_id)
               .order_by(models.CourseOutcome.co_code).all())
        if cos:
            n = len(cos)
            eq = round(100 / n)
            co_t = {c.co_code: (100 - eq * (n - 1) if i == n - 1 else eq) for i, c in enumerate(cos)}
            source = "default"
    if not bl_t:
        bl_t = {"R": 15, "U": 20, "Ap": 30, "An": 20, "E": 10, "C": 5}
        source = "default"
    if not co_t:
        return {"summary_table": None, "targets_source": None}

    # Only the COs this subject really has; rescale their targets to 100%.
    _subj_cos = [c.co_code for c in db.query(models.CourseOutcome).filter(models.CourseOutcome.subject_id == paper.subject_id)]
    if _subj_cos:
        _kept = {k: v for k, v in co_t.items() if k in _subj_cos}
        _sum = sum(float(v or 0) for v in _kept.values())
        if _kept and _sum > 0:
            co_t = {k: round(float(v or 0) / _sum * 100, 2) for k, v in _kept.items()}
        else:
            _n = len(_subj_cos)
            _eq = round(100 / _n)
            co_t = {c: (100 - _eq * (_n - 1) if i == _n - 1 else _eq) for i, c in enumerate(sorted(_subj_cos))}
            source = "default"

    slot_objs = []
    for sec in paper.sections:
        for pq in sec.questions:
            co_code = None
            if pq.slot_co_id and pq.slot_co:
                co_code = pq.slot_co.co_code
            elif pq.question_id and pq.question and pq.question.co:
                co_code = pq.question.co.co_code
            bl_code = None
            if pq.slot_blooms_id and pq.slot_blooms:
                bl_code = pq.slot_blooms.level_code
            elif pq.question_id and pq.question and pq.question.blooms:
                bl_code = pq.question.blooms.level_code
            sa = SlotAssignment(
                slot_db_id=pq.id,
                slot_id=pq.slot_id or str(pq.id),
                marks=float(pq.assigned_marks or 0),
                is_or=bool(pq.is_optional),
                or_group=pq.choice_group,
                section_name=sec.section_name,
            )
            sa.assigned_co = co_code
            sa.assigned_blooms = bl_code
            slot_objs.append(sa)

    paper_total = float(config.total_marks) if config else float(sum(x.marks_allocated for x in paper.sections))
    st = build_summary_table(slot_objs, paper_total, co_t, bl_t)
    if st:
        st["paper_total_marks"] = paper_total
        st["answered_marks"] = paper_total
    return {"summary_table": st, "targets_source": source}


def _check_paper_access(paper: models.ExamPaper, user: models.User):
    """Faculty see only their own papers; principal / exam cell / HOD only their own college's."""
    if user.role == "faculty" and paper.created_by != user.id:
        raise HTTPException(403, "Access denied to this paper")
    if user.role in ("principal", "exam_cell", "hod"):
        dept = paper.subject.department if paper.subject else None
        if not user.college_id or not dept or dept.college_id != user.college_id:
            raise HTTPException(403, "This paper belongs to a different college")
        if user.role == "hod" and dept.id != user.department_id:
            raise HTTPException(403, "This paper belongs to a different department")


def _recalculate_paper_analysis(paper: models.ExamPaper, db: Session) -> dict:
    """Recompute CO/Bloom's/unit distributions for a paper using slot assignments."""
    from app.calculation_engine import QuestionEntry, calculate_distributions

    entries: list[QuestionEntry] = []

    for sec in paper.sections:
        for pq in sec.questions:
            # Resolve CO code
            co_code = None
            if pq.slot_co_id:
                co_obj = db.query(models.CourseOutcome).filter(
                    models.CourseOutcome.id == pq.slot_co_id
                ).first()
                co_code = co_obj.co_code if co_obj else None
            elif pq.question_id and pq.question:
                co_code = pq.question.co.co_code if pq.question.co else None

            # Resolve Bloom's code
            blooms_code = None
            if pq.slot_blooms_id:
                bl_obj = db.query(models.BloomsLevel).filter(
                    models.BloomsLevel.id == pq.slot_blooms_id
                ).first()
                blooms_code = bl_obj.level_code if bl_obj else None
            elif pq.question_id and pq.question:
                blooms_code = pq.question.blooms.level_code if pq.question.blooms else None

            # Resolve unit code
            unit_code = None
            if pq.slot_unit_id:
                unit_obj = db.query(models.SyllabusUnit).filter(
                    models.SyllabusUnit.id == pq.slot_unit_id
                ).first()
                unit_code = unit_obj.unit_code if unit_obj else None
            elif pq.question_id and pq.question:
                unit_code = pq.question.unit.unit_code if pq.question.unit else None

            difficulty = pq.slot_difficulty or (
                pq.question.difficulty if pq.question_id and pq.question else None
            )

            entries.append(QuestionEntry(
                question_id=pq.id,  # use pq.id as unique identifier
                assigned_marks=pq.assigned_marks,
                is_optional=pq.is_optional,
                choice_group=pq.choice_group,
                unit_code=unit_code,
                co_code=co_code,
                blooms_code=blooms_code,
                difficulty=difficulty,
            ))

    # Use mandatory (non-OR) marks as the total_marks_target denominator.
    # calculate_distributions already counts choice_groups once, giving the
    # correct mandatory-only total — pass it as the target to suppress false
    # mismatch validation errors (previously config.total_marks included both
    # sides of every OR pair and triggered "60 vs 102" mismatch warnings).
    mandatory_marks = sum(
        pq.assigned_marks for sec in paper.sections
        for pq in sec.questions if not pq.is_optional
    )
    total_target = mandatory_marks if mandatory_marks > 0 else (
        paper.configuration.total_marks if paper.configuration else 0.0
    )
    result = calculate_distributions(entries, total_target)

    return {
        "total_marks": result.total_marks,
        "co_distribution": result.co_distribution,
        "blooms_distribution": result.blooms_distribution,
        "unit_distribution": result.unit_distribution,
        "difficulty_distribution": result.difficulty_distribution,
        "validation_errors": result.validation_errors,
        "warnings": result.warnings,
    }


# ---------------------------------------------------------------------------
# Slot-template CSV files — list and download
# ---------------------------------------------------------------------------

_SAMPLE_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "sample_data",
)

_SLOT_TEMPLATES = [
    {
        "id": "masters_ese_88",
        "filename": "MASTERS_ESE_88_MARKS.csv",
        "label": "Master's ESE — 88 Marks",
        "program": "master",
        "exam_type": "end_semester",
        "total_marks": 88,
    },
    {
        "id": "masters_ese_102",
        "filename": "MASTERS_ESE_102_MARKS.csv",
        "label": "Master's ESE — 102 Marks",
        "program": "master",
        "exam_type": "end_semester",
        "total_marks": 102,
    },
    {
        "id": "bachelors_ese_86",
        "filename": "BACHELORS_ESE_86_MARKS.csv",
        "label": "Bachelor's ESE — 86 Marks",
        "program": "bachelor",
        "exam_type": "end_semester",
        "total_marks": 86,
    },
    {
        "id": "bachelors_ese_102",
        "filename": "BACHELORS_ESE_102_MARKS.csv",
        "label": "Bachelor's ESE — 102 Marks",
        "program": "bachelor",
        "exam_type": "end_semester",
        "total_marks": 102,
    },
    {
        "id": "midsem_remedial_80",
        "filename": "MIDSEM_REMEDIAL_BACHLORS_MASTER_80_MARKS.csv",
        "label": "Mid-Sem / Remedial — 80 Marks",
        "program": "bachelor",
        "exam_type": "mid_semester",
        "total_marks": 80,
    },
]


# ---------------------------------------------------------------------------
# Import slot assignments from a CSV file
# ---------------------------------------------------------------------------

@router.post("/{paper_id}/import-slots-csv")
async def import_slots_csv(
    paper_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Upload a CSV (in sample_data mark-scheme format) and apply the CO & Bloom's
    assignments to matching paper slots.

    The CSV must have columns:  Que, Mark, [Q.N], [sub-label], [OR], MARKS, CO, BLOOM'S
    Rows with a non-blank CO column are matched to paper slots by slot_id.
    Returns the number of slots updated plus the recalculated analysis.
    """
    from app.csv_exam_parser import parse_exam_csv

    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)

    if paper.status not in ("draft", "hod_returned", "principal_returned"):
        raise HTTPException(403, "Paper is not editable in its current status")

    # Read & parse uploaded CSV
    raw = await file.read()
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("latin-1")

    # Parse with the existing engine — we need CO / Bloom's from each row
    # We also need a direct row-level read to capture CO & BLOOM'S columns.
    import csv

    co_map: dict[str, str] = {}    # slot_id → CO code
    bl_map: dict[str, str] = {}    # slot_id → Bloom's code

    reader = csv.reader(io.StringIO(content.lstrip("\ufeff")))
    current_slot_id: str | None = None
    for row in reader:
        while len(row) < 8:
            row.append("")
        que_raw = row[0].strip()
        col_co  = row[6].strip()   # CO column
        col_bl  = row[7].strip()   # BLOOM'S column

        # Skip header
        if que_raw.lower() == "que":
            continue

        # Track the most recent non-blank Que for OR-continuation rows
        if que_raw:
            current_slot_id = que_raw

        # Only record mapping when a CO or Bloom's value is present
        if current_slot_id and (col_co or col_bl):
            if col_co and col_co.upper() not in ("CO", "TOTAL", "CO TARGET MARKS"):
                co_map[current_slot_id] = col_co
            if col_bl and col_bl.upper() not in ("BLOOM'S", "BLOOMS"):
                bl_map[current_slot_id] = col_bl

    if not co_map and not bl_map:
        raise HTTPException(
            422,
            "No CO or Bloom's data found in the uploaded CSV. "
            "Make sure you filled the CO and BLOOM'S columns (columns 7 and 8) before uploading. "
            "Use the 'Download My Paper CSV' button to get the correct slot IDs for your paper, "
            "then fill in CO (e.g. CO1, CO2) and BLOOM'S (e.g. R, U, Ap, An, E) for each row."
        )

    # Resolve CO codes → DB IDs for this subject
    co_code_to_id: dict[str, int] = {
        co.co_code: co.id
        for co in db.query(models.CourseOutcome).filter(
            models.CourseOutcome.subject_id == paper.subject_id
        ).all()
    }
    bl_code_to_id: dict[str, int] = {
        bl.level_code: bl.id
        for bl in db.query(models.BloomsLevel).all()
    }

    # Match paper slots by slot_id and apply
    updated = 0
    unmatched_csv_ids: list[str] = []
    matched_csv_ids: set[str] = set()

    pq_by_slot_id: dict[str, models.PaperQuestion] = {}
    for sec in paper.sections:
        for pq in sec.questions:
            sid = (pq.slot_id or "").strip()
            if sid:
                pq_by_slot_id[sid] = pq

    all_csv_slot_ids = set(co_map.keys()) | set(bl_map.keys())

    for slot_id_csv in all_csv_slot_ids:
        pq = pq_by_slot_id.get(slot_id_csv)
        if not pq:
            unmatched_csv_ids.append(slot_id_csv)
            continue

        matched_csv_ids.add(slot_id_csv)
        co_code = co_map.get(slot_id_csv, "")
        bl_code = bl_map.get(slot_id_csv, "")

        if co_code:
            co_id = co_code_to_id.get(co_code)
            if co_id:
                pq.slot_co_id = co_id
        if bl_code:
            bl_id = bl_code_to_id.get(bl_code)
            if bl_id:
                pq.slot_blooms_id = bl_id

        updated += 1

    db.flush()

    # Recalculate analysis
    analysis_data = _recalculate_paper_analysis(paper, db)
    _save_analysis(paper, analysis_data, db)
    db.commit()

    log_audit(db, current_user.id, "slots_imported_from_csv", "exam_paper", paper.id,
              {"slots_updated": updated, "filename": file.filename})

    # Find paper slots that still have no CO assigned
    slots_without_co = [
        (pq.slot_id or str(pq.id))
        for sec in paper.sections
        for pq in sec.questions
        if not pq.is_optional and not pq.slot_co_id and not (pq.question_id and pq.question and pq.question.co_id)
    ]

    return {
        "paper_id": paper_id,
        "slots_updated": updated,
        "unmatched_csv_slot_ids": unmatched_csv_ids[:20],
        "paper_slot_ids_without_co": slots_without_co[:20],
        "analysis": analysis_data,
    }


# ---------------------------------------------------------------------------
# Update paper metadata (title, academic year) — faculty only, draft only
# ---------------------------------------------------------------------------

@router.patch("/{paper_id}")
def update_paper_metadata(
    paper_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Update title and/or academic_year of a paper. Only allowed in editable statuses."""
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)

    if paper.status not in ("draft", "hod_returned", "principal_returned"):
        raise HTTPException(403, "Paper is not editable in its current status")

    if "title" in body and body["title"]:
        paper.title = body["title"].strip()
    if "academic_year" in body and body["academic_year"]:
        paper.academic_year = body["academic_year"].strip()

    db.commit()
    log_audit(db, current_user.id, "paper_updated", "exam_paper", paper.id,
              {"title": paper.title, "academic_year": paper.academic_year})
    return {"paper_id": paper.id, "title": paper.title, "academic_year": paper.academic_year}


# ---------------------------------------------------------------------------
# Delete paper — faculty only, draft only
# ---------------------------------------------------------------------------

@router.delete("/{paper_id}", status_code=204)
def delete_paper(
    paper_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Permanently delete a draft paper. Faculty can only delete their own papers."""
    paper = _get_paper_or_404(paper_id, db)
    _check_paper_access(paper, current_user)

    if paper.status not in ("draft", "hod_returned", "principal_returned"):
        raise HTTPException(403, "Only draft or returned papers can be deleted")

    log_audit(db, current_user.id, "paper_deleted", "exam_paper", paper.id,
              {"title": paper.title})
    db.delete(paper)
    db.commit()


def _save_analysis(paper: models.ExamPaper, data: dict, db: Session):
    if paper.analysis:
        paper.analysis.total_marks_calculated = data["total_marks"]
        paper.analysis.co_distribution = data["co_distribution"]
        paper.analysis.blooms_distribution = data["blooms_distribution"]
        paper.analysis.unit_distribution = data["unit_distribution"]
        paper.analysis.difficulty_distribution = data["difficulty_distribution"]
        paper.analysis.validation_errors = data["validation_errors"]
    else:
        analysis = models.PaperAnalysis(
            paper_id=paper.id,
            total_marks_calculated=data["total_marks"],
            co_distribution=data["co_distribution"],
            blooms_distribution=data["blooms_distribution"],
            unit_distribution=data["unit_distribution"],
            difficulty_distribution=data["difficulty_distribution"],
            validation_errors=data["validation_errors"],
        )
        db.add(analysis)
