"""
Shared pytest fixtures for all test modules.
Uses in-memory SQLite to avoid needing MySQL.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db
from app.auth import hash_password
from app import models

SQLITE_URL = "sqlite:///./test_exam_portal.db"
engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


def _seed_test_data(db):
    for code, name, cat, order in [
        ("R", "Remember", "remember", 1), ("U", "Understand", "understand", 2),
        ("Ap", "Apply", "apply", 3), ("An", "Analyze", "analyze", 4),
        ("E", "Evaluate", "evaluate", 5), ("C", "Create", "create", 6),
    ]:
        if not db.query(models.BloomsLevel).filter_by(level_code=code).first():
            db.add(models.BloomsLevel(level_code=code, level_name=name, category=cat, order_num=order))

    dept = db.query(models.Department).filter_by(name="Test Dept").first()
    if not dept:
        dept = models.Department(name="Test Dept", program_type="bachelor")
        db.add(dept)
        db.flush()

    subj = db.query(models.Subject).filter_by(subject_code="TEST101").first()
    if not subj:
        subj = models.Subject(
            department_id=dept.id,
            subject_code="TEST101",
            subject_name="Test Subject",
            semester=1,
        )
        db.add(subj)
        db.flush()

    # Units
    for code, name in [("U1", "Unit 1"), ("U2", "Unit 2")]:
        if not db.query(models.SyllabusUnit).filter_by(subject_id=subj.id, unit_code=code).first():
            db.add(models.SyllabusUnit(subject_id=subj.id, unit_code=code, unit_name=name))

    # COs
    for code, desc in [("CO1", "CO 1 desc"), ("CO2", "CO 2 desc"), ("CO3", "CO 3 desc")]:
        if not db.query(models.CourseOutcome).filter_by(subject_id=subj.id, co_code=code).first():
            db.add(models.CourseOutcome(subject_id=subj.id, co_code=code, description=desc))

    users_data = [
        ("owner@test.com",    "Test Owner",    "owner",     "Owner@1234"),
        ("faculty@test.com",  "Test Faculty",  "faculty",   "Faculty@1234"),
        ("hod@test.com",      "Test HOD",      "hod",       "Hod@1234"),
        ("principal@test.com","Test Principal","principal", "Principal@1234"),
        ("examcell@test.com", "Test Exam Cell","exam_cell", "ExamCell@1234"),
    ]
    for email, name, role, password in users_data:
        if not db.query(models.User).filter_by(email=email).first():
            db.add(models.User(
                email=email, name=name,
                hashed_password=hash_password(password),
                role=role, department_id=dept.id,
            ))
    db.flush()

    # Seed an exam configuration for template tests
    owner = db.query(models.User).filter_by(email="owner@test.com").first()
    if owner and not db.query(models.ExamConfiguration).filter_by(name="Test Config 30M").first():
        cfg = models.ExamConfiguration(
            exam_type="mid_semester",
            name="Test Config 30M",
            total_marks=30.0,
            duration_minutes=120,
            sections_config=[
                {
                    "name": "Q1",
                    "label": "Question 1",
                    "mandatory": True,
                    "questions_required": 5,
                    "marks_per_question": 2.0,
                    "total_section_marks": 10.0,
                    "allow_choice": False,
                    "choice_extra": 0,
                    "slots": [
                        {"slot_id": f"1{chr(65+i)}", "label": chr(65+i), "marks": 2.0, "is_or": False, "or_group": None}
                        for i in range(5)
                    ],
                },
                {
                    "name": "Q2",
                    "label": "Question 2",
                    "mandatory": False,
                    "questions_required": 2,
                    "marks_per_question": 5.0,
                    "total_section_marks": 10.0,
                    "allow_choice": True,
                    "choice_extra": 1,
                    "slots": [
                        {"slot_id": "2A", "label": "(a)", "marks": 5.0, "is_or": False, "or_group": None},
                        {"slot_id": "2B", "label": "(b)", "marks": 5.0, "is_or": False, "or_group": None},
                        {"slot_id": "2B_alt", "label": "(b) (OR)", "marks": 5.0, "is_or": True, "or_group": "2B_or"},
                    ],
                },
            ],
            is_active=True,
            created_by=owner.id,
        )
        db.add(cfg)

    db.commit()


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    _seed_test_data(db)
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


def _get_token(test_client, email, password):
    resp = test_client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, f"Login failed for {email}: {resp.text}"
    return resp.json()["access_token"]


@pytest.fixture(scope="session")
def owner_token(client):
    return _get_token(client, "owner@test.com", "Owner@1234")


@pytest.fixture(scope="session")
def faculty_token(client):
    return _get_token(client, "faculty@test.com", "Faculty@1234")


@pytest.fixture(scope="session")
def hod_token(client):
    return _get_token(client, "hod@test.com", "Hod@1234")


@pytest.fixture(scope="session")
def principal_token(client):
    return _get_token(client, "principal@test.com", "Principal@1234")


@pytest.fixture(scope="session")
def examcell_token(client):
    return _get_token(client, "examcell@test.com", "ExamCell@1234")


@pytest.fixture
def hdr():
    """Returns a header dict builder: hdr(token) -> {'Authorization': 'Bearer ...'} """
    def _make(token):
        return {"Authorization": f"Bearer {token}"}
    return _make
