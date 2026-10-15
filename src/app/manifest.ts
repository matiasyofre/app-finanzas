import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'App Finanzas · Finanzas personales',
    short_name: 'App Finanzas',
    description: 'Control de finanzas personales, cuotas, cuentas y proyección de cashflow.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#1F3A3D',
    theme_color: '#1F3A3D',
    lang: 'es-AR',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [{ name: 'Cargar gasto', url: '/?add=1' }],
  };
}
