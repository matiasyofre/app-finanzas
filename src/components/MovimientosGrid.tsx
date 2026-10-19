'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { notifyChange, TX_EVENT } from '@/lib/offlineQueue';
import { cuentaIcon, useCatalogs } from '@/lib/catalogs';
import { monthDiff, todayISO, addMonths } from '@/lib/cuotas';
import { money, monthLabel } from '@/lib/format';
import TransactionEditor, { type Transaccion } from './TransactionEditor';
import ExcelManager from './ExcelManager';

type Filtro = 'todos' | 'activos' | 'pendientes' | 'saldados' | 'fijo' | 'variable' | 'compartido' | 'prestamos' | 'egreso' | 'ingreso';

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
  const [periodo, setPeriodo] = useState<string>('vigentes');
  const [selectedCuenta, setSelectedCuenta] = useState<string>('todas');
  const [selectedCat, setSelectedCat] = useState<string>('todas');
  const [editing, setEditing] = useState<Transaccion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentYM = todayISO().slice(0, 7);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('transacciones')
      .select('id,tipo,naturaleza,porcentaje_propio,pagado_por,compartido_con,saldado,fecha_saldado,es_recurrente,descripcion,monto_total,monto_cuota,cuotas_totales,cuota_actual,fecha_compra,fecha_primera_cuota,categoria_id,cuenta_id')
      .order('fecha_compra', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000);
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

  // Lista de meses disponibles para el selector rápido (meses pasados y futuros cercanos)
  const mesesOpciones = useMemo(() => {
    const list = [];
    for (let i = -3; i <= 3; i++) {
      const ym = addMonths(currentYM, i);
      list.push({ ym, label: monthLabel(`${ym}-01`, { month: 'long', year: 'numeric' }) });
    }
    return list;
  }, [currentYM]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((t) => {
      const p = progreso(t);
      const startYM = (t.fecha_primera_cuota || t.fecha_compra).slice(0, 7);
      const esFijo = t.naturaleza === 'fijo' || Boolean(t.es_recurrente);
      const cta = t.cuenta_id ? ctaMap.get(t.cuenta_id) : undefined;

      // 1. Filtro de Período (Vigentes vs Histórico vs Mes específico)
      if (periodo === 'vigentes') {
        // En "Vigentes" quedan:
        // - Gastos fijos (siguen activos siempre para actualizar por inflación)
        // - Cuotas y préstamos que siguen activos o terminan este mes
        // - Gastos de 1 pago del mes actual (o futuros)
        if (!esFijo) {
          if (t.cuotas_totales > 1) {
            if (p.state === 'fin') return false; // ya terminaron en un mes pasado
          } else {
            if (startYM < currentYM) return false; // gastos de 1 pago pasados van a histórico
          }
        }
      } else if (periodo === 'historico') {
        // En "Histórico" están los gastos de 1 pago de meses pasados o cuotas ya finalizadas
        if (esFijo) return false;
        if (t.cuotas_totales > 1) {
          if (p.state !== 'fin') return false;
        } else {
          if (startYM >= currentYM) return false;
        }
      } else if (periodo !== 'todos') {
        // Mes específico (ej. "2026-10")
        if (esFijo) {
          if (startYM > periodo) return false;
        } else if (t.cuotas_totales > 1) {
          const diff = monthDiff(startYM, periodo);
          const cuotaEnMes = t.cuota_actual + diff;
          if (cuotaEnMes < t.cuota_actual || cuotaEnMes > t.cuotas_totales) return false;
        } else {
          if (startYM !== periodo) return false;
        }
      }

      // 2. Filtro de Cuenta / Tarjeta
      if (selectedCuenta !== 'todas' && t.cuenta_id !== selectedCuenta) return false;

      // 3. Filtro de Categoría
      if (selectedCat !== 'todas' && t.categoria_id !== selectedCat) return false;

      // 4. Filtro por Naturaleza / Tipo / Estado
      if (filtro === 'egreso' || filtro === 'ingreso') {
        if (t.tipo !== filtro) return false;
      } else if (filtro === 'fijo') {
        if (!esFijo) return false;
      } else if (filtro === 'variable') {
        if (t.naturaleza !== 'variable' && !(!esFijo && t.cuotas_totales === 1)) return false;
      } else if (filtro === 'compartido') {
        if (t.naturaleza !== 'compartido') return false;
      } else if (filtro === 'prestamos') {
        if (cta?.tipo !== 'prestamo') return false;
      } else if (filtro === 'activos') {
        if (t.cuotas_totales === 1 || p.state === 'fin') return false;
      } else if (filtro === 'pendientes') {
        if (t.saldado) return false;
      } else if (filtro === 'saldados') {
        if (!t.saldado) return false;
      }

      // 5. Búsqueda por texto
      if (!s) return true;
      const cat = t.categoria_id ? catMap.get(t.categoria_id)?.nombre ?? '' : '';
      const ctaNom = cta?.nombre ?? '';
      const comp = t.compartido_con ?? '';
      return `${t.descripcion} ${cat} ${ctaNom} ${comp}`.toLowerCase().includes(s);
    });
  }, [rows, q, filtro, periodo, selectedCuenta, selectedCat, catMap, ctaMap, currentYM]);

  // Totales calculados con el impacto real sobre lo visible
  const stats = useMemo(() => {
    if (!visibles) return { totalEgresos: 0, totalIngresos: 0, fijos: 0, compartidos: 0, pendientesCobro: 0, pendientesPago: 0 };
    let totalEgresos = 0;
    let totalIngresos = 0;
    let fijos = 0;
    let compartidos = 0;
    let pendientesCobro = 0;
    let pendientesPago = 0;

    for (const t of visibles) {
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
  }, [visibles]);

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
          <p className="label text-[11px]">Te deben (pendiente)</p>
          <p className="num mt-1 text-2xl font-bold text-income">{money(stats.pendientesCobro)}</p>
          <p className="text-[11px] text-jade">por gastos que pagaste vos</p>
        </div>
        <div className="glass animate-rise p-4 [animation-delay:180ms]">
          <p className="label text-[11px]">Debés (pendiente)</p>
          <p className="num mt-1 text-2xl font-bold text-debt">{money(stats.pendientesPago)}</p>
          <p className="text-[11px] text-jade">por gastos que pagó otro</p>
        </div>
      </div>

      {/* Barra de Filtros Multifunción */}
      <div className="glass animate-rise space-y-3 p-4 [animation-delay:120ms]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Búsqueda */}
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-jade">🔍</span>
            <input
              type="text"
              placeholder="Buscar por descripción, categoría, tarjeta o persona..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-8 text-xs text-pebble placeholder-jade/60 focus:border-teal focus:outline-none"
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

          {/* Menús desplegables de Cuenta, Categoría y Período */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Selector de Período */}
            <select
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
              className="rounded-xl border border-white/10 bg-spruce-900/90 px-3 py-2 text-xs font-medium text-pebble focus:outline-none focus:ring-1 focus:ring-teal"
            >
              <option value="vigentes">🌟 Vigentes (Mes actual + activos)</option>
              <option value="historico">📁 Histórico (Pasados)</option>
              <option value="todos">📋 Todo el historial</option>
              <optgroup label="Ver mes puntual">
                {mesesOpciones.map((m) => (
                  <option key={m.ym} value={m.ym}>
                    📅 {m.label}
                  </option>
                ))}
              </optgroup>
            </select>

            {/* Selector de Cuenta / Tarjeta */}
            <select
              value={selectedCuenta}
              onChange={(e) => setSelectedCuenta(e.target.value)}
              className="rounded-xl border border-white/10 bg-spruce-900/90 px-3 py-2 text-xs font-medium text-pebble focus:outline-none focus:ring-1 focus:ring-teal"
            >
              <option value="todas">💳 Todas las cuentas</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {cuentaIcon(c.tipo)} {c.nombre}
                </option>
              ))}
            </select>

            {/* Selector de Categoría */}
            <select
              value={selectedCat}
              onChange={(e) => setSelectedCat(e.target.value)}
              className="rounded-xl border border-white/10 bg-spruce-900/90 px-3 py-2 text-xs font-medium text-pebble focus:outline-none focus:ring-1 focus:ring-teal"
            >
              <option value="todas">🏷️ Todas las categorías</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icono || '🏷️'} {c.nombre}
                </option>
              ))}
            </select>

            <ExcelManager />

            <span className="text-xs text-jade whitespace-nowrap pl-1 font-medium">
              {visibles.length} de {rows?.length ?? 0}
            </span>
          </div>
        </div>

        {/* Píldoras de tipo y estado */}
        <div className="no-scrollbar flex gap-2 overflow-x-auto pt-1">
          {(
            [
              ['todos', 'Todos'],
              ['fijo', '📌 Fijos (Déb. Aut.)'],
              ['variable', '⚡ Variables (Contado/QR)'],
              ['activos', '💳 Cuotas activas'],
              ['prestamos', '📄 Préstamos'],
              ['compartido', '👥 Compartidos'],
              ['pendientes', '⏳ Pendientes'],
              ['saldados', '✓ Saldados'],
              ['egreso', 'Egresos'],
              ['ingreso', 'Ingresos'],
            ] as [Filtro, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              id={`filtro-${k}`}
              onClick={() => setFiltro(k)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                filtro === k
                  ? 'bg-teal text-pebble shadow-glow font-bold'
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
                  <td className="px-4 py-3.5 font-medium text-pebble">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{t.descripcion}</span>
                      {t.es_recurrente && (
                        <span className="rounded bg-teal/20 px-1.5 py-0.5 text-[10px] font-semibold text-teal">
                          Fijo
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-xs">
                    <span className="capitalize text-jade">
                      {t.naturaleza === 'fijo' ? '📌 Fijo' : t.naturaleza === 'compartido' ? '👥 Compartido' : '⚡ Variable'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-xs">
                    {cat ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-pebble" style={{ background: `${cat.color}22`, border: `1px solid ${cat.color}55` }}>
                        <span>{cat.icono ?? '🏷️'}</span>
                        <span>{cat.nombre}</span>
                      </span>
                    ) : (
                      <span className="text-jade">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-xs text-jade">
                    {cta ? (
                      <span className="inline-flex items-center gap-1">
                        <span>{cuentaIcon(cta.tipo)}</span>
                        <span>{cta.nombre}</span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-center text-xs">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 font-medium ${
                        p.state === 'act'
                          ? 'bg-teal/20 text-teal'
                          : p.state === 'pend'
                          ? 'bg-white/10 text-jade'
                          : 'bg-white/5 text-jade/60'
                      }`}
                    >
                      {t.cuotas_totales > 1 ? p.label : '1 pago'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span className={`num font-bold ${color}`}>
                      {t.tipo === 'egreso' ? '-' : '+'}
                      {money(miParte)}
                    </span>
                    {esComp && (
                      <div className="num text-[10px] text-jade line-through">
                        Total {money(t.monto_total)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    {esComp ? (
                      <button
                        onClick={(e) => toggleSaldadoRapido(t, e)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                          t.saldado
                            ? 'bg-income/20 text-income hover:bg-income/30'
                            : 'bg-debt/20 text-debt hover:bg-debt/30'
                        }`}
                        title="Tocá para cambiar estado"
                      >
                        {t.saldado
                          ? t.pagado_por === 'yo' ? '✓ Cobrado' : '✓ Pagado'
                          : t.pagado_por === 'yo' ? '⏳ Por cobrar' : '⏳ Por pagar'}
                      </button>
                    ) : (
                      <span className="text-xs text-jade">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-center text-xs text-jade hover:text-pebble">
                    ✎
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows && !visibles.length && (
          <div className="p-8 text-center text-xs text-jade">
            No se encontraron movimientos con los filtros seleccionados.
          </div>
        )}
      </div>

      {/* VISTA 2: LISTA PARA MOBILE */}
      <div className="space-y-2 md:hidden">
        {visibles.map((t) => {
          const cat = t.categoria_id ? catMap.get(t.categoria_id) : undefined;
          const cta = t.cuenta_id ? ctaMap.get(t.cuenta_id) : undefined;
          const p = progreso(t);
          const color = t.tipo === 'ingreso' ? 'text-income' : 'text-debt';
          const esComp = t.naturaleza === 'compartido';
          const miParte = esComp ? t.monto_total * ((t.porcentaje_propio ?? 50) / 100) : t.monto_total;

          return (
            <div
              key={t.id}
              onClick={() => setEditing(t)}
              className="glass p-3.5 transition active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {cat && <span className="text-sm shrink-0">{cat.icono ?? '🏷️'}</span>}
                    <p className="text-sm font-semibold text-pebble truncate">{t.descripcion}</p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-jade">
                    <span>{fmtDate(t.fecha_compra)}</span>
                    {cta && (
                      <span className="rounded bg-white/5 px-1.5 py-0.5">
                        {cuentaIcon(cta.tipo)} {cta.nombre}
                      </span>
                    )}
                    <span className="rounded bg-white/5 px-1.5 py-0.5">
                      {t.cuotas_totales > 1 ? `Cuota ${p.label}` : '1 pago'}
                    </span>
                    {t.naturaleza === 'fijo' && (
                      <span className="rounded bg-income/20 text-income px-1.5 py-0.5">
                        Fijo
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className={`num font-bold text-sm ${color}`}>
                    {t.tipo === 'egreso' ? '-' : '+'}
                    {money(miParte)}
                  </p>
                  {esComp && (
                    <p className="num text-[10px] text-jade line-through">
                      Total {money(t.monto_total)}
                    </p>
                  )}
                </div>
              </div>

              {esComp && (
                <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2 text-[11px]">
                  <span className="text-jade">
                    {t.porcentaje_propio}% propio {t.compartido_con ? `· ${t.compartido_con}` : ''}
                  </span>
                  <button
                    onClick={(e) => toggleSaldadoRapido(t, e)}
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      t.saldado ? 'bg-income/20 text-income' : 'bg-debt/20 text-debt'
                    }`}
                  >
                    {t.saldado
                      ? t.pagado_por === 'yo' ? '✓ Cobrado' : '✓ Pagado'
                      : t.pagado_por === 'yo' ? '⏳ Por cobrar' : '⏳ Por pagar'}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {rows && !visibles.length && (
          <div className="glass p-8 text-center text-xs text-jade">
            No se encontraron movimientos con los filtros seleccionados.
          </div>
        )}
      </div>

      {editing && (
        <TransactionEditor
          tx={editing}
          categorias={categorias}
          cuentas={cuentas}
          onClose={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
