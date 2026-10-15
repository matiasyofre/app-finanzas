'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { getSupabase, type ResumenMes } from '@/lib/supabase/client';
import { TX_EVENT } from '@/lib/offlineQueue';
import { money } from '@/lib/format';

export default function MonthDonut() {
  const [rows, setRows] = useState<ResumenMes[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await getSupabase().rpc('get_resumen_mes');
    setRows(((data ?? []) as ResumenMes[]).map((r) => ({ ...r, total: Number(r.total) })));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(TX_EVENT, load);
    return () => window.removeEventListener(TX_EVENT, load);
  }, [load]);

  if (!rows) return <div className="glass h-72 animate-pulse" />;
  const total = rows.reduce((s, r) => s + r.total, 0);

  return (
    <section className="glass animate-rise p-6 [animation-delay:160ms]" aria-labelledby="donut-title">
      <h2 id="donut-title" className="label">Gastos del mes</h2>
      <div className="relative mt-2 h-56">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={rows.length ? rows : [{ categoria: 'Vacío', total: 1, color: 'rgba(255,255,255,.08)' }]}
              dataKey="total"
              nameKey="categoria"
              innerRadius="70%"
              outerRadius="95%"
              paddingAngle={rows.length > 1 ? 3 : 0}
              cornerRadius={8}
              stroke="none"
            >
              {(rows.length ? rows : [{ color: 'rgba(255,255,255,.08)' }]).map((r, i) => (
                <Cell key={i} fill={r.color} />
              ))}
            </Pie>
            {rows.length > 0 && (
              <Tooltip
                formatter={(v: number) => money(v)}
                contentStyle={{ background: 'rgba(19,37,39,.9)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, color: '#F5F2ED' }}
                itemStyle={{ color: '#F5F2ED' }}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-jade">Comprometido</span>
          <span className="num text-2xl font-semibold">{money(total)}</span>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {rows.map((r) => (
          <li key={r.categoria} className="flex items-center gap-3 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
            <span className="flex-1 text-pebble/90">{r.icono} {r.categoria}</span>
            <span className="num text-jade">{total ? Math.round((r.total / total) * 100) : 0}%</span>
            <span className="num w-24 text-right">{money(r.total)}</span>
          </li>
        ))}
        {!rows.length && <li className="text-center text-sm text-jade">Todavía no cargaste gastos este mes. Tocá ＋</li>}
      </ul>
    </section>
  );
}
