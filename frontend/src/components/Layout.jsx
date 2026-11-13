import React, { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import clsx from 'clsx'
import {
  LayoutDashboard, BookOpen, FileText, Upload, Users, Settings,
  LogOut, Menu, X, ChevronRight, ClipboardList, BarChart2
} from 'lucide-react'

const NAV_BY_ROLE = {
  owner: [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Users', icon: Users, path: '/users' },
    { label: 'Question Bank', icon: BookOpen, path: '/questions' },
    { label: 'CSV Import', icon: Upload, path: '/imports' },
    { label: 'Papers', icon: FileText, path: '/papers' },
    { label: 'Audit Log', icon: ClipboardList, path: '/audit' },
  ],
  faculty: [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Question Bank', icon: BookOpen, path: '/questions' },
    { label: 'My Papers', icon: FileText, path: '/papers' },
    { label: 'CSV Import', icon: Upload, path: '/imports' },
  ],
  hod: [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Review Queue', icon: ClipboardList, path: '/papers' },
  ],
  principal: [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Approval Queue', icon: ClipboardList, path: '/papers' },
  ],
  exam_cell: [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Finalize Papers', icon: FileText, path: '/papers' },
  ],
}

const ROLE_COLORS = {
  owner:     'bg-purple-600',
  faculty:   'bg-blue-600',
  hod:       'bg-green-600',
  principal: 'bg-orange-600',
  exam_cell: 'bg-red-600',
}

const ROLE_LABELS = {
  owner: 'Owner', faculty: 'Faculty', hod: 'HOD',
  principal: 'Principal', exam_cell: 'Exam Cell',
}

export default function Layout({ children }) {
  const { role, name, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const navItems = NAV_BY_ROLE[role] || []

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900 leading-tight">Silver Oak CACAP</h1>
        <p className="text-xs text-gray-500">Exam Moderation Paper Portal</p>
      </div>

      {/* Role badge */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className={clsx('w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold', ROLE_COLORS[role])}>
            {name?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
            <span className={clsx('text-xs text-white px-2 py-0.5 rounded-full', ROLE_COLORS[role])}>
              {ROLE_LABELS[role]}
            </span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ label, icon: Icon, path }) => {
          const active = location.pathname === path
          return (
            <Link
              key={path}
              to={path}
              onClick={() => setSidebarOpen(false)}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-brand text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-gray-200">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 w-full transition-colors"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-gray-200 shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-gray-600/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-white z-50 shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="font-semibold">Menu</span>
              <button onClick={() => setSidebarOpen(false)}><X size={20} /></button>
            </div>
            <Sidebar />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-4">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} className="text-gray-600" />
          </button>
          <span className="text-sm text-gray-500 hidden sm:block">
            {ROLE_LABELS[role]} Panel
          </span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
