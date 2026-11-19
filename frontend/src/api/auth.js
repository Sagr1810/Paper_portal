export const getToken = () => sessionStorage.getItem('access_token')
export const getRole = () => sessionStorage.getItem('role')
export const getUserId = () => sessionStorage.getItem('user_id')
export const getUserName = () => sessionStorage.getItem('user_name')
export const getDepartmentId = () => {
  const v = sessionStorage.getItem('department_id')
  return v ? parseInt(v) : null
}

export const setTokens = (access, refresh) => {
  sessionStorage.setItem('access_token', access)
  sessionStorage.setItem('refresh_token', refresh)
}

export const setAuth = (data) => {
  sessionStorage.setItem('access_token', data.access_token)
  sessionStorage.setItem('refresh_token', data.refresh_token)
  sessionStorage.setItem('role', data.role)
  sessionStorage.setItem('user_id', String(data.user_id))
  sessionStorage.setItem('user_name', data.name)
  if (data.department_id != null) {
    sessionStorage.setItem('department_id', String(data.department_id))
  } else {
    sessionStorage.removeItem('department_id')
  }
}

export const clearAuth = () => {
  ['access_token', 'refresh_token', 'role', 'user_id', 'user_name', 'department_id'].forEach(k =>
    sessionStorage.removeItem(k)
  )
}

export const isAuthenticated = () => !!getToken()
