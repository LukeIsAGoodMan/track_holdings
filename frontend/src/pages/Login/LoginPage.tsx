/**
 * LoginPage — unified login / register form. Light theme.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useLanguage } from '@/context/LanguageContext'

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername]     = useState('')
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState<string | null>(null)
  const [loading, setLoading]       = useState(false)
  const { login, register } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (isRegister) {
        await register(username, password)
      } else {
        await login(username, password)
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-app flex items-center justify-center font-sans">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
        {/* Brand */}
        <h1 className="text-primary font-bold text-xl mb-1">Track Holdings</h1>
        <p className="text-slate-500 text-sm mb-6">
          {isRegister ? t('auth_register_sub') : t('auth_login_sub')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label className="block text-xs text-slate-500 font-medium mb-1">{t('auth_username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={50}
              autoFocus
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg
                         text-sm text-slate-900 placeholder-slate-400
                         focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10
                         transition-colors"
              placeholder={t('auth_username')}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs text-slate-500 font-medium mb-1">{t('auth_password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg
                         text-sm text-slate-900 placeholder-slate-400
                         focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10
                         transition-colors"
              placeholder={t('auth_password')}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-rose-600 text-xs bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-lg font-semibold text-sm
                       bg-primary text-white hover:bg-primary/90 shadow-sm
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {loading ? '...' : isRegister ? t('auth_register') : t('auth_login')}
          </button>
        </form>

        {/* Toggle mode */}
        <p className="mt-5 text-center text-xs text-slate-500">
          {isRegister ? t('auth_have_acct') : t('auth_no_acct')}{' '}
          <button
            onClick={() => { setIsRegister(!isRegister); setError(null) }}
            className="text-primary hover:underline font-medium"
          >
            {isRegister ? t('auth_login') : t('auth_register')}
          </button>
        </p>
      </div>
    </div>
  )
}
