/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['selector', '[data-theme="dark"], [data-theme="cyber"]'],
  theme: {
    extend: {}
  },
  plugins: []
}
