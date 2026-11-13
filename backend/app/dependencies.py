"""
FastAPI dependency: get current authenticated user, enforce role-based access.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import get_db
from app.auth import decode_token
from app import models

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise credentials_exception

    user_id: int = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    user = db.query(models.User).filter(
        models.User.id == int(user_id),
        models.User.is_active == True,
    ).first()
    if not user:
        raise credentials_exception
    return user


def require_roles(*roles: str):
    """Returns a dependency that enforces the current user has one of the given roles."""
    def _check(current_user: models.User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role(s): {', '.join(roles)}",
            )
        return current_user
    return _check


def get_owner(current_user: models.User = Depends(get_current_user)):
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    return current_user


def get_faculty_or_owner(current_user: models.User = Depends(get_current_user)):
    if current_user.role not in ("owner", "faculty"):
        raise HTTPException(status_code=403, detail="Faculty or Owner access required")
    return current_user
