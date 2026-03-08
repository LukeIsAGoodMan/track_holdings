/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Page surfaces (light theme) ─────────────────────────────────
        app:  '#f8fafc',   // page background  (slate-50)
        card: '#ffffff',   // card/panel        (white)
        row:  '#f9fafb',   // table row hover   (gray-50)
        // Border
        line: '#e2e8f0',   // dividers & borders (slate-200)
        // ── Semantic — financial data ────────────────────────────────────
        bull: '#059669',   // positive / long  (emerald-600)
        bear: '#e11d48',   // negative / short (rose-600)
        info: '#38bdf8',   // neutral accent   (sky-400, kept for compat)
        warn: '#d97706',   // caution / expiry (amber-600)
        // ── Chrome (light UI shell — sidebar + topnav) ───────────────────
        chrome: {
          DEFAULT: '#ffffff',
          border:  '#e8ecf0',
          text:    '#0f172a',
          muted:   '#64748b',
          subtle:  '#f5f7fa',
        },
        // ── Primary accent (indigo blue) ─────────────────────────────────
        primary: {
          DEFAULT: '#3b5bdb',
          soft:    '#eef2ff',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
        sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
