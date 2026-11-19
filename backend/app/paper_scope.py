"""Which papers may each role see?  One rule, used by lists, the directory and dashboard counts."""
from app import models


def scope_papers(q, user, department_id=None):
    """
    Restrict an ExamPaper query to the papers this user may see.

      faculty    -> their own papers
      hod        -> papers of their own department (and college)
      principal  -> papers of their college (optionally one department of it)
      exam_cell  -> papers of their college (optionally one department of it)
      owner      -> everything (optionally one department)

    Returns None when the user can see nothing (e.g. no college assigned).
    """
    if user.role == "faculty":
        return q.filter(models.ExamPaper.created_by == user.id)

    if user.role in ("principal", "exam_cell", "hod"):
        if not user.college_id:
            return None
        if user.role == "hod":
            if not user.department_id:
                return None
            department_id = user.department_id          # a HOD can never look at another department
        q = (
            q.join(models.Subject, models.ExamPaper.subject_id == models.Subject.id)
             .join(models.Department, models.Subject.department_id == models.Department.id)
             .filter(models.Department.college_id == user.college_id)
        )
        if department_id:
            q = q.filter(models.Subject.department_id == department_id)
        return q

    # owner
    if department_id:
        q = q.join(models.Subject, models.ExamPaper.subject_id == models.Subject.id).filter(
            models.Subject.department_id == department_id
        )
    return q
