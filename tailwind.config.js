/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f5f6f7',
        surface: '#ffffff',
        line: '#e2e5e9',
        ink: '#12161c',
        muted: '#5f6975',
        ok: '#15803d',
        warn: '#b45309',
        fail: '#c2261b',
        info: '#2456c8'
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
