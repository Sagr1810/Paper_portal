"""
Integration tests for auth endpoints and RBAC enforcement.
Uses an in-memory SQLite database (no MySQL needed for CI).
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db
from app.auth import hash_password
from app import models

# ── In-memory test database ─────────────────────────────────────────────────
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


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    # Seed minimal data
    db = TestingSessionLocal()
    _seed_test_data(db)
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


def _seed_test_data(db):
    # Bloom's levels
    for code, name, cat, order in [
        ("R","Remember","remember",1), ("U","Understand","understand",2),
        ("Ap","Apply","apply",3), ("An","Analyze","analyze",4),
        ("E","Evaluate","evaluate",5), ("C","Create","create",6),
    ]:
        if not db.query(models.BloomsLevel).filter_by(level_code=code).first():
            db.add(models.BloomsLevel(level_code=code, level_name=name, category=cat, order_num=order))

    dept = db.query(models.Department).filter_by(name="Test Dept").first()
    if not dept:
        dept = models.Department(name="Test Dept", program_type="bachelor")
        db.add(dept)
        db.flush()

    users_data = [
        ("owner@test.com",   "Test Owner",   "owner",     "Owner@1234"),
        ("faculty@test.com", "Test Faculty", "faculty",   "Faculty@1234"),
        ("hod@test.com",     "Test HOD",     "hod",       "Hod@1234"),
        ("principal@test.com","Test Principal","principal","Principal@1234"),
        ("examcell@test.com","Test Exam Cell","exam_cell","ExamCell@1234"),
    ]
    for email, name, role, password in users_data:
        if not db.query(models.User).filter_by(email=email).first():
            db.add(models.User(
                email=email, name=name,
                hashed_password=hash_password(password),
                role=role, department_id=dept.id,
            ))
    db.commit()


client = TestClient(app)


def get_token(email: str, password: str) -> str:
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, f"Login failed for {email}: {resp.text}"
    return resp.json()["access_token"]


# ── Auth tests ──────────────────────────────────────────────────────────────

class TestAuth:
    def test_login_success(self):
        resp = client.post("/api/auth/login", json={"email": "owner@test.com", "password": "Owner@1234"})
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["role"] == "owner"

    def test_login_wrong_password(self):
        resp = client.post("/api/auth/login", json={"email": "owner@test.com", "password": "wrong"})
        assert resp.status_code == 401

    def test_login_nonexistent_user(self):
        resp = client.post("/api/auth/login", json={"email": "nobody@test.com", "password": "pass"})
        assert resp.status_code == 401

    def test_health_endpoint(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_protected_endpoint_no_token(self):
        resp = client.get("/api/users/me")
        assert resp.status_code == 401

    def test_protected_endpoint_invalid_token(self):
        resp = client.get("/api/users/me", headers={"Authorization": "Bearer invalid.token.here"})
        assert resp.status_code == 401

    def test_get_me(self):
        token = get_token("faculty@test.com", "Faculty@1234")
        resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["email"] == "faculty@test.com"


# ── RBAC tests ──────────────────────────────────────────────────────────────

class TestRBAC:
    def test_owner_can_list_users(self):
        token = get_token("owner@test.com", "Owner@1234")
        resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200

    def test_faculty_cannot_list_users(self):
        token = get_token("faculty@test.com", "Faculty@1234")
        resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_hod_cannot_list_users(self):
        token = get_token("hod@test.com", "Hod@1234")
        resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_owner_can_create_department(self):
        token = get_token("owner@test.com", "Owner@1234")
        resp = client.post("/api/master/departments",
                           json={"name": "New Dept", "program_type": "master"},
                           headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 201

    def test_faculty_cannot_create_department(self):
        token = get_token("faculty@test.com", "Faculty@1234")
        resp = client.post("/api/master/departments",
                           json={"name": "Hack Dept"},
                           headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_audit_log_requires_owner(self):
        token = get_token("faculty@test.com", "Faculty@1234")
        resp = client.get("/api/audit", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

        owner_token = get_token("owner@test.com", "Owner@1234")
        resp2 = client.get("/api/audit", headers={"Authorization": f"Bearer {owner_token}"})
        assert resp2.status_code == 200

    def test_exam_cell_cannot_create_questions(self):
        token = get_token("examcell@test.com", "ExamCell@1234")
        resp = client.post("/api/questions",
                           json={"subject_id": 999, "question_text": "test", "question_type": "short",
                                 "difficulty": "easy", "default_marks": 1},
                           headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403


# ── Dashboard tests ─────────────────────────────────────────────────────────

class TestDashboard:
    def test_owner_dashboard(self):
        token = get_token("owner@test.com", "Owner@1234")
        resp = client.get("/api/dashboard/summary", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert "users" in data

    def test_faculty_dashboard(self):
        token = get_token("faculty@test.com", "Faculty@1234")
        resp = client.get("/api/dashboard/summary", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert "my_papers" in data
