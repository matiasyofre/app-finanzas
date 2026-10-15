'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { notifyChange, TX_EVENT } from '@/lib/offlineQueue';
import { cuentaIcon, useCatalogs } from '@/lib/catalogs';
import { monthDiff, todayISO } from '@/lib/cuotas';
import { money } from '@/lib/format';
import TransactionEditor, { type Transaccion } from './TransactionEditor';
import ExcelManager from './ExcelManager';

type Filtro = 'todos' | 'activos' | 'pendientes' | 'saldados' | 'fijo' | 'variable' | 'compartido' | 'egreso' | 'ingreso';

const fmtDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });

function progreso(t: Transaccion) {
  const nowYM = todayISO().slice(0, 7);
  const cur = t.cuota_actual + monthDiff(t.fecha_primera_cuota.slice(0, 7), nowYM);
  if (cur < t.cuota_actual) return { label: 'Pendiente', cur: t.cuota_actual - 1, state: 'pend' as const };
  if (cur > t.cuotas_totales) return { label: 'Finalizada', cur: t.cuotas_totales, state: 'fin' as const };
  return { label: `${cur}/${t.cuotas_totales}`, cur, state: 'act' as const };
}

export default function MovimientosGrid() {
  const { categorias, cuentas } = useCatalogs();
  const [rows, setRows] = useState<Transaccion[] | null>(null);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [editing, setEditing] = useState<Transaccion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('transacciones')
      .select('id,tipo,naturaleza,porcentaje_propio,pagado_por,compartido_con,saldado,fecha_saldado,es_recurrente,descripcion,monto_total,monto_cuota,cuotas_totales,cuota_actual,fecha_compra,fecha_primera_cuota,categoria_id,cuenta_id')
      .order('fecha_compra', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return setError(error.message);
    setRows(
      ((data ?? []) as Transaccion[]).map((r) => ({
        ...r,
        monto_total: Number(r.monto_total),
        monto_cuota: Number(r.monto_cuota),
        porcentaje_propio: Number(r.porcentaje_propio ?? 100),
        pagado_por: r.pagado_por ?? 'yo',
        saldado: Boolean(r.saldado),
      })),
    );
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(TX_EVENT, load);
    return () => window.removeEventListener(TX_EVENT, load);
  }, [load]);

  const catMap = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const ctaMap = useMemo(() => new Map(cuentas.map((c) => [c.id, c])), [cuentas]);

  const toggleSaldadoRapido = async (t: Transaccion, e: React.MouseEvent) => {
    e.stopPropagation();
    const nuevoSaldado = !t.saldado;
    setRows((prev) =>
      prev ? prev.map((x) => (x.id === t.id ? { ...x, saldado: nuevoSaldado } : x)) : prev,
    );

    const { error } = await getSupabase()
      .from('transacciones')
      .update({
        saldado: nuevoSaldado,
        fecha_saldado: nuevoSaldado ? todayISO() : null,
      })
      .eq('id', t.id);

    if (error) {
      load();
    } else {
      notifyChange();
    }
  };

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((t) => {
      if (filtro === 'egreso' || filtro === 'ingreso') {
        if (t.tipo !== filtro) return false;
      } else if (filtro === 'fijo') {
        if (t.naturaleza !== 'fijo') return false;
      } else if (filtro === 'variable') {
        if (t.naturaleza !== 'variable') return false;
      } else if (filtro === 'compartido') {
        if (t.naturaleza !== 'compartido') return false;
      } else if (filtro === 'activos') {
        if (t.cuotas_totales === 1 || progreso(t).state === 'fin') return false;
      } else if (filtro === 'pendientes') {
        if (t.saldado) return false;
      } else if (filtro === 'saldados') {
        if (!t.saldado) return false;
      }

      if (!s) return true;
      const cat = t.categoria_id ? catMap.get(t.categoria_id)?.nombre ?? '' : '';
      const cta = t.cuenta_id ? ctaMap.get(t.cuenta_id)?.nombre ?? '' : '';
      const comp = t.compartido_con ?? '';
      return `${t.descripcion} ${cat} ${cta} ${comp}`.toLowerCase().includes(s);
    });
  }, [rows, q, filtro, catMap, ctaMap]);

  // Totales calculados con el impacto real
  const stats = useMemo(() => {
    if (!rows) return { totalEgresos: 0, totalIngresos: 0, fijos: 0, compartidos: 0, pendientesCobro: 0, pendientesPago: 0 };
    let totalEgresos = 0;
    let totalIngresos = 0;
    let fijos = 0;
    let compartidos = 0;
    let pendientesCobro = 0;
    let pendientesPago = 0;

    for (const t of rows) {
      const partePropia = t.naturaleza === 'compartido' ? (t.monto_total * ((t.porcentaje_propio ?? 50) / 100)) : t.monto_total;
      if (t.tipo === 'ingreso') {
        totalIngresos += t.monto_total;
      } else {
        totalEgresos += partePropia;
        if (t.naturaleza === 'fijo') fijos += partePropia;
        if (t.naturaleza === 'compartido') {
          compartidos += partePropia;
          if (!t.saldado) {
            if (t.pagado_por === 'yo') {
              pendientesCobro += (t.monto_total - partePropia);
            } else {
              pendientesPago += partePropia;
            }
          }
        }
      }
    }
    return { totalEgresos, totalIngresos, fijos, compartidos, pendientesCobro, pendientesPago };
  }, [rows]);

  const totalVisibleReal = visibles.reduce((s, t) => {
    const parte = t.naturaleza === 'compartido' ? (t.monto_total * ((t.porcentaje_propio ?? 50) / 100)) : t.monto_total;
    return s + (t.tipo === 'egreso' ? -parte : t.monto_total);
  }, 0);

  if (error) return <div className="glass p-6 text-sm text-debt">{error}</div>;

  return (
    <div className="space-y-5">
      {/* Tarjetas resumen superiores */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass animate-rise p-4">
          <p className="label text-[11px]">Egresos propios</p>
          <p className="num mt-1 text-2xl font-bold text-debt">-{money(stats.totalEgresos)}</p>
          <p className="text-[11px] text-jade">calculado con tu parte real</p>
        </div>
        <div className="glass animate-rise p-4 [animation-delay:60ms]">
          <p className="label text-[11px]">Ingresos</p>
          <p className="num mt-1 text-2xl font-bold text-income">+{money(stats.totalIngresos)}</p>
          <p className="text-[11px] text-jade">total ingresado</p>
        </div>
        <div className="glass animate-rise p-4 [animation-delay:120ms]">
          <p className="label text-[11px]">Te deben (Pendiente)</p>
          <p className="num mt-1 text-2xl font-bold text-income">
            {stats.pendientesCobro > 0 ? `+${money(stats.pendientesCobro)}` : '$0'}
          </p>
          <p className="text-[11px] text-jade">por gastos que pagaste vos</p>
        </div>
        <div className="glass animate-rise p-4 [animation-delay:180ms]">
          <p className="label text-[11px]">Debés (Pendiente)</p>
          <p className="num mt-1 text-2xl font-bold text-debt">
            {stats.pendientesPago > 0 ? `-${money(stats.pendientesPago)}` : '$0'}
          </p>
          <p className="text-[11px] text-jade">por gastos que pagó otro</p>
        </div>
      </div>

      {/* Buscador y filtros de píldora con Importación/Plantilla Excel */}
      <div className="glass animate-rise space-y-3 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <input
              id="mov-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por descripción, categoría, tarjeta o compartido con…"
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-4 pr-10 text-pebble placeholder:text-jade/60 outline-none focus:border-cyan/60"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-jade hover:text-pebble"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 md:justify-end">
            <ExcelManager />
            <span className="text-xs text-jade whitespace-nowrap">
              {visibles.length} de {rows?.length ?? 0}
            </span>
          </div>
        </div>

        <div className="no-scrollbar flex gap-2 overflow-x-auto pt-1">
          {(
            [
              ['todos', 'Todos'],
              ['pendientes', '⏳ Pendientes'],
              ['saldados', '✓ Saldados'],
              ['activos', 'Cuotas activas'],
              ['fijo', '📌 Fijos'],
              ['variable', '⚡ Variables'],
              ['compartido', '👥 Compartidos'],
              ['egreso', 'Egresos'],
              ['ingreso', 'Ingresos'],
            ] as [Filtro, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              id={`filtro-${k}`}
              onClick={() => setFiltro(k)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition md:text-sm ${
                filtro === k
                  ? 'bg-teal text-pebble shadow-glow font-semibold'
                  : 'bg-white/5 text-jade hover:bg-white/10 hover:text-pebble'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* VISTA 1: TABLA EXPANSIVA PARA PC */}
      <div className="glass hidden overflow-hidden md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-jade">
              <th className="px-5 py-3.5 font-medium">Fecha</th>
              <th className="px-4 py-3.5 font-medium">Descripción</th>
              <th className="px-4 py-3.5 font-medium">Naturaleza</th>
              <th className="px-4 py-3.5 font-medium">Categoría</th>
              <th className="px-4 py-3.5 font-medium">Cuenta / Tarjeta</th>
              <th className="px-4 py-3.5 text-center font-medium">Cuotas</th>
              <th className="px-4 py-3.5 text-right font-medium">Monto</th>
              <th className="px-4 py-3.5 text-center font-medium">Liquidación</th>
              <th className="px-3 py-3.5 text-center font-medium">Editar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {!rows &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={9} className="px-5 py-4">
                    <div className="h-6 animate-pulse rounded bg-white/5" />
                  </td>
                </tr>
              ))}

            {visibles.map((t) => {
              const cat = t.categoria_id ? catMap.get(t.categoria_id) : undefined;
              const cta = t.cuenta_id ? ctaMap.get(t.cuenta_id) : undefined;
              const p = progreso(t);
              const color = t.tipo === 'ingreso' ? 'text-income' : 'text-debt';
              const esComp = t.naturaleza === 'compartido';
              const miParte = esComp ? t.monto_total * ((t.porcentaje_propio ?? 50) / 100) : t.monto_total;

              return (
                <tr
                  key={t.id}
                  id={`mov-${t.id}`}
                  onClick={() => setEditing(t)}
                  className={`cursor-pointer transition hover:bg-white/[0.06] ${t.saldado ? 'opacity-70' : ''}`}
                  title="Tocá para editar"
                >
                  <td className="num whitespace-nowrap px-5 py-3.5 text-xs text-jade">
                    {fmtDate(t.fecha_compra)}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3.5 font-medium text-pebble">
                    {t.descripcion}
                    {esComp && t.compartido_con && (
                      <span className="ml-2 text-xs font-normal text-amber-300/80">
                        (con {t.compartido_con})
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-xs">
                    {t.naturaleza === 'fijo' ? (
                      <span className="rounded-full bg-cyan/15 px-2.5 py-1 font-medium text-cyan">
                        📌 Fijo
                      </span>
                    ) : esComp ? (
                      <span className="rounded-full bg-amber-500/20 px-2.5 py-1 font-medium text-amber-300">
                        👥 {t.porcentaje_propio ?? 50}%
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-jade">
                        ⚡ Variable
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5">
                    {cat ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs"
                        style={{ background: `${cat.color}22`, color: cat.color }}
                      >
                        <span>{cat.icono}</span>
                        <span>{cat.nombre}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-jade/50">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-xs text-pebble/80">
                    {cta ? `${cuentaIcon(cta.tipo)} ${cta.nombre}` : <span className="text-jade/50">—</span>}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    {t.cuotas_totales === 1 ? (
                      <span className="text-xs text-jade">1x</span>
                    ) : (
                      <div className="mx-auto w-24">
                        <span
                          className={`num text-xs font-medium ${
                            p.state === 'fin'
                              ? 'text-income'
                              : p.state === 'pend'
                              ? 'text-cyan'
                              : 'text-pebble'
                          }`}
                        >
                          {p.label}
                        </span>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-cyan"
                            style={{ width: `${(p.cur / t.cuotas_totales) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-right">
                    <p className={`num font-semibold ${color}`}>
                      {t.tipo === 'egreso' ? '-' : '+'}{money(t.monto_total)}
                    </p>
                    {esComp && !t.saldado && (
                      <p className="num text-[11px] text-amber-300">
                        {t.pagado_por === 'yo' ? (
                          <span>Tu parte: {money(miParte)} · <strong className="text-income">Te deben {money(t.monto_total - miParte)}</strong></span>
                        ) : (
                          <span><strong className="text-debt">Debés: {money(miParte)}</strong></span>
                        )}
                      </p>
                    )}
                  </td>
                  {/* ESTADO DE LIQUIDACIÓN Y BOTÓN RÁPIDO */}
                  <td className="px-4 py-3.5 text-center whitespace-nowrap">
                    {t.saldado ? (
                      <button
                        type="button"
                        onClick={(e) => toggleSaldadoRapido(t, e)}
                        className="rounded-full bg-income/15 border border-income/30 px-2.5 py-1 text-xs font-medium text-income hover:bg-income/25 transition"
                        title="Tocá para volver a marcar como pendiente"
                      >
                        {esComp ? (t.pagado_por === 'yo' ? '✓ Cobrado' : '✓ Pagado') : '✓ Saldado'}
                      </button>
                    ) : esComp ? (
                      <button
                        type="button"
                        onClick={(e) => toggleSaldadoRapido(t, e)}
                        className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-xs text-jade hover:bg-white/15 hover:text-pebble transition"
                        title={t.pagado_por === 'yo' ? 'Marcar como cobrado' : 'Marcar como pagado'}
                      >
                        {t.pagado_por === 'yo' ? 'Cobrar' : 'Pagar'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => toggleSaldadoRapido(t, e)}
                        className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-jade/70 hover:bg-white/10"
                      >
                        Pendiente
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <button
                      type="button"
                      aria-label="Editar"
                      className="rounded-lg p-1.5 text-jade hover:bg-white/10 hover:text-cyan"
                    >
                      ✏️
                    </button>
                  </td>
                </tr>
              );
            })}

            {rows && !visibles.length && (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center text-jade">
                  No se encontraron movimientos con los filtros seleccionados.
                </td>
              </tr>
            )}
          </tbody>
          {visibles.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 bg-white/[0.02] text-sm">
                <td colSpan={6} className="px-5 py-4 font-medium text-jade">
                  Balance visible ({visibles.length} ítems):
                </td>
                <td
                  className={`num px-4 py-4 text-right text-base font-bold ${
                    totalVisibleReal < 0 ? 'text-debt' : 'text-income'
                  }`}
                >
                  {money(totalVisibleReal)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* VISTA 2: LISTA DE TARJETAS TÁCTILES PARA CELULAR */}
      <div className="space-y-2.5 md:hidden">
        {!rows &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass h-24 animate-pulse rounded-2xl" />
          ))}

        {visibles.map((t) => {
          const cat = t.categoria_id ? catMap.get(t.categoria_id) : undefined;
          const cta = t.cuenta_id ? ctaMap.get(t.cuenta_id) : undefined;
          const p = progreso(t);
          const color = t.tipo === 'ingreso' ? 'text-income' : 'text-debt';
          const esComp = t.naturaleza === 'compartido';
          const miParte = esComp ? t.monto_total * ((t.porcentaje_propio ?? 50) / 100) : t.monto_total;

          return (
            <article
              key={t.id}
              onClick={() => setEditing(t)}
              className={`glass relative cursor-pointer p-4 transition active:scale-[0.99] ${t.saldado ? 'opacity-70' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="num text-xs text-jade">{fmtDate(t.fecha_compra)}</span>
                    {t.naturaleza === 'fijo' && (
                      <span className="rounded-full bg-cyan/15 px-2 py-0.5 text-[10px] font-semibold text-cyan">
                        📌 Fijo
                      </span>
                    )}
                    {esComp && (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        👥 {t.porcentaje_propio}%
                      </span>
                    )}
                    {t.saldado && (
                      <span className="rounded-full bg-income/20 px-2 py-0.5 text-[10px] font-bold text-income">
                        {esComp ? (t.pagado_por === 'yo' ? '✓ Cobrado' : '✓ Pagado') : '✓ Saldado'}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 truncate font-semibold text-pebble">{t.descripcion}</h3>
                  {esComp && t.compartido_con && (
                    <p className="text-xs text-amber-300/80">con {t.compartido_con}</p>
                  )}
                </div>

                <div className="text-right">
                  <p className={`num text-lg font-bold ${color}`}>
                    {t.tipo === 'egreso' ? '-' : '+'}{money(t.monto_total)}
                  </p>
                  {esComp && !t.saldado && (
                    <p className="num text-[11px] text-amber-300">
                      {t.pagado_por === 'yo' ? (
                        <span>Tu parte: {money(miParte)} · <strong className="text-income">Te deben {money(t.monto_total - miParte)}</strong></span>
                      ) : (
                        <span><strong className="text-debt">Debés: {money(miParte)}</strong></span>
                      )}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-xs">
                <div className="flex items-center gap-2">
                  {cat && (
                    <span
                      className="rounded-full px-2 py-0.5"
                      style={{ background: `${cat.color}22`, color: cat.color }}
                    >
                      {cat.icono} {cat.nombre}
                    </span>
                  )}
                  {cta && <span className="text-jade">{cuentaIcon(cta.tipo)} {cta.nombre}</span>}
                </div>

                <div className="flex items-center gap-2">
                  {t.cuotas_totales > 1 ? (
                    <span className="num font-medium text-cyan">
                      {p.label} · {money(t.monto_cuota)}/m
                    </span>
                  ) : (
                    <span className="text-jade">1 pago</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => toggleSaldadoRapido(t, e)}
                    className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                      t.saldado ? 'bg-income/20 text-income' : 'bg-white/10 text-jade hover:text-pebble'
                    }`}
                  >
                    {t.saldado ? '✓ Listo' : 'Saldar'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}

        {rows && !visibles.length && (
          <div className="glass p-8 text-center text-sm text-jade">
            No se encontraron movimientos con los filtros aplicados.
          </div>
        )}
      </div>

      <TransactionEditor tx={editing} categorias={categorias} cuentas={cuentas} onClose={() => setEditing(null)} />
    </div>
  );
}
