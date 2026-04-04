/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0f172a',
        surface: '#1e293b',
        border: '#334155',
        'text-primary': '#f8fafc',
        'text-secondary': '#94a3b8',
        yes: '#22c55e',
        no: '#ef4444',
        accent: '#3b82f6',
      },
    },
  },
  plugins: [],
}
