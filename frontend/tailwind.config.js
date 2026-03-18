/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── V1 (preserved for backward compat) ─────────────────────────
        app:  '#f8fafc',
        card: '#ffffff',
        row:  '#f9fafb',
        line: '#e2e8f0',
        bull: '#059669',
        bear: '#e11d48',
        info: '#38bdf8',
        warn: '#d97706',
        chrome: {
          DEFAULT: '#ffffff',
          border:  '#e8ecf0',
          text:    '#0f172a',
          muted:   '#64748b',
          subtle:  '#f5f7fa',
        },
        primary: {
          DEFAULT: '#3b5bdb',
          soft:    '#eef2ff',
        },

        // ── V2 Design System tokens ─────────────────────────────────────
        v2: {
          bg:           '#fafafa',
          surface:      '#ffffff',
          'surface-hover':'#f8f9fa',
          'surface-alt': '#f5f6f8',
          'text-1':     '#0a0f1a',
          'text-2':     '#5c6370',
          'text-3':     '#9ca3af',
          border:       '#e5e7eb',
          'border-sub': '#f0f1f3',
          positive:     '#16a34a',
          'positive-bg':'#f0fdf4',
          negative:     '#dc2626',
          'negative-bg':'#fef2f2',
          caution:      '#d97706',
          'caution-bg': '#fffbeb',
          accent:       '#4f46e5',
          'accent-soft':'#eef2ff',
          'accent-muted':'#818cf8',
          'accent-text':'#3730a3',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
        sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'v2-sm': '0.5rem',
        'v2-md': '0.75rem',
        'v2-lg': '1rem',
        'v2-xl': '1.25rem',
      },
      boxShadow: {
        'v2-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
        'v2-md': '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)',
        'v2-lg': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.03)',
      },
      maxWidth: {
        'v2-content': '1400px',
      },
      width: {
        'v2-sidebar':    '240px',
        'v2-sidebar-sm': '64px',
        'v2-panel':      '520px',
      },
    },
  },
  plugins: [],
}
