/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mine: {
          bg:        '#0a0d14',
          panel:     '#111827',
          card:      '#1a2035',
          border:    '#1e2d45',
          accent:    '#f59e0b',
          text:      '#e2e8f0',
          muted:     '#64748b',
          highlight: '#0ea5e9',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
