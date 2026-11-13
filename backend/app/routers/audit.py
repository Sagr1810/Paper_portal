from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app import models, schemas
from app.dependencies import get_owner

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=List[schemas.AuditLogOut])
def list_audit_logs(
    user_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    action: Optional[str] = None,
    skip: int = 0,
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    _=Depends(get_owner),
):
    q = db.query(models.AuditLog).order_by(models.AuditLog.created_at.desc())
    if user_id:
        q = q.filter(models.AuditLog.user_id == user_id)
    if resource_type:
        q = q.filter(models.AuditLog.resource_type == resource_type)
    if action:
        q = q.filter(models.AuditLog.action.ilike(f"%{action}%"))
    return q.offset(skip).limit(limit).all()
