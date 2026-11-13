# Exam Paper Maker & Moderation Portal

A complete, secure, role-based examination paper management system with:
- **5 Role Panels**: Owner · Principal · HOD · Faculty · Exam Cell
- **3 Exam Types**: Mid-Semester · Remedial · End-Semester
- **Intelligent Paper Generation** with Bloom's taxonomy & CO distribution targeting
- **Marks-based Calculation Engine** (not question-count based)
- **Flexible CSV Import** with column mapping, preview, validation
- **Full Workflow**: Faculty → HOD → Principal → Exam Cell → Export
- **PDF / DOCX / Excel Export** for finalized papers

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, TailwindCSS, React Query, Recharts |
| Backend | Python 3.11, FastAPI, SQLAlchemy, Alembic |
| Database | MySQL 8.x |
| Auth | JWT (python-jose), bcrypt |
| Export | reportlab (PDF), python-docx (DOCX), openpyxl (Excel) |
| Tests | pytest, httpx |

---

## Quick Start (Windows)

### Prerequisites
- Python 3.11+
- Node.js 18+
- MySQL 8.x running locally with an `exam_portal` database created

### 1. Create the database
```sql
CREATE DATABASE exam_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Run setup
```bat
setup.bat
```
This installs all dependencies, copies `.env.example → .env`, runs migrations, and seeds the database.

### 3. Start the application
```bat
run.bat
```
This opens two terminals:
- Backend: http://localhost:8000
- Frontend: http://localhost:5173

### 4. Log in
- Email: `admin@portal.edu`
- Password: `Admin@1234`

---

## Project Structure

```
Portal/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── models.py            # SQLAlchemy ORM models
│   │   ├── schemas.py           # Pydantic request/response schemas
│   │   ├── config.py            # Settings (reads .env)
│   │   ├── database.py          # Engine + session
│   │   ├── auth.py              # Password hash + JWT
│   │   ├── dependencies.py      # FastAPI dependencies (RBAC)
│   │   ├── calculation_engine.py# Marks-based distribution engine
│   │   ├── generation_engine.py # Paper generation logic
│   │   ├── export.py            # PDF/DOCX/Excel export
│   │   ├── audit.py             # Audit log helper
│   │   └── routers/
│   │       ├── auth.py          # /api/auth/*
│   │       ├── users.py         # /api/users/*
│   │       ├── master.py        # /api/master/* (depts, subjects, units, CO, Bloom's)
│   │       ├── questions.py     # /api/questions/*
│   │       ├── papers.py        # /api/papers/* (generate, transition, export)
│   │       ├── csv_import.py    # /api/imports/*
│   │       ├── dashboard.py     # /api/dashboard/*
│   │       └── audit.py         # /api/audit/*
│   ├── alembic/                 # Database migrations
│   ├── tests/                   # pytest test suite
│   ├── seed.py                  # Seed script
│   ├── requirements.txt
│   ├── .env.example
│   └── alembic.ini
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Router + role switching
│   │   ├── api/                 # API client + endpoints
│   │   ├── context/             # AuthContext
│   │   ├── components/          # Layout, StatusBadge, Charts, StatCard
│   │   └── pages/
│   │       ├── owner/           # Owner dashboard
│   │       ├── faculty/         # Faculty dashboard + paper generator
│   │       ├── hod/             # HOD review dashboard
│   │       ├── principal/       # Principal approval dashboard
│   │       ├── examcell/        # Exam Cell finalization
│   │       └── shared/          # Question Bank, Paper Detail, CSV Import
│   ├── package.json
│   └── vite.config.js
├── docs/
│   └── AGENTIC_AI_SDLC_PLAN.md # Full SDLC documentation
├── sample_data/                 # Sample CSV files
├── setup.bat                    # Windows setup script
├── run.bat                      # Windows run script
└── README.md
```

---

## Running Tests

```bash
cd backend
pip install -r requirements.txt
pytest tests/ -v
```

Tests use SQLite in-memory so **no MySQL is required** for the test suite.

---

## API Documentation

Once the backend is running, visit:
- **Swagger UI**: http://localhost:8000/api/docs
- **ReDoc**: http://localhost:8000/api/redoc

---

## Role Permissions Summary

| Action | Owner | Principal | HOD | Faculty | Exam Cell |
|---|:---:|:---:|:---:|:---:|:---:|
| Manage users | ✓ | | | | |
| Manage departments/subjects | ✓ | | | | |
| Manage CO/Bloom's/configs | ✓ | | | | |
| Add/edit questions | ✓ | | | ✓ | |
| CSV import | ✓ | | | ✓ | |
| Generate paper | ✓ | | | ✓ | |
| Submit paper for review | ✓ | | | ✓ | |
| HOD review/approve/return | | | ✓ | | |
| Principal approve/return | | ✓ | | | |
| Exam Cell finalize | ✓ | | | | ✓ |
| Export finalized papers | ✓ | ✓ | | | ✓ |
| View audit log | ✓ | | | | |

---

## Calculation Engine

The marks-based calculation engine follows these rules:

- **Unit coverage %** = marks assigned to unit ÷ total paper marks × 100
- **CO coverage %** = marks mapped to CO ÷ total paper marks × 100
- **Bloom's level %** = marks mapped to level ÷ total paper marks × 100

**Choice groups** (alternative questions): marks counted once; all alternatives' COs/Bloom's attributed.
**Subquestions**: only leaf marks counted; parent is structural.
**Shared CO/Bloom's**: multiple questions with the same CO and Bloom's level is explicitly allowed.

---

## Agentic AI SDLC

See [`docs/AGENTIC_AI_SDLC_PLAN.md`](docs/AGENTIC_AI_SDLC_PLAN.md) for the full 13-phase SDLC plan including:
- Discovery, requirements, CSV analysis
- Architecture and database design
- Agent/tool integration with human approval gates
- Security review, deployment, UAT, and monitoring

---

## Security Notes

- All role checks are **server-side** — frontend routing is UI-only
- Approved/finalized papers are **locked** — edit endpoints return 403
- Passwords hashed with **bcrypt** (cost factor 12)
- JWT tokens expire in **30 minutes**; refresh tokens in **7 days**
- File uploads validated for type, size, and encoding
- SQL injection prevented via **SQLAlchemy ORM** parameterized queries
- **Never commit `.env`** — use `.env.example` as template
