import type { Metadata, Viewport } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';
import QuickAddFab from '@/components/QuickAddFab';
import AuthGate from '@/components/AuthGate';
import BottomNav from '@/components/BottomNav';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap' });

export const metadata: Metadata = {
  title: 'Cuotas · Control de gastos y proyección de cashflow',
  description: 'Cargá gastos en cuotas en segundos y mirá cuánta plata se libera el mes que viene.',
  applicationName: 'Cuotas',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Cuotas' },
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
