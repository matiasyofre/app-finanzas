'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getSupabase, type WaterfallRow } from '@/lib/supabase/client';
import { TX_EVENT } from '@/lib/offlineQueue';
import { compact, money, monthLabel } from '@/lib/format';

const GREEN = '#25D366';
const CLAY = '#C98B6D';
const TEAL = '#0F766E';

type WBar = { label: string; base: number; value: number; color: string; row: WaterfallRow; kind: 'start' | 'delta' };

/**
 * Cascada a 12 meses. Barra inicial = comprometido actual; cada mes siguiente es un
 * tramo flotante (base invisible + |delta|): verde si baja (se libera), terracota si sube.
 */
export default function WaterfallChart() {
  const [rows, setRows] = useState<WaterfallRow[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await getSupabase().rpc('get_proyeccion_waterfall', { p_meses: 12 });
    setRows(
      ((data ?? []) as WaterfallRow[]).map((r) => ({
        ...r,
        comprometido: Number(r.comprometido),
        liberado: Number(r.liberado),
        nueva_deuda: Number(r.nueva_deuda),
        delta: Number(r.delta),
      })),
    );
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(TX_EVENT, load);
    return () => window.removeEventListener(TX_EVENT, load);
  }, [load]);

  const bars = useMemo<WBar[]>(() => {
    if (!rows?.length) return [];
    return rows.map((r, i) => {
      if (i === 0) return { label: 'Hoy', base: 0, value: r.comprometido, color: TEAL, row: r, kind: 'start' };
      const prev = rows[i - 1].comprometido;
      return {
        label: monthLabel(r.mes),
        base: Math.min(prev, r.comprometido),
        value: Math.abs(r.delta),
        color: r.delta <= 0 ? GREEN : CLAY,
        row: r,
        kind: 'delta',
      };
    });
  }, [rows]);

  if (!rows) return <div className="glass h-96 animate-pulse" />;

  const totalLiberado = rows.slice(1).reduce((s, r) => s + Math.max(0, -r.delta), 0);
  const totalNuevo = rows.slice(1).reduce((s, r) => s + Math.max(0, r.delta), 0);

  return (
    <>
      <section className="glass animate-rise p-5" aria-labelledby="wf-title">
        <h2 id="wf-title" className="label">VariaciÃ³n neta mensual de cuotas</h2>
        <div className="mt-4 h-72">
          <ResponsiveContainer>
            <BarChart data={bars} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={compact} tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,.1)" />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,.04)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const b = payload[0].payload as WBar;
                  return (
                    <div className="glass-strong rounded-2xl px-4 py-3 text-sm">
                      <p className="font-medium capitalize">{monthLabel(b.row.mes, { month: 'long', year: 'numeric' })}</p>
                      <p className="num text-jade">Comprometido {money(b.row.comprometido)}</p>
                      {b.kind === 'delta' && (
                        <>
                          <p className="num text-income">Se libera {money(b.row.liberado)}</p>
                          <p className="num text-debt">Deuda nueva {money(b.row.nueva_deuda)}</p>
                          <p className="num mt-1 font-medium" style={{ color: b.color }}>
                            Neto {b.row.delta <= 0 ? '+' : '-'}{money(Math.abs(b.row.delta))}
                          </p>
                        </>
                      )}
                    </div>
                  );
                }}
              />
              <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
              <Bar dataKey="value" stackId="w" radius={[6, 6, 6, 6]} animationDuration={900}>
                {bars.map((b, i) => (
                  <Cell key={i} fill={b.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex justify-center gap-5 text-xs text-jade">
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-income" /> Se libera</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-debt" /> Deuda nueva</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-teal" /> Hoy</span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <div className="glass animate-rise p-4 [animation-delay:100ms]">
          <p className="label">LiberÃ¡s en 12m</p>
          <p className="num mt-1 text-2xl font-semibold text-income">{money(totalLiberado)}</p>
        </div>
        <div className="glass animate-rise p-4 [animation-delay:160ms]">
          <p className="label">Deuda futura</p>
          <p className="num mt-1 text-2xl font-semibold text-debt">{money(totalNuevo)}</p>
        </div>
      </div>
    </>
  );
}
