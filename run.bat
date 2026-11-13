@echo off
title Exam Portal - Running

echo ============================================================
echo  Exam Paper Maker ^& Moderation Portal
echo ============================================================
echo.
echo Starting backend (FastAPI) on http://localhost:8000
echo Starting frontend (Vite) on http://localhost:5173
echo.
echo Press Ctrl+C in each window to stop.
echo.

:: Start backend in new window
start "Backend - FastAPI" cmd /k "cd /d %~dp0backend && call .venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

:: Brief pause to let backend start
timeout /t 3 /nobreak >nul

:: Start frontend in new window
start "Frontend - Vite" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Both servers started in separate windows.
echo.
echo  Backend API docs: http://localhost:8000/api/docs
echo  Frontend app:     http://localhost:5173
echo.
pause
