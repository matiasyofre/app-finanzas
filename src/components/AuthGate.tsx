'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { flushQueue } from '@/lib/offlineQueue';

type AuthMode = 'password' | 'magic';

const ALLOWED_EMAIL = 'matiyofre@gmail.com';

/** Login exclusivo para matiyofre@gmail.com con soporte para contraseña y magic link. */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [mode, setMode] = useState<AuthMode>('password');
  const [email, setEmail] = useState(ALLOWED_EMAIL);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
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

  const checkAllowed = (targetEmail: string): boolean => {
    if (targetEmail.trim().toLowerCase() !== ALLOWED_EMAIL) {
      setErr(`Acceso restringido: Esta aplicación es privada y de uso exclusivo para ${ALLOWED_EMAIL}.`);
      return false;
    }
    return true;
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    if (!checkAllowed(email)) return;
    setLoading(true);

    try {
      const { error } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setErr('Credenciales incorrectas. Verificá tu contraseña.');
        } else if (error.message.includes('Email not confirmed')) {
          setErr('El email aún no fue confirmado. Podés confirmarlo desde el panel de Supabase.');
        } else {
          setErr(error.message);
        }
      }
    } catch (errCatch: unknown) {
      setErr(errCatch instanceof Error ? errCatch.message : 'Error inesperado al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    if (!checkAllowed(email)) return;
    setLoading(true);

    try {
      const { error } = await getSupabase().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });

      if (error) {
        if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
          setErr('Límite de emails alcanzado en Supabase (429). Ingresá con contraseña para acceder de inmediato.');
        } else {
          setErr(error.message);
        }
      } else {
        setInfo('¡Enlace enviado! ✉️ Revisá tu casilla de correo y tocá el link para ingresar.');
      }
    } catch (errCatch: unknown) {
      setErr(errCatch instanceof Error ? errCatch.message : 'Error al enviar enlace');
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

        {/* Selector de modo (Contraseña o Magic Link) */}
        <div className="mt-6 flex rounded-xl bg-white/5 p-1 text-xs">
          <button
            type="button"
            onClick={() => { setMode('password'); setErr(null); setInfo(null); }}
            className={`flex-1 rounded-lg py-2 font-medium transition ${
              mode === 'password' ? 'bg-teal text-pebble shadow' : 'text-jade hover:text-pebble'
            }`}
          >
            Contraseña
          </button>
          <button
            type="button"
            onClick={() => { setMode('magic'); setErr(null); setInfo(null); }}
            className={`flex-1 rounded-lg py-2 font-medium transition ${
              mode === 'magic' ? 'bg-teal text-pebble shadow' : 'text-jade hover:text-pebble'
            }`}
          >
            Magic Link
          </button>
        </div>

        {info && (
          <div className="mt-6 rounded-2xl border border-income/30 bg-income/10 p-4 text-center text-sm text-income leading-relaxed">
            {info}
          </div>
        )}

        {/* Formulario con contraseña */}
        {mode === 'password' && (
          <form onSubmit={handlePasswordLogin} className="mt-6 space-y-3">
            <div>
              <label className="label mb-1.5 block">Email</label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="matiyofre@gmail.com"
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
              className="btn-primary w-full disabled:opacity-50"
            >
              {loading ? 'Ingresando...' : 'Iniciar sesión'}
            </button>
          </form>
        )}

        {/* Formulario con Magic Link */}
        {mode === 'magic' && (
          <form onSubmit={handleMagicLink} className="mt-6 space-y-3">
            <div>
              <label className="label mb-1.5 block">Email para enlace de acceso</label>
              <input
                id="magic-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="matiyofre@gmail.com"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-pebble placeholder:text-jade/60 outline-none focus:border-cyan/60"
              />
            </div>

            <button
              id="magic-submit"
              type="submit"
              disabled={loading}
              className="btn-primary w-full disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Enviar enlace mágico'}
            </button>
          </form>
        )}

        {err && (
          <div className="mt-4 rounded-xl border border-debt/40 bg-debt/10 p-3 text-center text-sm text-debt leading-tight">
            {err}
          </div>
        )}

        <div className="mt-6 border-t border-white/5 pt-4 text-center">
          <p className="text-xs text-jade/70">
            🔒 Acceso restringido exclusivamente a <strong>matiyofre@gmail.com</strong>
          </p>
        </div>
      </div>
    </main>
  );
}
