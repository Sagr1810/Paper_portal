@echo off
setlocal enabledelayedexpansion
title Exam Portal - Setup

echo ============================================================
echo  Exam Paper Maker ^& Moderation Portal - Setup
echo ============================================================
echo.

:: ── Check Python ──────────────────────────────────────────────────────────
echo [1/7] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.11+ from python.org
    pause
    exit /b 1
)
python --version
echo.

:: ── Check Node ────────────────────────────────────────────────────────────
echo [2/7] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Install Node.js 18+ from nodejs.org
    pause
    exit /b 1
)
node --version
echo.

:: ── Backend setup ─────────────────────────────────────────────────────────
echo [3/7] Setting up Python virtual environment...
cd backend

if not exist ".venv" (
    python -m venv .venv
    echo Virtual environment created.
) else (
    echo Virtual environment already exists.
)

call .venv\Scripts\activate.bat
echo.

echo [4/7] Installing Python dependencies...
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
echo Done.
echo.

:: ── .env ──────────────────────────────────────────────────────────────────
echo [5/7] Setting up .env file...
if not exist ".env" (
    copy .env.example .env >nul
    echo Created backend\.env from .env.example
    echo IMPORTANT: Edit backend\.env and set your DATABASE_URL and SECRET_KEY!
) else (
    echo backend\.env already exists.
)
echo.

:: ── Database migrations ────────────────────────────────────────────────────
echo [6/7] Running database migrations...
echo NOTE: Ensure MySQL is running and DATABASE_URL in backend\.env is correct.
echo NOTE: For XAMPP (no root password), DATABASE_URL should be:
echo       mysql+pymysql://root:@localhost:3306/exam_portal
echo.
alembic upgrade head
if errorlevel 1 (
    echo WARNING: Migration failed. Check your DATABASE_URL in backend\.env
    echo If using XAMPP with no root password, set:
    echo   DATABASE_URL=mysql+pymysql://root:@localhost:3306/exam_portal
    echo You can run migrations manually: cd backend ^&^& alembic upgrade head
) else (
    echo Migrations applied successfully.
)
echo.

:: ── Seed ──────────────────────────────────────────────────────────────────
echo [6b/7] Seeding database...
python seed.py
echo.

:: ── Frontend setup ─────────────────────────────────────────────────────────
cd ..\frontend
echo [7/7] Installing frontend dependencies...
npm install --silent
if errorlevel 1 (
    echo ERROR: npm install failed. Check Node.js installation.
    pause
    exit /b 1
)
echo Done.
echo.

:: ── .env frontend ─────────────────────────────────────────────────────────
if not exist ".env" (
    copy .env.example .env >nul
    echo Created frontend\.env
)

cd ..
echo.
echo ============================================================
echo  Setup Complete!
echo ============================================================
echo.
echo  Next steps:
echo  1. Edit backend\.env - set DATABASE_URL and change SECRET_KEY
echo  2. Run: run.bat
echo  3. Open http://localhost:5173 in your browser
echo  4. Login: admin@portal.edu / Admin@1234
echo.
pause
