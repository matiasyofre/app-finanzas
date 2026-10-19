'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { getSupabase } from '@/lib/supabase/client';
import { TX_EVENT } from '@/lib/offlineQueue';
import { money } from '@/lib/format';
import { useCatalogs, cuentaIcon } from '@/lib/catalogs';
import { todayISO } from '@/lib/cuotas';
import TransactionEditor, { type Transaccion } from './TransactionEditor';

type MovimientoMes = {
  transaccion_id: string;
  descripcion: string;
  monto: number;
  monto_nominal: number;
  categoria_id: string | null;
  cuenta_id: string | null;
  cuenta_nombre: string | null;
  cuenta_tipo: string | null;
  naturaleza: 'fijo' | 'variable' | 'compartido';
  nro_cuota: number;
  cuotas_totales: number;
  porcentaje_propio: number;
  compartido_con: string | null;
  pagado_por: 'yo' | 'otro';
  cuota_saldada: boolean;
};

export default function MonthDonut() {
  const { categorias, cuentas } = useCatalogs();
  const [movimientos, setMovimientos] = useState<MovimientoMes[] | null>(null);
  const [selectedCuenta, setSelectedCuenta] = useState<string>('todas');
  const [selectedNaturaleza, setSelectedNaturaleza] = useState<string>('todas');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<Transaccion | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const currentMonth = `${todayISO().slice(0, 7)}-01`;

    const { data, error } = await sb
      .from('v_cronograma_cuotas')
      .select('*')
      .eq('mes', currentMonth)
      .eq('tipo', 'egreso');

    if (!error && data) {
      setMovimientos(
        data.map((r: any) => ({
          transaccion_id: r.transaccion_id,
          descripcion: r.descripcion,
          monto: Number(r.monto),
          monto_nominal: Number(r.monto_nominal),
          categoria_id: r.categoria_id,
          cuenta_id: r.cuenta_id,
          cuenta_nombre: r.cuenta_nombre,
          cuenta_tipo: r.cuenta_tipo,
          naturaleza: r.naturaleza || 'variable',
          nro_cuota: Number(r.nro_cuota || 1),
          cuotas_totales: Number(r.cuotas_totales || 1),
          porcentaje_propio: Number(r.porcentaje_propio ?? 100),
          compartido_con: r.compartido_con,
          pagado_por: r.pagado_por || 'yo',
          cuota_saldada: Boolean(r.cuota_saldada),
        })),
      );
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(TX_EVENT, load);
    return () => window.removeEventListener(TX_EVENT, load);
  }, [load]);

  const catMap = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  // 1. Filtrar movimientos según cuenta y naturaleza seleccionadas
  const movimientosFiltrados = useMemo(() => {
    if (!movimientos) return [];
    return movimientos.filter((m) => {
      if (selectedCuenta !== 'todas' && m.cuenta_id !== selectedCuenta) return false;
      if (selectedNaturaleza !== 'todas') {
        if (selectedNaturaleza === 'fijo' && m.naturaleza !== 'fijo') return false;
        if (selectedNaturaleza === 'variable' && m.naturaleza !== 'variable') return false;
        if (selectedNaturaleza === 'cuotas' && m.cuotas_totales <= 1) return false;
        if (selectedNaturaleza === 'compartido' && m.naturaleza !== 'compartido') return false;
      }
      return true;
    });
  }, [movimientos, selectedCuenta, selectedNaturaleza]);

  // 2. Agrupar por categoría para el gráfico circular
  const rows = useMemo(() => {
    const map = new Map<string, { categoria: string; color: string; icono: string; total: number; count: number }>();

    for (const m of movimientosFiltrados) {
      const cat = m.categoria_id ? catMap.get(m.categoria_id) : null;
      const catNombre = cat?.nombre ?? 'Sin categoría';
      const catColor = cat?.color ?? '#7A8B8F';
      const catIcono = cat?.icono ?? '📦';

      const existing = map.get(catNombre) ?? {
        categoria: catNombre,
        color: catColor,
        icono: catIcono,
        total: 0,
        count: 0,
      };

      existing.total += m.monto;
      existing.count += 1;
      map.set(catNombre, existing);
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [movimientosFiltrados, catMap]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows]);

  // 3. Movimientos detallados según la categoría seleccionada en el gráfico
  const detalleList = useMemo(() => {
    if (!selectedCat) return movimientosFiltrados;
    return movimientosFiltrados.filter((m) => {
      const cat = m.categoria_id ? catMap.get(m.categoria_id) : null;
      const catNombre = cat?.nombre ?? 'Sin categoría';
      return catNombre === selectedCat;
    });
  }, [movimientosFiltrados, selectedCat, catMap]);

  const handleOpenEdit = async (txId: string) => {
    const sb = getSupabase();
    const { data } = await sb.from('transacciones').select('*').eq('id', txId).single();
    if (data) {
      setEditingTx({
        ...data,
        monto_total: Number(data.monto_total),
        monto_cuota: Number(data.monto_cuota),
        porcentaje_propio: Number(data.porcentaje_propio ?? 100),
        pagado_por: data.pagado_por ?? 'yo',
        saldado: Boolean(data.saldado),
      });
    }
  };

  if (!movimientos) return <div className="glass h-72 animate-pulse" />;

  return (
    <section className="glass animate-rise p-5 sm:p-6 [animation-delay:160ms]" aria-labelledby="donut-title">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
        <div>
          <h2 id="donut-title" className="label">Gastos del mes</h2>
          <p className="text-xs text-jade">Tocá una porción o categoría para ver el desglose exacto abajo</p>
        </div>

        {/* Filtros de Cuenta y Naturaleza */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedCuenta}
            onChange={(e) => {
              setSelectedCuenta(e.target.value);
              setSelectedCat(null);
            }}
            aria-label="Filtrar por cuenta"
            className="rounded-xl border border-white/10 bg-spruce-900/80 px-2.5 py-1.5 text-xs text-pebble focus:outline-none focus:ring-1 focus:ring-teal"
          >
            <option value="todas">💳 Todas las cuentas</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {cuentaIcon(c.tipo)} {c.nombre}
              </option>
            ))}
          </select>

          <select
            value={selectedNaturaleza}
            onChange={(e) => {
              setSelectedNaturaleza(e.target.value);
              setSelectedCat(null);
            }}
            aria-label="Filtrar por tipo de gasto"
            className="rounded-xl border border-white/10 bg-spruce-900/80 px-2.5 py-1.5 text-xs text-pebble focus:outline-none focus:ring-1 focus:ring-teal"
          >
            <option value="todas">Todos los tipos</option>
            <option value="fijo">Fijos (Déb. Aut.)</option>
            <option value="variable">Variables (Contado/QR)</option>
            <option value="cuotas">En cuotas</option>
            <option value="compartido">Compartidos</option>
          </select>
        </div>
      </div>

      {/* Gráfico circular */}
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
              onClick={(entry) => {
                if (entry && entry.categoria && entry.categoria !== 'Vacío') {
                  setSelectedCat(selectedCat === entry.categoria ? null : entry.categoria);
                }
              }}
              cursor="pointer"
            >
              {(rows.length ? rows : [{ categoria: 'Vacío', color: 'rgba(255,255,255,.08)' }]).map((r, i) => (
                <Cell
                  key={i}
                  fill={r.color}
                  opacity={!selectedCat || selectedCat === (r as any).categoria ? 1 : 0.35}
                />
              ))}
            </Pie>
            {rows.length > 0 && (
              <Tooltip
                formatter={(v: number) => money(v)}
                contentStyle={{
                  background: 'rgba(19,37,39,.95)',
                  border: '1px solid rgba(255,255,255,.15)',
                  borderRadius: 16,
                  color: '#F5F2ED',
                }}
                itemStyle={{ color: '#F5F2ED' }}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-jade">
            {selectedCat ? selectedCat : 'Comprometido'}
          </span>
          <span className="num text-2xl font-semibold">
            {money(selectedCat ? (rows.find((r) => r.categoria === selectedCat)?.total ?? 0) : total)}
          </span>
        </div>
      </div>

      {/* Lista de categorías con porcentaje */}
      <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rows.map((r) => {
          const isSelected = selectedCat === r.categoria;
          return (
            <li
              key={r.categoria}
              onClick={() => setSelectedCat(isSelected ? null : r.categoria)}
              className={`flex items-center gap-3 rounded-xl p-2 text-sm cursor-pointer transition ${
                isSelected ? 'bg-white/15 ring-1 ring-white/30' : 'hover:bg-white/5'
              }`}
            >
              <span className="h-3 w-3 rounded-full shrink-0" style={{ background: r.color }} />
              <span className="flex-1 text-pebble truncate">
                {r.icono} {r.categoria}
              </span>
              <span className="num text-xs text-jade">
                {total ? Math.round((r.total / total) * 100) : 0}%
              </span>
              <span className="num font-semibold">{money(r.total)}</span>
            </li>
          );
        })}
        {!rows.length && (
          <li className="col-span-full text-center text-sm text-jade py-4">
            No hay gastos con los filtros seleccionados.
          </li>
        )}
      </ul>

      {/* Detalle dinámico de movimientos según lo seleccionado */}
      <div className="mt-6 pt-4 border-t border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="label text-xs uppercase tracking-wider text-teal">
              {selectedCat ? `Detalle de ${selectedCat}` : 'Detalle de gastos del mes'}
            </span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-pebble">
              {detalleList.length}
            </span>
          </div>
          {selectedCat && (
            <button
              onClick={() => setSelectedCat(null)}
              className="text-xs text-jade hover:text-pebble transition underline"
            >
              Ver todas las categorías
            </button>
          )}
        </div>

        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
          {detalleList.map((m, idx) => {
            const cat = m.categoria_id ? catMap.get(m.categoria_id) : null;
            return (
              <div
                key={`${m.transaccion_id}-${idx}`}
                onClick={() => handleOpenEdit(m.transaccion_id)}
                className="group flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-spruce-900/50 p-2.5 hover:bg-white/10 transition cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm shrink-0">{cat?.icono ?? '📦'}</span>
                    <p className="text-xs font-semibold text-pebble truncate group-hover:text-teal transition">
                      {m.descripcion}
                    </p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-jade">
                    {m.cuenta_nombre && (
                      <span className="rounded bg-white/5 px-1.5 py-0.5">
                        {cuentaIcon((m.cuenta_tipo as any) ?? 'debito')} {m.cuenta_nombre}
                      </span>
                    )}
                    <span className="rounded bg-white/5 px-1.5 py-0.5">
                      {m.cuotas_totales > 1 ? `Cuota ${m.nro_cuota}/${m.cuotas_totales}` : '1 pago'}
                    </span>
                    {m.porcentaje_propio < 100 && (
                      <span className="rounded bg-teal/20 text-teal px-1.5 py-0.5">
                        {m.porcentaje_propio}% propio {m.compartido_con ? `· ${m.compartido_con}` : ''}
                      </span>
                    )}
                    {m.naturaleza === 'fijo' && (
                      <span className="rounded bg-income/20 text-income px-1.5 py-0.5">
                        Fijo
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="num text-sm font-bold text-pebble">-{money(m.monto)}</p>
                  {m.porcentaje_propio < 100 && (
                    <p className="num text-[10px] text-jade line-through">
                      {money(m.monto_nominal)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {!detalleList.length && (
            <p className="text-center text-xs text-jade py-4">
              No hay movimientos para mostrar en esta categoría.
            </p>
          )}
        </div>
      </div>

      {editingTx && (
        <TransactionEditor
          tx={editingTx}
          categorias={categorias}
          cuentas={cuentas}
          onClose={() => setEditingTx(null)}
        />
      )}
    </section>
  );
}
