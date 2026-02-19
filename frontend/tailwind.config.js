/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Discord-inspired palette
        discord: {
          bg: '#36393f',
          sidebar: '#2f3136',
          channels: '#2f3136',
          servers: '#202225',
          input: '#40444b',
          text: '#dcddde',
          muted: '#72767d',
          mention: '#7289da',
          online: '#3ba55c',
          idle: '#faa61a',
          dnd: '#ed4245',
          offline: '#737f8d',
        },
      },
    },
  },
  plugins: [],
}
