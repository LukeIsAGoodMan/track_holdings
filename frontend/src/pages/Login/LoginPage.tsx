/**
 * LoginPage — unified login / register form.
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
    <div className="min-h-screen bg-app flex items-center justify-center">
      <div className="w-full max-w-sm bg-card rounded-xl border border-line p-8">
        {/* Brand */}
        <h1 className="text-info font-bold text-xl mb-1">Track Holdings</h1>
        <p className="text-slate-500 text-sm mb-6">
          {isRegister ? t('auth_register_sub') : t('auth_login_sub')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('auth_username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={50}
              autoFocus
              className="w-full px-3 py-2 bg-app border border-line rounded-md
                         text-sm text-slate-200 placeholder-slate-600
                         focus:outline-none focus:border-info"
              placeholder={t('auth_username')}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('auth_password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 bg-app border border-line rounded-md
                         text-sm text-slate-200 placeholder-slate-600
                         focus:outline-none focus:border-info"
              placeholder={t('auth_password')}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-red-400 text-xs">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-md font-semibold text-sm
                       bg-info text-white hover:bg-info/90
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
            className="text-info hover:underline"
          >
            {isRegister ? t('auth_login') : t('auth_register')}
          </button>
        </p>
      </div>
    </div>
  )
}
