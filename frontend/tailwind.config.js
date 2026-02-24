/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Discord-inspired palette
        discord: {
          bg: '#313338', // Main chat background
          sidebar: '#1e1f22', // Legacy sidebar (likely server rail)
          server: '#1e1f22', // Server list rail
          servers: '#1e1f22', // Server list rail (compat)
          channels: '#2b2d31', // Channel list background
          user: '#232428', // User panel at bottom
          input: '#383a40', // Chat input background
          'input-text': '#dbdee1',
          text: '#f2f3f5', // Primary text
          muted: '#949ba4', // Secondary text
          mention: '#5865f2', // Brand color
          online: '#23a559',
          idle: '#f0b132',
          dnd: '#f23f43',
          offline: '#80848e',
          hover: '#3f4147', // Generic hover
          'channel-hover': '#35373c',
          divider: '#1e1f22', // Splitters
          popup: '#111214', // Tooltips/Popups
          danger: '#da373c',
        },
      },
    },
  },
  plugins: [],
}
