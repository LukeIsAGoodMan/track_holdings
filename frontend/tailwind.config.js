/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Base surfaces (dark data area)
        app:  '#080b12',   // outermost background
        card: '#10131c',   // card / panel background
        row:  '#13182a',   // table row hover
        // Border
        line: '#1e2436',   // dividers & borders
        // Semantic — for financial data
        bull: '#22c55e',   // positive / long (green-500)
        bear: '#ef4444',   // negative / short (red-500)
        info: '#38bdf8',   // neutral accent (sky-400)
        warn: '#f59e0b',   // caution / expiry near (amber-500)
        // Chrome (light UI shell — sidebar + topnav)
        chrome: {
          DEFAULT: '#ffffff',
          border:  '#e8ecf0',
          text:    '#0f172a',
          muted:   '#64748b',
          subtle:  '#f5f7fa',
        },
        // Primary accent
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

