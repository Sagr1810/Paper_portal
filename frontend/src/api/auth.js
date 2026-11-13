export const getToken = () => localStorage.getItem('access_token')
export const getRole = () => localStorage.getItem('role')
export const getUserId = () => localStorage.getItem('user_id')
export const getUserName = () => localStorage.getItem('user_name')
export const getDepartmentId = () => {
  const v = localStorage.getItem('department_id')
  return v ? parseInt(v) : null
}

export const setTokens = (access, refresh) => {
  localStorage.setItem('access_token', access)
  localStorage.setItem('refresh_token', refresh)
}

export const setAuth = (data) => {
  localStorage.setItem('access_token', data.access_token)
  localStorage.setItem('refresh_token', data.refresh_token)
  localStorage.setItem('role', data.role)
  localStorage.setItem('user_id', String(data.user_id))
  localStorage.setItem('user_name', data.name)
  if (data.department_id != null) {
    localStorage.setItem('department_id', String(data.department_id))
  } else {
    localStorage.removeItem('department_id')
  }
}

export const clearAuth = () => {
  ['access_token', 'refresh_token', 'role', 'user_id', 'user_name', 'department_id'].forEach(k =>
    localStorage.removeItem(k)
  )
}

export const isAuthenticated = () => !!getToken()
