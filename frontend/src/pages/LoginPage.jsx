import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── LEFT PANEL — Silver Oak University image ── */}
      <div
        className="hidden lg:flex lg:w-1/2 items-center justify-center"
        style={{ background: '#f8f8f8' }}
      >
        <img
          src="/college-banner.png"
          alt="Silver Oak University — Education to Innovation"
          className="w-full h-full object-contain"
        />
      </div>

      {/* ── RIGHT PANEL — Login form ── */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center bg-white px-8 py-12">
        <div className="w-full max-w-sm">

          {/* Mobile-only logo (hidden on lg) */}
          <div className="lg:hidden text-center mb-8">
            <div
              className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-3"
              style={{ background: '#7a1a1a' }}
            >
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#7a1a1a' }}>Silver Oak University</p>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-black text-gray-900">Welcome back</h2>
            <p className="text-sm text-gray-500 mt-1">Sign in to the Exam Moderation Paper Portal</p>
            <div className="mt-3 h-0.5 w-10 rounded-full" style={{ background: '#c9a84c' }} />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Email Address</label>
              <input
                type="email"
                className="input"
                placeholder="you@silveroakuni.ac.in"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg font-semibold text-sm text-white transition-opacity disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #7a1a1a 0%, #4a0e0e 100%)' }}
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          {/* Footer note */}
          <p className="mt-8 text-center text-[11px] text-gray-400">
            Silver Oak College of Computer Application
          </p>
        </div>
      </div>

    </div>
  )
}
