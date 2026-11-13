"""
Dashboard summary endpoint — returns role-specific stats.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.dependencies import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def get_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    role = current_user.role

    if role == "owner":
        return {
            "users": db.query(models.User).count(),
            "departments": db.query(models.Department).filter(models.Department.is_active == True).count(),
            "subjects": db.query(models.Subject).filter(models.Subject.is_active == True).count(),
            "questions": db.query(models.Question).filter(models.Question.is_active == True).count(),
            "papers": db.query(models.ExamPaper).count(),
            "imports": db.query(models.CsvImport).count(),
            "pending_approvals": db.query(models.ExamPaper).filter(
                models.ExamPaper.status.in_(["submitted", "hod_review", "principal_review", "exam_cell_review"])
            ).count(),
        }

    elif role == "faculty":
        my_papers = db.query(models.ExamPaper).filter(models.ExamPaper.created_by == current_user.id)
        return {
            "my_papers": my_papers.count(),
            "drafts": my_papers.filter(models.ExamPaper.status == "draft").count(),
            "in_review": my_papers.filter(
                models.ExamPaper.status.in_(["submitted", "hod_review", "hod_approved", "principal_review"])
            ).count(),
            "returned": my_papers.filter(
                models.ExamPaper.status.in_(["hod_returned", "principal_returned"])
            ).count(),
            "finalized": my_papers.filter(models.ExamPaper.status == "finalized").count(),
            "question_bank_size": db.query(models.Question).filter(
                models.Question.created_by == current_user.id,
                models.Question.is_active == True,
            ).count(),
        }

    elif role == "hod":
        return {
            "pending_review": db.query(models.ExamPaper).filter(
                models.ExamPaper.status.in_(["submitted", "hod_review"])
            ).count(),
            "approved_today": db.query(models.WorkflowHistory).filter(
                models.WorkflowHistory.to_status == "hod_approved",
                models.WorkflowHistory.actor_id == current_user.id,
            ).count(),
            "total_reviewed": db.query(models.WorkflowHistory).filter(
                models.WorkflowHistory.actor_id == current_user.id,
            ).count(),
        }

    elif role == "principal":
        return {
            "pending_approval": db.query(models.ExamPaper).filter(
                models.ExamPaper.status.in_(["hod_approved", "principal_review"])
            ).count(),
            "approved": db.query(models.ExamPaper).filter(
                models.ExamPaper.status == "principal_approved"
            ).count(),
        }

    elif role == "exam_cell":
        return {
            "pending_finalize": db.query(models.ExamPaper).filter(
                models.ExamPaper.status.in_(["principal_approved", "exam_cell_review"])
            ).count(),
            "finalized": db.query(models.ExamPaper).filter(
                models.ExamPaper.status == "finalized"
            ).count(),
        }

    return {}
