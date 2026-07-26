import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, getToken, setToken, clearToken } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!getToken())

  const refresh = useCallback(async () => {
    if (!getToken()) return
    try {
      setUser(await api('/user/me'))
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const login = (token, u) => {
    setToken(token)
    setUser(u)
  }
  const logout = () => {
    clearToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

// 轻量 toast
let listeners = []
export function toast(message, type = 'info') {
  listeners.forEach(fn => fn({ id: Math.random().toString(36).slice(2), message, type }))
}
export function onToast(fn) {
  listeners.push(fn)
  return () => { listeners = listeners.filter(f => f !== fn) }
}
