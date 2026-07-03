/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        jushi: {
          blue: '#0f3d68',
          accent: '#1a73c4'
        }
      }
    }
  },
  plugins: []
}
