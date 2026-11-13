"""Audit log helper."""
from sqlalchemy.orm import Session
from app import models


def log_audit(db: Session, user_id, action: str, resource_type: str = None, resource_id: int = None, detail: dict = None, ip: str = None):
    try:
        entry = models.AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            detail_json=detail,
            ip_address=ip,
        )
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()
