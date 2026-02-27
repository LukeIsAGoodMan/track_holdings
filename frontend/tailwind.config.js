/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Base surfaces
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
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}

