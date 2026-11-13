import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'

// Pages
import LoginPage from './pages/LoginPage'
import OwnerDashboard from './pages/owner/OwnerDashboard'
import FacultyDashboard from './pages/faculty/FacultyDashboard'
import HODDashboard from './pages/hod/HODDashboard'
import PrincipalDashboard from './pages/principal/PrincipalDashboard'
import ExamCellDashboard from './pages/examcell/ExamCellDashboard'

// Shared pages
import QuestionBank from './pages/shared/QuestionBank'
import PaperDetail from './pages/shared/PaperDetail'
import CsvImportPage from './pages/shared/CsvImportPage'

function RoleRouter() {
  const { role, isAuthenticated } = useAuth()

  if (!isAuthenticated) return <Navigate to="/login" replace />

  const dashboards = {
    owner:     <OwnerDashboard />,
    faculty:   <FacultyDashboard />,
    hod:       <HODDashboard />,
    principal: <PrincipalDashboard />,
    exam_cell: <ExamCellDashboard />,
  }

  return dashboards[role] || <Navigate to="/login" replace />
}

function AppRoutes() {
  const { isAuthenticated } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<RoleRouter />} />
      <Route path="/questions" element={isAuthenticated ? <QuestionBank /> : <Navigate to="/login" />} />
      <Route path="/papers/:id" element={isAuthenticated ? <PaperDetail /> : <Navigate to="/login" />} />
      <Route path="/imports" element={isAuthenticated ? <CsvImportPage /> : <Navigate to="/login" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
