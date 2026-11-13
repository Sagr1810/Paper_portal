# Agentic AI SDLC Plan — Exam Paper Maker & Moderation Portal

> Version: 1.0 | Date: 2025 | Status: Active

---

## Table of Contents
1. [Discovery](#1-discovery)
2. [Requirements Engineering](#2-requirements-engineering)
3. [CSV / Data Analysis](#3-csv--data-analysis)
4. [Architecture & Database Design](#4-architecture--database-design)
5. [UI/UX Design](#5-uiux-design)
6. [Task Planning & Sprint Decomposition](#6-task-planning--sprint-decomposition)
7. [Incremental Development](#7-incremental-development)
8. [Agent & Tool Integration](#8-agent--tool-integration)
9. [Testing & Evaluation](#9-testing--evaluation)
10. [Security Review](#10-security-review)
11. [Deployment](#11-deployment)
12. [User Acceptance Testing](#12-user-acceptance-testing)
13. [Continuous Monitoring](#13-continuous-monitoring)

---

## 1. Discovery

### Stakeholder Analysis
| Stakeholder | Role in Portal | Key Concerns |
|---|---|---|
| Owner | System administrator | Data integrity, CSV flexibility, user management |
| Principal | Final approver | Paper quality, CO alignment |
| HOD | Academic reviewer | Bloom's distribution, syllabus coverage |
| Faculty | Paper creator | Easy generation, flexible configuration |
| Exam Cell | Logistics & export | Format correctness, finalized paper security |

### Domain Discovery
- Academic exam papers must satisfy CO (Course Outcome) and Bloom's taxonomy distribution targets.
- Three exam types: Mid-Semester, Remedial, End-Semester — each independently configurable.
- Bachelor's and Master's programs have different mark schemes.
- Questions are drawn from a question bank; the generation engine selects questions to match distribution targets.
- Moderation workflow: Faculty → HOD → Principal → Exam Cell.

### AI Agent Roles in Discovery
- **Discovery Agent**: Interviews stakeholder personas, extracts implicit requirements, flags ambiguities.
- **Domain Agent**: Reads academic standards (AICTE/UGC), suggests CO-Bloom's matrix templates.
- **Human Gate**: Domain expert review of extracted requirements before proceeding.

---

## 2. Requirements Engineering

### Functional Requirements
| ID | Requirement |
|---|---|
| FR-01 | Five role-based panels with server-side RBAC |
| FR-02 | Three exam types with independent configuration |
| FR-03 | Flexible CSV import with column mapping |
| FR-04 | Intelligent paper generation engine |
| FR-05 | Mathematical calculation engine (marks-based) |
| FR-06 | Configurable approval workflow |
| FR-07 | Export to PDF, DOCX, Excel/CSV |
| FR-08 | Audit log for all workflow events |
| FR-09 | Prevent duplicate questions in a single paper |
| FR-10 | Questions may share CO and Bloom's level |

### Non-Functional Requirements
| ID | Requirement |
|---|---|
| NFR-01 | JWT authentication with refresh tokens |
| NFR-02 | Role checked server-side on every endpoint |
| NFR-03 | Responsive UI (mobile-first) |
| NFR-04 | MySQL with Alembic migrations |
| NFR-05 | All approved papers locked from edits |
| NFR-06 | Passwords hashed with bcrypt |
| NFR-07 | All sensitive endpoints behind HTTPS in production |

### AI Agent Roles
- **Requirements Agent**: Translates stakeholder statements into FR/NFR entries with acceptance criteria.
- **Conflict Detector Agent**: Identifies conflicting requirements (e.g., "unique CO" vs FR-10).
- **Human Gate**: Product owner signs off on requirements before architecture begins.

---

## 3. CSV / Data Analysis

### Supported CSV Categories
| Category | Who Uploads | Configurable Columns |
|---|---|---|
| Question Bank | Owner, Faculty | question_text, unit, co, blooms, difficulty, type, marks |
| Sample Papers | Faculty | Any exam-type-specific layout |
| Syllabus Units | Owner | unit_code, unit_name, weight_percent |
| CO Mappings | Owner | co_code, co_description, po_mapping |
| Bloom's Levels | Owner | level_code, level_name, category |
| Exam Configurations | Owner | exam_type, section, marks_per_question, choices |

### CSV Pipeline
1. User selects template category and uploads file.
2. System parses headers and proposes column mappings (fuzzy match).
3. User confirms or overrides column mapping in UI.
4. Preview table shows first 10 rows with mapped fields.
5. Validation runs: missing required fields, type checks, range checks.
6. Duplicate detection against existing records.
7. Error report shown with row-level messages.
8. User downloads corrected-row report, fixes, re-uploads, or force-imports non-duplicate rows.
9. Import history stored per upload.

### AI Agent Roles
- **Schema Mapper Agent**: Uses fuzzy matching + LLM column inference to propose mappings.
- **Validation Agent**: Applies domain rules (marks must be positive, Bloom's level must be in taxonomy).
- **Human Gate**: Column mapping confirmation required before import proceeds.

---

## 4. Architecture & Database Design

### Technology Stack
| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, TailwindCSS, React Query, Recharts |
| Backend | Python 3.11, FastAPI, SQLAlchemy 2.x, Alembic |
| Database | MySQL 8.x |
| Auth | JWT (python-jose), bcrypt (passlib) |
| File Export | reportlab (PDF), python-docx (DOCX), openpyxl (Excel) |
| Testing | pytest, pytest-asyncio, httpx |

### High-Level Architecture
```
Browser (React + Vite)
        │ HTTPS REST + JSON
        ▼
FastAPI Application Server
        │
        ├── Auth Router (/api/auth)
        ├── Users Router (/api/users)
        ├── Exam Config Router (/api/exam-configs)
        ├── Question Bank Router (/api/questions)
        ├── Paper Router (/api/papers)
        ├── CSV Import Router (/api/imports)
        ├── Reports Router (/api/reports)
        └── Audit Router (/api/audit)
                │
        SQLAlchemy ORM
                │
        MySQL 8.x Database
```

### Core Database Tables
- `users` — id, email, name, hashed_password, role, department, is_active
- `departments` — id, name, program_type (bachelor/master)
- `exam_types` — id, name (mid/remedial/end), config_json
- `exam_configurations` — id, exam_type_id, department_id, total_marks, sections_json
- `syllabus_units` — id, department_id, subject_id, unit_code, unit_name, weight_percent
- `course_outcomes` — id, subject_id, co_code, description
- `blooms_levels` — id, level_code, level_name, category
- `questions` — id, subject_id, unit_id, co_id, blooms_id, text, type, difficulty, marks, created_by
- `question_tags` — id, question_id, tag
- `exam_papers` — id, subject_id, exam_type_id, created_by, status, version, locked_at
- `paper_sections` — id, paper_id, section_name, instructions, marks_allocated
- `paper_questions` — id, paper_id, section_id, question_id, assigned_marks, is_optional, choice_group
- `paper_analysis` — id, paper_id, analysis_json (CO%, Bloom's%, unit%)
- `workflow_history` — id, paper_id, from_status, to_status, actor_id, comments, created_at
- `csv_imports` — id, uploaded_by, category, filename, status, rows_total, rows_imported, errors_json
- `audit_logs` — id, user_id, action, resource_type, resource_id, detail_json, created_at

### AI Agent Roles
- **Schema Agent**: Proposes normalized schema from requirements, checks 3NF.
- **Migration Agent**: Generates Alembic migration files.
- **Human Gate**: DBA/tech lead reviews schema before migration is run on staging.

---

## 5. UI/UX Design

### Design Principles
- Mobile-first responsive layout using TailwindCSS breakpoints.
- Role-specific dashboards: each role sees only their actionable items.
- Color-coded workflow status badges (Draft, Under Review, Approved, Finalized, Returned).
- Interactive distribution charts (CO%, Bloom's%) with calculated vs. target overlay.
- Accessible: WCAG 2.1 AA compliance targets.

### Key Screens
| Screen | Role | Purpose |
|---|---|---|
| Login | All | JWT auth |
| Owner Dashboard | Owner | User management, system config |
| Faculty Dashboard | Faculty | My papers, generate new, question bank |
| Paper Generator | Faculty | Configure, generate, preview, adjust |
| CSV Import | Owner/Faculty | Upload, map, preview, validate |
| HOD Review | HOD | Review queue, comments, distributions |
| Principal Approval | Principal | Approve/return with comments |
| Exam Cell Finalize | Exam Cell | Final check, export PDF/DOCX |
| Audit Log | Owner | Full activity log |

---

## 6. Task Planning & Sprint Decomposition

### Sprint 0 — Foundation (Week 1)
- [x] Workspace scaffold (Vite + FastAPI)
- [x] MySQL schema + Alembic migrations
- [x] JWT auth + RBAC middleware
- [x] User management CRUD

### Sprint 1 — Core Data (Week 2)
- [ ] Exam type configuration
- [ ] Syllabus units, CO, Bloom's management
- [ ] Question bank CRUD + CSV import pipeline

### Sprint 2 — Paper Generation (Week 3)
- [ ] Generation engine (marks-based)
- [ ] Distribution calculation engine
- [ ] Validation layer

### Sprint 3 — Workflow (Week 4)
- [ ] Workflow state machine
- [ ] HOD/Principal/Exam Cell panels
- [ ] Audit logging

### Sprint 4 — Export & Polish (Week 5)
- [ ] PDF/DOCX/Excel export
- [ ] Charts and analysis reports
- [ ] UI polish, mobile responsiveness

### Sprint 5 — Testing & Hardening (Week 6)
- [ ] Automated tests
- [ ] Security review
- [ ] UAT and bug fixes

---

## 7. Incremental Development

- Code is committed per feature with passing tests.
- Database migrations are reversible (Alembic downgrade supported).
- Feature flags disable incomplete features in production.
- Backend and frontend developed in parallel via OpenAPI contract first.

---

## 8. Agent & Tool Integration

### Agents
| Agent | Trigger | Action | Human Gate |
|---|---|---|---|
| Paper Generation Agent | Faculty clicks Generate | Selects questions to match distribution | Faculty previews, confirms or adjusts |
| Validation Agent | Before submission | Checks marks totals, CO%, Bloom's%, unit% | Shows report to faculty |
| CSV Mapper Agent | CSV upload | Proposes column mapping | User confirms mapping |
| Audit Agent | Every workflow transition | Writes audit log | None (automated) |
| Export Agent | Exam Cell export | Renders PDF/DOCX | Exam Cell downloads |

### Tools
- `generate_paper(config)` → draft paper JSON
- `calculate_distributions(paper)` → analysis JSON
- `validate_paper(paper, config)` → validation report
- `map_csv_columns(headers, category)` → mapping suggestion
- `export_paper(paper_id, format)` → binary file

### Constraints
- AI agents may **recommend** but never **auto-approve** or **auto-finalize** papers.
- AI may not modify a paper that has status `approved` or `finalized`.
- All AI actions are logged in `audit_logs` with `actor_id = system`.

---

## 9. Testing & Evaluation

### Test Categories
| Category | Tool | Coverage Target |
|---|---|---|
| Unit — Calculation Engine | pytest | 100% of calculation functions |
| Unit — RBAC | pytest | All 5 roles × all endpoints |
| Integration — Workflow | pytest + httpx | Full Faculty→HOD→Principal→ExamCell flow |
| Integration — CSV Import | pytest | 5+ CSV variants per category |
| E2E — Paper Generation | pytest | Mid, Remedial, End-Sem |
| Security — Auth | pytest | Invalid tokens, role escalation attempts |

### Key Test Cases
- Marks total validation (correct, over, under)
- CO distribution calculation (shared CO allowed)
- Bloom's distribution calculation
- Optional question handling (mutually exclusive alternatives not double-counted)
- Subquestion marks aggregation
- CSV with missing columns, extra columns, duplicate rows
- Workflow state transitions (valid and invalid)
- Role permissions (each role attempts unauthorized actions)

---

## 10. Security Review

### Controls
- JWT tokens expire in 30 minutes; refresh tokens in 7 days.
- Role checked server-side on every endpoint (not just frontend routing).
- Passwords hashed with bcrypt (cost factor 12).
- SQL injection prevented by SQLAlchemy ORM parameterized queries.
- File uploads validated: type, size, UTF-8 encoding check.
- Approved/finalized papers locked — all edit endpoints return 403.
- Export downloads gated by role; Exam Cell only for finalized papers.
- CORS restricted to frontend origin in production.
- Rate limiting on auth endpoints.
- All secrets in `.env` (never committed).

### AI Security Rules
- AI agents operate under least-privilege API keys.
- AI cannot call approve/finalize endpoints directly.
- All AI-suggested changes require explicit human confirmation before write.

---

## 11. Deployment

### Development (Local)
- `setup.bat` installs all dependencies, creates `.env` from `.env.example`, creates DB.
- `run.bat` starts backend (uvicorn) and frontend (vite) in separate terminals.

### Production Recommendations
- Containerize backend with Docker.
- Use Nginx reverse proxy for frontend static files.
- MySQL managed service (RDS/Azure DB).
- Store JWT secret and DB credentials in secrets manager.
- Enable HTTPS with TLS 1.2+.
- Automated daily DB backups.

---

## 12. User Acceptance Testing

### UAT Scenarios
| Scenario | Actors | Pass Criteria |
|---|---|---|
| Full paper lifecycle | Faculty, HOD, Principal, Exam Cell | Paper moves through all states, exports correctly |
| CSV import variants | Owner | All 6 CSV categories import correctly |
| Permission enforcement | All roles | No role can perform another role's exclusive actions |
| Distribution accuracy | Faculty, HOD | Calculated percentages match manual calculation |
| Regeneration | Faculty | Adjusting target % produces updated paper |

### Human Approval Required
- UAT sign-off by Owner (system admin) before production go-live.
- Principal and HOD must approve at least one full paper lifecycle in staging.

---

## 13. Continuous Monitoring

### Metrics
- API response time (p50, p95, p99) — alert if p95 > 2s.
- Error rate per endpoint — alert if > 1% 5xx.
- Failed login attempts — alert if > 20/minute (possible brute force).
- CSV import failure rate — trend analysis weekly.
- Paper generation time — alert if > 10s.

### Audit Log Monitoring
- Weekly report of all workflow transitions, export events, and CSV imports sent to Owner.
- Anomaly detection: same user approving own paper, role escalation attempts.

### AI Agent Monitoring
- All agent actions logged with input/output snapshots.
- Human review of agent recommendations weekly.
- Agent performance metrics: mapping accuracy, generation distribution accuracy.

---

*This document is maintained by the project Owner and updated after each sprint. Human approval gates are mandatory and cannot be bypassed by any automated system.*
