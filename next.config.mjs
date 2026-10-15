import withPWAInit from '@ducanh2912/next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  fallbacks: { document: '/offline' },
  workboxOptions: {
    runtimeCaching: [
      {
        // Lecturas de Supabase (PostgREST/RPC): red primero, caché si no hay conexión
        urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/'),
        handler: 'NetworkFirst',
        method: 'GET',
        options: { cacheName: 'supabase-rest', networkTimeoutSeconds: 4, expiration: { maxEntries: 100, maxAgeSeconds: 86400 } },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };

export default withPWA(nextConfig);
