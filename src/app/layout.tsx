import type { Metadata, Viewport } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';
import QuickAddFab from '@/components/QuickAddFab';
import AuthGate from '@/components/AuthGate';
import BottomNav from '@/components/BottomNav';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap' });

export const metadata: Metadata = {
  title: 'App Finanzas · Control de gastos, cuotas y cuentas',
  description: 'Gestión inteligente de finanzas personales, cuotas, cuentas bancarias y proyección de cashflow.',
  applicationName: 'App Finanzas',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'App Finanzas' },
};

export const viewport: Viewport = {
  themeColor: '#1F3A3D',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`dark ${outfit.variable}`}>
      <body className="font-sans">
        <AuthGate>
          <BottomNav />
          <main className="mx-auto w-full max-w-md px-4 pb-36 pt-[max(1.25rem,env(safe-area-inset-top))] md:max-w-5xl md:px-8 md:pt-24 lg:max-w-7xl">
            {children}
          </main>
          <QuickAddFab />
        </AuthGate>
      </body>
    </html>
  );
}
