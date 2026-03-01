/**
 * Axios base instance.
 *
 * Dev:  baseURL '/api' is proxied by Vite to http://localhost:8001/api.
 * Prod: VITE_API_URL points to Render (e.g. https://track-holdings-api.onrender.com).
 *
 * Decimal fields from the backend come as strings (e.g. "250000.000000").
 * Do NOT use transformResponse to parse them — preserve strings and let
 * format.ts handle display.
 */
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Request interceptor — attach JWT ────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('th_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Response interceptor ──────────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Auto-redirect to login on 401
    if (error.response?.status === 401) {
      localStorage.removeItem('th_token')
      localStorage.removeItem('th_user')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    const detail =
      error.response?.data?.detail ?? error.message ?? 'Unknown error'
    console.error(`[API] ${error.config?.method?.toUpperCase()} ${error.config?.url} →`, detail)
    return Promise.reject(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)))
  },
)

export default api
