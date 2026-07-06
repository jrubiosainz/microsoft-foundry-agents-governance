/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/frontend/**/*.{html,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Cascadia Code', 'Consolas', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Design tokens (mirrored from static/css/style.css :root)
        app: 'var(--bg-app)',
        accent: {
          DEFAULT: 'var(--accent-primary)',
          secondary: 'var(--accent-secondary)',
          purple: 'var(--accent-purple)',
        },
        status: {
          success: 'var(--status-success)',
          warning: 'var(--status-warning)',
          error: 'var(--status-error)',
          info: 'var(--status-info)',
        },
      },
    },
  },
  plugins: [],
};
