'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { flushQueue } from '@/lib/offlineQueue';

const ALLOWED_EMAIL = 'matiyofre@gmail.com';

/** Pantalla de inicio de sesión minimalista con Email y Contraseña. */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    const onOnline = () => flushQueue();
    window.addEventListener('online', onOnline);
    flushQueue();
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('online', onOnline);
    };
  }, []);

  if (session === undefined) return <div className="min-h-dvh bg-spruce-900" />;
  if (session) return <>{children}</>;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    // Validación interna silenciosa
    if (email.trim().toLowerCase() !== ALLOWED_EMAIL) {
      setErr('Credenciales incorrectas.');
      return;
    }

    setLoading(true);

    try {
      const { error } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setErr('Credenciales incorrectas. Verificá tu email y contraseña.');
        } else if (error.message.includes('Email not confirmed')) {
          setErr('El email aún no fue confirmado.');
        } else {
          setErr(error.message);
        }
      }
    } catch (errCatch: unknown) {
      setErr(errCatch instanceof Error ? errCatch.message : 'Error al iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="glass animate-rise p-8">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal to-cyan text-2xl font-bold text-spruce-900 shadow-glow">
          $
        </div>
        <h1 className="text-center text-2xl font-semibold text-pebble">App Finanzas</h1>
        <p className="mt-2 text-center text-sm text-jade">Control de gastos, cuotas y cuentas bancarias.</p>

        <form onSubmit={handleLogin} className="mt-8 space-y-4">
          <div>
            <label className="label mb-1.5 block">Email</label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-pebble placeholder:text-jade/60 outline-none focus:border-cyan/60"
            />
          </div>
          <div>
            <label className="label mb-1.5 block">Contraseña</label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-pebble placeholder:text-jade/60 outline-none focus:border-cyan/60"
            />
          </div>

          <button
            id="login-submit"
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3.5 font-semibold disabled:opacity-50"
          >
            {loading ? 'Ingresando...' : 'Iniciar sesión'}
          </button>
        </form>

        {err && (
          <div className="mt-4 rounded-xl border border-debt/40 bg-debt/10 p-3 text-center text-sm text-debt leading-tight">
            {err}
          </div>
        )}
      </div>
    </main>
  );
}
