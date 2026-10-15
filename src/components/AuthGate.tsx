'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { flushQueue } from '@/lib/offlineQueue';

type AuthMode = 'password' | 'signup' | 'magic';

/** Login con soporte para Email + Contraseña (sin rate limit) y Magic Link opcional. */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [mode, setMode] = useState<AuthMode>('password');
  const [email, setEmail] = useState('');
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

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(null);
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
          setErr('El email aún no fue confirmado. Podés confirmarlo en tu casilla o desde el panel de Supabase.');
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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setLoading(true);

    try {
      const { data, error } = await getSupabase().auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) {
        if (error.message.includes('rate limit')) {
          setErr('Límite de emails de Supabase alcanzado. Podés crear/asignar la contraseña directamente desde el panel de Supabase (Authentication -> Users).');
        } else {
          setErr(error.message);
        }
      } else if (data.session) {
        // Logueado automáticamente (auto-confirm activo)
        setSession(data.session);
      } else {
        setInfo('Cuenta creada. Si tu proyecto de Supabase tiene "Confirm email" activado, confirmalo en tu correo o desde el panel de Supabase.');
      }
    } catch (errCatch: unknown) {
      setErr(errCatch instanceof Error ? errCatch.message : 'Error al registrarse');
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setLoading(true);

    try {
      const { error } = await getSupabase().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });

      if (error) {
        if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
          setErr('Límite de emails por hora alcanzado en Supabase (429). Ingresá con contraseña para acceder de inmediato.');
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
        <h1 className="text-center text-2xl font-semibold text-pebble">Cuotas</h1>
        <p className="mt-2 text-center text-sm text-jade">Sabé cuánta plata se libera el mes que viene.</p>

        {/* Selector de modo */}
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
          <button
            type="button"
            onClick={() => { setMode('signup'); setErr(null); setInfo(null); }}
            className={`flex-1 rounded-lg py-2 font-medium transition ${
              mode === 'signup' ? 'bg-teal text-pebble shadow' : 'text-jade hover:text-pebble'
            }`}
          >
            Crear cuenta
          </button>
        </div>

        {info && (
          <div className="mt-6 rounded-2xl border border-income/30 bg-income/10 p-4 text-center text-sm text-income leading-relaxed">
            {info}
          </div>
        )}

        {/* Formulario según modo */}
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
              className="btn-primary w-full disabled:opacity-50"
            >
              {loading ? 'Ingresando...' : 'Iniciar sesión'}
            </button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignUp} className="mt-6 space-y-3">
            <div>
              <label className="label mb-1.5 block">Email</label>
              <input
                id="signup-email"
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
              <label className="label mb-1.5 block">Contraseña nueva</label>
              <input
                id="signup-password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-pebble placeholder:text-jade/60 outline-none focus:border-cyan/60"
              />
            </div>

            <button
              id="signup-submit"
              type="submit"
              disabled={loading}
              className="btn-primary w-full disabled:opacity-50"
            >
              {loading ? 'Creando cuenta...' : 'Crear mi cuenta'}
            </button>
          </form>
        )}

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
                placeholder="tu@email.com"
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
            {mode === 'password' ? (
              <span>
                ¿Sin contraseña? Usá la pestaña <strong>Magic Link</strong> o asignate una en tu panel de Supabase.
              </span>
            ) : mode === 'magic' ? (
              <span>
                ¿Tenés error 429 de límite? Entrá con tu <strong>Contraseña</strong>.
              </span>
            ) : (
              <span>
                ¿Ya tenés cuenta? Cambiá a la pestaña <strong>Contraseña</strong>.
              </span>
            )}
          </p>
        </div>
      </div>
    </main>
  );
}
