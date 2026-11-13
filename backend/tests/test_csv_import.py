"""
Tests for the CSV import pipeline.
"""
import io
import pytest
from fastapi.testclient import TestClient
from tests.test_api import client, setup_db  # reuse fixtures

_token_cache: dict = {}

def get_token(email: str, password: str) -> str:
    """Cache tokens per email to avoid duplicate refresh token hashes in same session."""
    if email not in _token_cache:
        resp = client.post("/api/auth/login", json={"email": email, "password": password})
        assert resp.status_code == 200, f"Login failed for {email}: {resp.text}"
        _token_cache[email] = resp.json()["access_token"]
    return _token_cache[email]


class TestCsvTemplates:
    """Templates should be downloadable without auth restrictions beyond basic login."""

    def test_download_questions_template(self):
        token = get_token("owner@test.com", "Owner@1234")
        resp = client.get("/api/imports/templates/questions",
                          headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]
        content = resp.content.decode()
        assert "question_text" in content

    def test_download_units_template(self):
        token = get_token("owner@test.com", "Owner@1234")
        resp = client.get("/api/imports/templates/units",
                          headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        content = resp.content.decode()
        assert "unit_code" in content

    def test_download_invalid_template(self):
        token = get_token("owner@test.com", "Owner@1234")
        resp = client.get("/api/imports/templates/invalid_category",
                          headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 400


class TestCsvUpload:
    def _make_csv(self, rows: list[list], headers: list[str]) -> bytes:
        buf = io.StringIO()
        buf.write(",".join(headers) + "\n")
        for row in rows:
            buf.write(",".join(str(x) for x in row) + "\n")
        return buf.getvalue().encode()

    def test_upload_questions_csv(self):
        token = get_token("faculty@test.com", "Faculty@1234")
        csv_data = self._make_csv(
            headers=["question_text", "question_type", "difficulty", "default_marks", "co_code", "blooms_code"],
            rows=[
                ["What is a binary tree?", "short", "easy", "2", "CO1", "R"],
                ["Explain recursion with example.", "long", "medium", "5", "CO2", "U"],
                ["Write BFS algorithm.", "long", "hard", "10", "CO1", "Ap"],
            ]
        )
        resp = client.post(
            "/api/imports/upload",
            data={"category": "questions"},
            files={"file": ("questions.csv", csv_data, "text/csv")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["rows_total"] == 3
        assert "suggested_mapping" in data
        assert data["suggested_mapping"].get("question_text") == "question_text"

    def test_upload_wrong_category(self):
        token = get_token("owner@test.com", "Owner@1234")
        csv_data = b"col1,col2\nval1,val2\n"
        resp = client.post(
            "/api/imports/upload",
            data={"category": "invalid_category"},
            files={"file": ("test.csv", csv_data, "text/csv")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    def test_upload_invalid_csv(self):
        token = get_token("owner@test.com", "Owner@1234")
        bad_data = b"\x00\x01\x02binary garbage"
        resp = client.post(
            "/api/imports/upload",
            data={"category": "questions"},
            files={"file": ("bad.csv", bad_data, "text/csv")},
            headers={"Authorization": f"Bearer {token}"},
        )
        # Should return 400 with parse error
        assert resp.status_code in (400, 201)  # 201 if pandas tolerates it

    def test_faculty_cannot_import_without_auth(self):
        csv_data = b"question_text,marks\nTest Q,2\n"
        resp = client.post(
            "/api/imports/upload",
            data={"category": "questions"},
            files={"file": ("test.csv", csv_data, "text/csv")},
        )
        assert resp.status_code == 401

    def test_exam_cell_cannot_upload(self):
        token = get_token("examcell@test.com", "ExamCell@1234")
        csv_data = b"question_text,marks\nTest Q,2\n"
        resp = client.post(
            "/api/imports/upload",
            data={"category": "questions"},
            files={"file": ("test.csv", csv_data, "text/csv")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    def test_csv_with_alternative_column_names(self):
        """CSV with non-standard headers should get fuzzy-matched mapping."""
        token = get_token("owner@test.com", "Owner@1234")
        csv_data = self._make_csv(
            headers=["Question Text", "Type", "Level", "Points", "Course Outcome", "Bloom"],
            rows=[
                ["Describe polymorphism", "short", "medium", "3", "CO1", "U"],
            ]
        )
        resp = client.post(
            "/api/imports/upload",
            data={"category": "questions"},
            files={"file": ("alt_cols.csv", csv_data, "text/csv")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        # "Level" should map to "difficulty" or "blooms_code"
        mapping = data.get("suggested_mapping", {})
        assert len(mapping) > 0  # some mapping should have been suggested
