import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'mira': {
          bg:           '#EDF1F7',
          surface:      '#FFFFFF',
          sidebar:      '#0F172A',
          border:       '#E2E8F0',
          blue:         '#0284C7',
          'blue-light': '#E0F2FE',
          orange:       '#EA580C',
          muted:        '#64748B',
          faint:        '#94A3B8',
        },
        'card': {
          dark:         '#1E293B',
          'dark-hover': '#243049',
          border:       '#334155',
          'border-hover':'#475569',
          text:         '#F1F5F9',
          muted:        '#94A3B8',
          faint:        '#64748B',
        },
        'severity': {
          s0: '#059669',
          s1: '#65A30D',
          s2: '#D97706',
          s3: '#DC2626',
          s4: '#7C3AED',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'card':          '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-hover':    '0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
        'card-dark':     '0 4px 24px 0 rgb(0 0 0 / 0.25), 0 1px 6px 0 rgb(0 0 0 / 0.15)',
        'card-dark-hover':'0 8px 32px 0 rgb(0 0 0 / 0.32), 0 2px 10px 0 rgb(0 0 0 / 0.2)',
        'sidebar':       '4px 0 6px -1px rgb(0 0 0 / 0.1)',
        'glow-blue':     '0 0 20px rgba(2,132,199,0.25)',
        'glow-green':    '0 0 20px rgba(5,150,105,0.25)',
        'glow-amber':    '0 0 20px rgba(217,119,6,0.25)',
        'glow-red':      '0 0 20px rgba(220,38,38,0.25)',
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
      }
    },
  },
  plugins: [],
}
export default config
