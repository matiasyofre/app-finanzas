'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { flushQueue } from '@/lib/offlineQueue';

/** Login por magic link de Supabase. Si no hay sesión, muestra el formulario. */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
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

  if (session === undefined) return <div className="min-h-dvh" />;
  if (session) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setErr(error.message);
    else setSent(true);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <div className="glass animate-rise p-8">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal to-cyan text-2xl font-bold text-spruce-900 shadow-glow">
          $
        </div>
        <h1 className="text-center text-2xl font-semibold">Cuotas</h1>
        <p className="mt-2 text-center text-jade">Sabé cuánta plata se libera el mes que viene.</p>
        {sent ? (
          <p className="mt-8 rounded-2xl bg-income/10 p-4 text-center text-income">Revisá tu mail ✉️ y tocá el link para entrar.</p>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-3">
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-pebble placeholder:text-jade/70 outline-none focus:border-cyan/60"
            />
            <button id="login-submit" className="btn-primary w-full">Entrar con magic link</button>
            {err && <p className="text-sm text-debt">{err}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
