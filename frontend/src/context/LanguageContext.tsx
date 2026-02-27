/**
 * Language context — provides EN ↔ 中文 switching throughout the app.
 *
 * Usage:
 *   const { lang, t, toggle } = useLanguage()
 *   t('holdings_title')   → "Holdings" | "持仓总览"
 *   toggle()              → switches language
 */
import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { TRANSLATIONS, type Lang, type TKey } from '@/i18n/translations'

interface LanguageCtx {
  lang:   Lang
  t:      (key: TKey) => string
  toggle: () => void
}

const LanguageContext = createContext<LanguageCtx | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('en')

  const toggle = useCallback(() =>
    setLang((l) => (l === 'en' ? 'zh' : 'en')), [])

  const t = useCallback(
    (key: TKey): string => TRANSLATIONS[key][lang],
    [lang],
  )

  return (
    <LanguageContext.Provider value={{ lang, t, toggle }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageCtx {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>')
  return ctx
}
