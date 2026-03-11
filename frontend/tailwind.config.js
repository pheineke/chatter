/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Soft Pop – pastel light palette
        sp: {
          bg: '#FFFBFE',           // warm cream – outer app bg
          sidebar: '#F7F2FA',      // surface-variant-like for sidebars
          server: '#E7E0EC',       // rail background (surface variant)
          servers: '#E7E0EC',      // compat alias
          channels: '#FFFBFE',     // channel list background
          user: '#FFFBFE',         // user panel card
          input: '#E7E0EC',        // surface variant for inputs
          'input-text': '#1C1B1F',
          text: '#1C1B1F',         // deep charcoal – primary readable text
          muted: '#49454F',        // medium purple-grey – secondary text
          mention: '#6750A4',      // primary – accent / CTA
          online: '#B8F397',       // Pastel Green
          idle: '#FFE082',
          dnd: '#FF8A80',
          offline: '#79747E',
          hover: '#E8DEF8',        // secondary container
          'channel-hover': '#E8DEF8',
          divider: '#79747E',      // outline
          popup: '#FFFBFE',        // surface
          danger: '#BA1A1A',
          primary: '#6750A4',      // primary
          'primary-container': '#EADDFF',
          'on-primary': '#FFFFFF',
          'on-primary-container': '#21005D',
          'surface-variant': '#E7E0EC',
        },
      },
      borderRadius: {
        // Soft Pop radius scale – generous curves everywhere
        'sp-xs': '2px',
        'sp-sm': '4px',
        'sp-md': '6px',
        'sp-lg': '8px',
        'sp-xl': '12px',
        'sp-full': '9999px',
        // keep m3 aliases so old refs don't break
        'm3-sm': '3px',
        'm3-md': '5px',
        'm3-lg': '7px',
        'm3-xl': '10px',
      },
      boxShadow: {
        // Soft Pop – light, warm-tinted shadows
        'sp-1': '0 2px 8px rgba(124,77,255,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        'sp-2': '0 4px 16px rgba(124,77,255,0.12), 0 2px 4px rgba(0,0,0,0.08)',
        'sp-3': '0 8px 28px rgba(124,77,255,0.16), 0 3px 8px rgba(0,0,0,0.10)',
        'sp-4': '0 16px 48px rgba(124,77,255,0.20), 0 6px 16px rgba(0,0,0,0.12)',
        // keep m3 aliases
        'm3-1': '0 2px 8px rgba(124,77,255,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        'm3-2': '0 4px 16px rgba(124,77,255,0.12), 0 2px 4px rgba(0,0,0,0.08)',
        'm3-3': '0 8px 28px rgba(124,77,255,0.16), 0 3px 8px rgba(0,0,0,0.10)',
        'm3-4': '0 16px 48px rgba(124,77,255,0.20), 0 6px 16px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
}
