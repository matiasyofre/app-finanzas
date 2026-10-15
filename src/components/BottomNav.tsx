'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'Mes', icon: 'M3 12l9-8 9 8M5 10v10h14V10' },
  { href: '/movimientos', label: 'Movimientos', icon: 'M4 6h16M4 12h16M4 18h10' },
  { href: '/cuentas', label: 'Cuentas', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
  { href: '/proyecciones', label: 'Proyección', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { href: '/ajustes', label: 'Ajustes', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z' },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-white/10 bg-spruce-900/90 backdrop-blur-xl px-2 py-1.5 pb-[max(0.6rem,env(safe-area-inset-bottom))] shadow-2xl md:bottom-auto md:top-5 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-auto md:justify-center md:gap-1 md:rounded-full md:border md:bg-spruce-800/80 md:px-3 md:py-1.5 md:pb-1.5">
      <div className="hidden items-center gap-2 px-3 py-1 text-sm font-bold tracking-tight text-pebble md:flex">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal to-cyan text-xs text-spruce-900 shadow-glow">
          $
        </span>
        <span>App Finanzas</span>
      </div>
      <div className="hidden h-5 w-px bg-white/10 md:block" />
      {items.map((it) => {
        const active = path === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            id={`nav-${it.label.toLowerCase()}`}
            className={`flex flex-col md:flex-row items-center gap-1 md:gap-2 rounded-xl md:rounded-full px-2.5 py-1 md:px-3.5 md:py-2 text-xs md:text-sm font-medium transition ${
              active
                ? 'bg-teal text-pebble shadow-glow'
                : 'text-jade hover:bg-white/5 hover:text-pebble'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 md:h-4 md:w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d={it.icon} />
            </svg>
            <span className="text-[10px] md:text-xs">{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
