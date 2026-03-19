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

        // ── V2 Design System tokens (Figma source of truth) ───────────
        // Canonical source: src/design-system/tokens.ts
        // Border naming alignment (FIX 1):
        //   v2-border       = rgba(0,0,0,0.08) — standard dividers
        //   v2-border-sub   = REMOVED (was misleading — "sub" implied weaker but was stronger)
        //   v2-border-strong = rgba(0,0,0,0.12) — strong separation (renamed from border-sub)
        v2: {
          bg:               '#fafafa',
          surface:          '#ffffff',
          'surface-raised': '#f9f9f9',
          'surface-hover':  '#f5f4f4',
          'surface-alt':    '#f2f2f2',
          'surface-warm':   '#e4e2dd',
          'surface-warm-alt':'#ded5d2',
          'text-1':         '#32302f',
          'text-2':         '#686664',
          'text-3':         '#94908d',
          border:           'rgba(0, 0, 0, 0.08)',
          'border-strong':  'rgba(0, 0, 0, 0.12)',
          // border-sub: ERADICATED in Phase C — all usages migrated to border
          positive:         '#058a33',
          'positive-bg':    '#f0fdf4',
          negative:         '#cd1c13',
          'negative-bg':    '#fef2f2',
          caution:          '#d97706',
          'caution-bg':     '#fffbeb',
          warning:          '#7e6812',
          accent:           '#305faa',
          'accent-hover':   '#4a6fa5',
          'accent-soft':    '#eef2ff',
          'accent-muted':   '#7f78df',
          'accent-text':    '#305faa',
          'overlay-btn':        'rgba(0, 0, 0, 0.06)',
          'overlay-badge-blue': 'rgba(169, 188, 229, 0.22)',
          'overlay-badge-yellow':'rgba(218, 201, 103, 0.24)',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      // ── V2 Semantic Typography ────────────────────────────────────────
      // Usage: text-ds-display, text-ds-h1, text-ds-body, etc.
      // Canonical source: typography.ts → Figma extraction
      fontSize: {
        'ds-display':  ['1.75rem',   { lineHeight: '2.25rem',  letterSpacing: '-0.02em',  fontWeight: '700' }],  // 28px
        'ds-h1':       ['1.5rem',    { lineHeight: '2rem',     letterSpacing: '-0.01em',  fontWeight: '700' }],  // 24px
        'ds-h2':       ['1.0625rem', { lineHeight: '1.625rem', letterSpacing: '-0.01em',  fontWeight: '700' }],  // 17px
        'ds-h3':       ['0.9375rem', { lineHeight: '1.375rem', letterSpacing: '0.001em',  fontWeight: '700' }],  // 15px
        'ds-body':     ['0.875rem',  { lineHeight: '1.25rem',  letterSpacing: '0.01em',   fontWeight: '700' }],  // 14px bold
        'ds-body-r':   ['0.875rem',  { lineHeight: '1.25rem',  letterSpacing: '0.01em',   fontWeight: '400' }],  // 14px regular
        'ds-sm':       ['0.75rem',   { lineHeight: '1rem',     letterSpacing: '0.015em',  fontWeight: '400' }],  // 12px
        'ds-caption':  ['0.625rem',  { lineHeight: '0.875rem', letterSpacing: '0.02em',   fontWeight: '700' }],  // 10px
      },
      borderRadius: {
        'v2-sm': '0.5rem',    // 8px
        'v2-md': '0.75rem',   // 12px
        'v2-lg': '1rem',      // 16px
        // v2-xl: REMOVED — eradicated per FIX 3
      },
      boxShadow: {
        'v2-sm':       '0px 8px 24px 0px rgba(0, 0, 0, 0.05)',   // card
        'v2-md':       '0px 8px 16px 0px rgba(0, 0, 0, 0.04)',   // subtle
        'v2-lg':       '0px 12px 46px 0px rgba(0, 0, 0, 0.18)',  // elevated
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
