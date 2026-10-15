'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase, type CashflowDelta } from '@/lib/supabase/client';
import { TX_EVENT } from '@/lib/offlineQueue';
import { money, monthLabel } from '@/lib/format';

/**
 * Widget "Alivio Financiero".
 * Consume el RPC `get_cashflow_delta` (una sola consulta agregada en Postgres).
 *   delta < 0 -> "Se liberan $X"      (verde, cuotas que terminan)
 *   delta > 0 -> "Se sumaron -$Y"     (terracota, nueva deuda)
 */
export default function AlivioFinancieroWidget() {
  const [data, setData] = useState<CashflowDelta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc('get_cashflow_delta').single<CashflowDelta>();
    if (error) setError(error.message);
    else { setError(null); setData(data); }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(TX_EVENT, load);
    return () => window.removeEventListener(TX_EVENT, load);
  }, [load]);

  if (error) return <div className="glass p-6 text-sm text-debt">No se pudo calcular el delta: {error}</div>;
  if (!data) return <div className="glass h-52 animate-pulse" />;

  const delta = Number(data.delta);
  const alivio = delta <= 0;
  const abs = Math.abs(delta);
  const actual = Number(data.comprometido_actual);
  const siguiente = Number(data.comprometido_siguiente);
  const pct = actual > 0 ? Math.min(100, (siguiente / actual) * 100) : siguiente > 0 ? 100 : 0;
  const mesSig = monthLabel(data.mes_siguiente, { month: 'long' });

  return (
    <article
      id="widget-alivio"
      className={`glass relative animate-rise overflow-hidden p-6 [animation-delay:80ms] ${alivio ? 'ring-1 ring-income/20' : 'ring-1 ring-debt/20'}`}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl ${alivio ? 'bg-income/25' : 'bg-debt/25'}`}
      />
      <div className="flex items-center justify-between">
        <p className="label">Alivio financiero · {mesSig}</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${alivio ? 'bg-income/15 text-income' : 'bg-debt/15 text-debt'}`}>
          {alivio ? '▼ menos cuotas' : '▲ más cuotas'}
        </span>
      </div>

      <p className="mt-4 text-sm text-jade">{abs === 0 ? 'Sin cambios' : alivio ? 'Se liberan' : 'Se sumaron'}</p>
      <p className={`num text-5xl font-semibold tracking-tight ${alivio ? 'text-income' : 'text-debt'}`}>
        {alivio ? '' : '-'}
        {money(abs)}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-jade">Terminan</p>
          <p className="num font-medium text-income">+{money(Number(data.liberado))}</p>
          <p className="text-xs text-jade">{data.cuotas_que_terminan} plan{data.cuotas_que_terminan === 1 ? '' : 'es'}</p>
        </div>
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-jade">Deuda nueva</p>
          <p className="num font-medium text-debt">-{money(Number(data.nueva_deuda))}</p>
          <p className="text-xs text-jade">arranca en {mesSig}</p>
        </div>
      </div>

      {/* Barra comparativa mes actual vs siguiente */}
      <div className="mt-5">
        <div className="flex justify-between text-xs text-jade">
          <span>Este mes {money(actual)}</span>
          <span>{mesSig} {money(siguiente)}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ${alivio ? 'bg-gradient-to-r from-teal to-income' : 'bg-gradient-to-r from-teal to-debt'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </article>
  );
}
