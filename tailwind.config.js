/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        spruce: {
          DEFAULT: '#1F3A3D', // Slate Spruce – fondo principal
          900: '#132527',
          800: '#1F3A3D',
          700: '#2A4B4F',
        },
        pebble: '#F5F2ED', // Pebble Greige – títulos
        jade: '#7A8B8F', // Muted Jade – texto secundario
        teal: { DEFAULT: '#0F766E', 400: '#14958B' }, // Acento / botones
        cyan: { DEFAULT: '#22D3EE' }, // Acento brillante
        income: '#25D366', // Verde WhatsApp – ingresos / plata liberada
        debt: '#C98B6D', // Terracotta Clay – egresos / nueva deuda
      },
      fontFamily: {
        sans: ['var(--font-outfit)', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'app-gradient':
          'radial-gradient(1200px 600px at 10% -10%, rgba(34,211,238,.18), transparent 60%), radial-gradient(900px 500px at 110% 10%, rgba(15,118,110,.35), transparent 60%), linear-gradient(180deg, #1F3A3D 0%, #132527 100%)',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06)',
        glow: '0 0 0 1px rgba(34,211,238,.35), 0 10px 30px rgba(34,211,238,.35)',
      },
      keyframes: {
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        rise: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: {
        'sheet-up': 'sheet-up .32s cubic-bezier(.2,.9,.3,1)',
        'fade-in': 'fade-in .2s ease-out',
        rise: 'rise .5s cubic-bezier(.2,.9,.3,1) both',
      },
    },
  },
  plugins: [],
};
