/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#fafbfc',
        panel: '#f4f6f8',
        card: '#ffffff',
        line: '#e6e8ec',
        ink: {
          DEFAULT: '#16181d',
          dim: '#5b616e',
          mute: '#9aa1ad'
        },
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca'
        },
        chart: {
          blue: '#2a78d6'
        },
        ok: '#15803d',
        okbg: '#ecfdf3',
        warn: '#b45309',
        warnbg: '#fffbeb',
        bad: '#dc2626',
        badbg: '#fef2f2'
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04)',
        pop: '0 4px 16px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.04)',
        modal: '0 12px 40px rgba(16, 24, 40, 0.16)'
      },
      animation: {
        'fade-up': 'fadeUp .4s ease both'
      },
      keyframes: {
        fadeUp: {
          from: { opacity: 0, transform: 'translateY(8px)' },
          to: { opacity: 1, transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: []
}
