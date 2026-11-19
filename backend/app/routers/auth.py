from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timezone
from app.database import get_db
from app import models, schemas
from app.auth import verify_password, create_access_token, create_refresh_token, hash_password, decode_token
import hashlib

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _hash_refresh(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/login", response_model=schemas.TokenResponse)
def login(body: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == body.email).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    access_token = create_access_token({"sub": str(user.id), "role": user.role})
    refresh_token = create_refresh_token({"sub": str(user.id)})

    # Delete any existing refresh tokens for this user before inserting a new one.
    # This prevents UNIQUE constraint collisions when the same user logs in multiple
    # times in the same test session (SQLite in-memory DB reuses identical timestamps,
    # producing the same token hash).
    db.query(models.RefreshToken).filter(
        models.RefreshToken.user_id == user.id,
    ).delete(synchronize_session="fetch")
    db.flush()  # ensure DELETEs are written before the INSERT below

    # Store hashed refresh token
    from app.config import settings
    from datetime import timedelta
    rt = models.RefreshToken(
        user_id=user.id,
        token_hash=_hash_refresh(refresh_token),
        expires_at=(datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)).replace(tzinfo=None),
    )
    db.add(rt)
    db.commit()

    return schemas.TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        role=user.role,
        user_id=user.id,
        name=user.name,
        college_id=user.college_id,
        department_id=user.department_id,
    )


@router.post("/refresh", response_model=schemas.TokenResponse)
def refresh(body: schemas.RefreshRequest, db: Session = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    token_hash = _hash_refresh(body.refresh_token)
    stored = db.query(models.RefreshToken).filter(
        models.RefreshToken.token_hash == token_hash,
        models.RefreshToken.revoked == False,
    ).first()
    if not stored:
        raise HTTPException(status_code=401, detail="Refresh token not found or revoked")

    user = db.query(models.User).filter(
        models.User.id == int(payload["sub"]),
        models.User.is_active == True,
    ).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Revoke old, issue new
    stored.revoked = True
    db.commit()

    access_token = create_access_token({"sub": str(user.id), "role": user.role})
    new_refresh = create_refresh_token({"sub": str(user.id)})
    from app.config import settings
    from datetime import timedelta
    new_rt = models.RefreshToken(
        user_id=user.id,
        token_hash=_hash_refresh(new_refresh),
        expires_at=(datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)).replace(tzinfo=None),
    )
    db.add(new_rt)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Token collision, please retry")

    return schemas.TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh,
        role=user.role,
        user_id=user.id,
        name=user.name,
        college_id=user.college_id,
        department_id=user.department_id,
    )


@router.post("/logout")
def logout(body: schemas.RefreshRequest, db: Session = Depends(get_db)):
    token_hash = _hash_refresh(body.refresh_token)
    stored = db.query(models.RefreshToken).filter(
        models.RefreshToken.token_hash == token_hash,
    ).first()
    if stored:
        stored.revoked = True
        db.commit()
    return {"message": "Logged out"}
