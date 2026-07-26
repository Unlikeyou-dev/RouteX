/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0c12',
        panel: '#0f1219',
        card: '#141826',
        elevate: '#1a1f30',
        line: 'rgba(255,255,255,0.08)',
        ink: {
          DEFAULT: '#f1f3f8',
          dim: '#a7adbd',
          mute: '#6b7280'
        },
        brand: {
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca'
        },
        glow: '#8b5cf6',
        cyan: { 400: '#22d3ee' },
        chart: {
          blue: '#3987e5',
          orange: '#d95926',
          aqua: '#199e70'
        },
        ok: '#0ca30c',
        warn: '#fab219',
        bad: '#e66767'
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35)',
        glowsm: '0 0 24px rgba(99,102,241,0.35)',
        glow: '0 0 60px rgba(99,102,241,0.45)'
      },
      animation: {
        'fade-up': 'fadeUp .5s ease both',
        float: 'float 7s ease-in-out infinite'
      },
      keyframes: {
        fadeUp: {
          from: { opacity: 0, transform: 'translateY(12px)' },
          to: { opacity: 1, transform: 'translateY(0)' }
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-14px)' }
        }
      }
    }
  },
  plugins: []
}
