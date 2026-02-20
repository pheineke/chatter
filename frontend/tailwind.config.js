/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Discord-inspired palette
        discord: {
          bg: '#313338',
          sidebar: '#1e1f22',
          channels: '#1e1f22',
          servers: '#111214',
          input: '#383a40',
          text: '#f2f3f5',
          muted: '#949ba4',
          mention: '#5865f2',
          online: '#23a55a',
          idle: '#f0b132',
          dnd: '#f23f43',
          offline: '#80848e',
        },
      },
    },
  },
  plugins: [],
}
