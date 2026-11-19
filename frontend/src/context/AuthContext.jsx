import React, { createContext, useContext, useState, useEffect } from 'react'
import { getRole, getUserName, isAuthenticated, clearAuth, setAuth } from '../api/auth'
import { authApi } from '../api/endpoints'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [role, setRole] = useState(getRole)
  const [name, setName] = useState(getUserName)
  const [loading, setLoading] = useState(false)

  const login = async (email, password) => {
    setLoading(true)
    try {
      const { data } = await authApi.login(email, password)
      setAuth(data)
      setRole(data.role)
      setName(data.name)
      return data
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    const refresh = sessionStorage.getItem('refresh_token')
    try { await authApi.logout(refresh) } catch (_) {}
    clearAuth()
    setRole(null)
    setName(null)
  }

  return (
    <AuthContext.Provider value={{ role, name, loading, login, logout, isAuthenticated: !!role }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
