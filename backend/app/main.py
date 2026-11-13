"""
FastAPI application entry point.
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import auth, users, master, questions, papers, csv_import, audit, dashboard

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(master.router)
app.include_router(questions.router)
app.include_router(papers.router)
app.include_router(csv_import.router)
app.include_router(audit.router)
app.include_router(dashboard.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME}
