/**
 * Axios base instance.
 * baseURL '/api' is proxied by Vite to http://localhost:8001/api.
 *
 * Decimal fields from the backend come as strings (e.g. "250000.000000").
 * Do NOT use transformResponse to parse them — preserve strings and let
 * format.ts handle display.
 */
import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Response interceptor ──────────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const detail =
      error.response?.data?.detail ?? error.message ?? 'Unknown error'
    console.error(`[API] ${error.config?.method?.toUpperCase()} ${error.config?.url} →`, detail)
    return Promise.reject(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)))
  },
)

export default api
