from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,      # test connection health before checkout
    pool_recycle=1800,       # recycle connections every 30 min (< MySQL wait_timeout)
    pool_timeout=30,         # raise after 30 s if no connection available
    pool_size=10,
    max_overflow=20,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()        # clear any pending-rollback state before closing
        raise
    finally:
        db.close()
