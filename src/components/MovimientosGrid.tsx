'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { notifyChange, TX_EVENT } from '@/lib/offlineQueue';
import { cuentaIcon, useCatalogs } from '@/lib/catalogs';
import { monthDiff, todayISO, addMonths } from '@/lib/cuotas';
import { money, monthLabel } from '@/lib/format';
import TransactionEditor, { type Transaccion } from './TransactionEditor';
import ExcelManager from './ExcelManager';
import ExcelMatrixGrid from './ExcelMatrixGrid';

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

export function isFijo(t: { naturaleza?: string; es_recurrente?: boolean }): boolean {
  return t.naturaleza === 'fijo' || Boolean(t.es_recurrente);
}

export function isCompartido(t: {
  naturaleza?: string;
  porcentaje_propio?: number;
  compartido_con?: string | null;
  pagado_por?: string;
}): boolean {
  return (
    t.naturaleza === 'compartido' ||
    (t.porcentaje_propio != null && t.porcentaje_propio < 100) ||
    Boolean(t.compartido_con?.trim()) ||
    t.pagado_por === 'otro'
  );
}

/** Devuelve el monto neto que impacta exclusivamente en un mes específico ("YYYY-MM"). */
function getMontoMes(t: Transaccion, targetYM: string): number {
  const startYM = (t.fecha_primera_cuota || t.fecha_compra).slice(0, 7);
  const esFijo = isFijo(t);

  if (esFijo) {
    if (startYM <= targetYM) {
      return t.monto_cuota || t.monto_total;
    }
    return 0;
  }

  if (t.cuotas_totales > 1) {
    const diff = monthDiff(startYM, targetYM);
    const nroCuota = t.cuota_actual + diff;
    if (nroCuota >= t.cuota_actual && nroCuota <= t.cuotas_totales) {
      if (nroCuota === t.cuotas_totales) {
        const resto = t.monto_total - (t.monto_cuota * (t.cuotas_totales - 1));
        return resto > 0 ? resto : (t.monto_cuota || (t.monto_total / t.cuotas_totales));
      }
      return t.monto_cuota || (t.monto_total / t.cuotas_totales);
    }
    return 0;
  }

  // 1 solo pago: impacta únicamente en su mes de compra/inicio
  return startYM === targetYM ? t.monto_total : 0;
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
  const [mostrarDeudaTotal, setMostrarDeudaTotal] = useState(false);
  const [modoMontoGrid, setModoMontoGrid] = useState<'cuota' | 'total'>('cuota');
  const [vista, setVista] = useState<'lista' | 'matriz'>('lista');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('gastos:mostrar-deuda-total');
      if (saved === 'true') setMostrarDeudaTotal(true);
      const savedModo = localStorage.getItem('gastos:modo-monto-grid');
      if (savedModo === 'total' || savedModo === 'cuota') setModoMontoGrid(savedModo);
    } catch {}
  }, []);

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
      const esFijo = isFijo(t);
      const esComp = isCompartido(t);
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
        if (esFijo) return false;
      } else if (filtro === 'compartido') {
        if (!esComp) return false;
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

  // Totales calculados con el impacto real sobre lo visible: mes en curso vs total acumulado
  const stats = useMemo(() => {
    const mesReferencia = (periodo && /^\d{4}-\d{2}$/.test(periodo)) ? periodo : currentYM;

    if (!visibles) {
      return {
        mes: { egresos: 0, ingresos: 0, fijos: 0, compartidos: 0, pendientesCobro: 0, pendientesPago: 0 },
        total: { egresos: 0, ingresos: 0, fijos: 0, compartidos: 0, pendientesCobro: 0, pendientesPago: 0 },
        mesReferencia,
      };
    }

    let egresosMes = 0;
    let ingresosMes = 0;
    let fijosMes = 0;
    let compartidosMes = 0;
    let pendientesCobroMes = 0;
    let pendientesPagoMes = 0;

    let totalEgresos = 0;
    let totalIngresos = 0;
    let fijosTotal = 0;
    let compartidosTotal = 0;
    let pendientesCobroTotal = 0;
    let pendientesPagoTotal = 0;

    for (const t of visibles) {
      const esComp = isCompartido(t);
      const esFijo = isFijo(t);
      const partePropiaPct = (t.porcentaje_propio ?? (esComp ? 50 : 100)) / 100;

      // 1. IMPACTO EN EL MES (Mes en curso o mes seleccionado)
      const montoMes = getMontoMes(t, mesReferencia);
      if (montoMes > 0) {
        const partePropiaMes = esComp ? (montoMes * partePropiaPct) : montoMes;
        if (t.tipo === 'ingreso') {
          ingresosMes += montoMes;
        } else {
          egresosMes += partePropiaMes;
          if (esFijo) fijosMes += partePropiaMes;
          if (esComp) {
            compartidosMes += partePropiaMes;
            if (!t.saldado) {
              if (t.pagado_por === 'yo') {
                pendientesCobroMes += (montoMes - partePropiaMes);
              } else {
                pendientesPagoMes += partePropiaMes;
              }
            }
          }
        }
      }

      // 2. COMPROMISO TOTAL / HISTÓRICO (todas las cuotas y compromisos futuros)
      const partePropiaTotal = esComp ? (t.monto_total * partePropiaPct) : t.monto_total;
      if (t.tipo === 'ingreso') {
        totalIngresos += t.monto_total;
      } else {
        totalEgresos += partePropiaTotal;
        if (esFijo) fijosTotal += partePropiaTotal;
        if (esComp) {
          compartidosTotal += partePropiaTotal;
          if (!t.saldado) {
            if (t.pagado_por === 'yo') {
              pendientesCobroTotal += (t.monto_total - partePropiaTotal);
            } else {
              pendientesPagoTotal += partePropiaTotal;
            }
          }
        }
      }
    }

    return {
      mes: {
        egresos: egresosMes,
        ingresos: ingresosMes,
        fijos: fijosMes,
        compartidos: compartidosMes,
        pendientesCobro: pendientesCobroMes,
        pendientesPago: pendientesPagoMes,
      },
      total: {
        egresos: totalEgresos,
        ingresos: totalIngresos,
        fijos: fijosTotal,
        compartidos: compartidosTotal,
        pendientesCobro: pendientesCobroTotal,
        pendientesPago: pendientesPagoTotal,
      },
      mesReferencia,
    };
  }, [visibles, periodo, currentYM]);

  if (error) return <div className="glass p-6 text-sm text-debt">{error}</div>;

  return (
    <div className="space-y-5">
      {/* Selector Principal de Vista: Lista de Movimientos vs Planilla Matriz Excel */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-2xl bg-white/5 p-1 border border-white/10">
          <button
            type="button"
            id="btn-vista-lista"
            onClick={() => setVista('lista')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              vista === 'lista'
                ? 'bg-teal text-pebble shadow-sm'
                : 'text-jade hover:text-pebble'
            }`}
          >
            <span>📋</span>
            <span>Tabla de Movimientos</span>
          </button>
          <button
            type="button"
            id="btn-vista-matriz"
            onClick={() => setVista('matriz')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              vista === 'matriz'
                ? 'bg-teal text-pebble shadow-sm'
                : 'text-jade hover:text-pebble'
            }`}
          >
            <span>📑</span>
            <span>Planilla Matriz Excel (12 Meses)</span>
          </button>
        </div>

        {vista === 'lista' && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Selector Cuota vs Monto Total */}
            <div className="flex rounded-xl bg-white/5 p-1 text-xs border border-white/10 items-center">
              <button
                type="button"
                id="btn-modo-monto-cuota"
                onClick={() => {
                  setModoMontoGrid('cuota');
                  try {
                    localStorage.setItem('gastos:modo-monto-grid', 'cuota');
                  } catch {}
                }}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  modoMontoGrid === 'cuota'
                    ? 'bg-teal text-pebble shadow-sm font-bold'
                    : 'text-jade hover:text-pebble'
                }`}
                title="Mostrar el valor mensual de la cuota en cada fila"
              >
                💳 Ver cuota
              </button>
              <button
                type="button"
                id="btn-modo-monto-total"
                onClick={() => {
                  setModoMontoGrid('total');
                  try {
                    localStorage.setItem('gastos:modo-monto-grid', 'total');
                  } catch {}
                }}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  modoMontoGrid === 'total'
                    ? 'bg-teal text-pebble shadow-sm font-bold'
                    : 'text-jade hover:text-pebble'
                }`}
                title="Mostrar el monto total de la compra / deuda"
              >
                💰 Ver total
              </button>
            </div>

            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-pebble transition hover:bg-white/10 select-none">
              <input
                type="checkbox"
                checked={mostrarDeudaTotal}
                onChange={(e) => {
                  setMostrarDeudaTotal(e.target.checked);
                  try {
                    localStorage.setItem('gastos:mostrar-deuda-total', String(e.target.checked));
                  } catch {}
                }}
                className="h-4 w-4 rounded border-white/20 bg-white/10 text-teal accent-teal focus:ring-0 cursor-pointer"
              />
              <span className="font-medium">Sumar cuotas futuras</span>
            </label>
          </div>
        )}
      </div>

      {vista === 'matriz' ? (
        <ExcelMatrixGrid />
      ) : (
        <>
          {/* Encabezado del Resumen con navegación de meses */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="label text-[11px]">Resumen de movimientos</p>
              <div className="flex items-center gap-1 bg-white/5 rounded-full p-0.5 border border-white/10">
                <button
                  type="button"
                  id="btn-mes-anterior"
                  onClick={() => {
                    const prevYM = addMonths(stats.mesReferencia, -1);
                    setPeriodo(prevYM);
                  }}
                  className="rounded-full px-2 py-0.5 text-xs text-jade hover:text-pebble hover:bg-white/10 transition"
                  title="Mes anterior"
                >
                  ◀
                </button>
                <span className="rounded-full bg-teal/15 px-2.5 py-0.5 text-[11px] font-semibold text-cyan">
                  📅 {stats.mesReferencia === currentYM ? 'Mes actual' : 'Mes seleccionado'}: {monthLabel(stats.mesReferencia + '-01', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  id="btn-mes-siguiente"
                  onClick={() => {
                    const nextYM = addMonths(stats.mesReferencia, 1);
                    setPeriodo(nextYM);
                  }}
                  className="rounded-full px-2 py-0.5 text-xs text-jade hover:text-pebble hover:bg-white/10 transition"
                  title="Mes siguiente"
                >
                  ▶
                </button>
              </div>
            </div>

            {periodo !== 'vigentes' && (
              <button
                type="button"
                id="btn-volver-mes-actual"
                onClick={() => setPeriodo('vigentes')}
                className="text-[11px] font-medium text-teal hover:underline flex items-center gap-1"
              >
                <span>↩</span>
                <span>Volver al mes actual</span>
              </button>
            )}
          </div>

      {/* Tarjetas resumen superiores */}
      <div className={`grid gap-3 ${mostrarDeudaTotal ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 lg:grid-cols-4'}`}>
        <div className="glass animate-rise p-4">
          <p className="label text-[11px]">Egresos del mes</p>
          <p className="num mt-1 text-2xl font-bold text-debt">-{money(stats.mes.egresos)}</p>
          <p className="text-[11px] text-jade">cuota y gastos de {monthLabel(stats.mesReferencia + '-01', { month: 'short' })}</p>
        </div>
        <div className="glass animate-rise p-4 [animation-delay:60ms]">
          <p className="label text-[11px]">Ingresos del mes</p>
          <p className="num mt-1 text-2xl font-bold text-income">+{money(stats.mes.ingresos)}</p>
          <p className="text-[11px] text-jade">ingresado en el mes</p>
        </div>
        <div className="glass animate-rise p-4 [animation-delay:120ms]">
          <p className="label text-[11px]">Te deben (este mes)</p>
          <p className="num mt-1 text-2xl font-bold text-income">{money(stats.mes.pendientesCobro)}</p>
          <p className="text-[11px] text-jade">por gastos que pagaste vos</p>
        </div>
        <div className="glass animate-rise p-4 [animation-delay:180ms]">
          <p className="label text-[11px]">Debés (este mes)</p>
          <p className="num mt-1 text-2xl font-bold text-debt">{money(stats.mes.pendientesPago)}</p>
          <p className="text-[11px] text-jade">por gastos que pagó otro</p>
        </div>

        {/* Card actual donde sumariza todo (activable / desactivable según tilde) */}
        {mostrarDeudaTotal && (
          <div className="glass animate-rise border-amber-500/30 bg-amber-500/10 p-4 [animation-delay:200ms] col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between">
              <p className="label text-[11px] text-amber-300">Deuda total futura</p>
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">Suma todo</span>
            </div>
            <p className="num mt-1 text-2xl font-bold text-amber-200">-{money(stats.total.egresos)}</p>
            <p className="text-[11px] text-jade">todas las cuotas acumuladas</p>
          </div>
        )}
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
        <div className="custom-scrollbar overflow-x-auto">
          <table className="w-full text-left text-xs md:text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-jade">
                <th className="whitespace-nowrap px-2.5 py-2.5 font-medium">Fecha</th>
                <th className="min-w-[150px] px-2.5 py-2.5 font-medium">Descripción</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Naturaleza</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Categoría</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Cuenta / Tarjeta</th>
                <th className="whitespace-nowrap px-2 py-2.5 text-center font-medium">Cuotas</th>
                <th className="whitespace-nowrap px-2.5 py-2.5 text-right font-medium">Monto</th>
                <th className="whitespace-nowrap px-2 py-2.5 text-center font-medium">Liquidación</th>
                <th className="w-9 whitespace-nowrap px-1.5 py-2.5 text-center font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {!rows &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-2.5 py-2"><div className="h-4 w-12 rounded bg-white/5" /></td>
                    <td className="px-2.5 py-2"><div className="h-4 w-36 rounded bg-white/5" /></td>
                    <td className="px-2 py-2"><div className="h-4 w-14 rounded bg-white/5" /></td>
                    <td className="px-2 py-2"><div className="h-5 w-20 rounded-full bg-white/5" /></td>
                    <td className="px-2 py-2"><div className="h-4 w-16 rounded bg-white/5" /></td>
                    <td className="px-2 py-2 text-center"><div className="mx-auto h-5 w-12 rounded-full bg-white/5" /></td>
                    <td className="px-2.5 py-2 text-right"><div className="ml-auto h-4 w-16 rounded bg-white/5" /></td>
                    <td className="px-2 py-2 text-center"><div className="mx-auto h-5 w-14 rounded-full bg-white/5" /></td>
                    <td className="px-1.5 py-2 text-center"><div className="mx-auto h-5 w-5 rounded bg-white/5" /></td>
                  </tr>
                ))}

              {visibles.map((t) => {
                const cat = t.categoria_id ? catMap.get(t.categoria_id) : undefined;
                const cta = t.cuenta_id ? ctaMap.get(t.cuenta_id) : undefined;
                const p = progreso(t);
                const color = t.tipo === 'ingreso' ? 'text-income' : 'text-debt';
                const esComp = isCompartido(t);
                const esFijo = isFijo(t);
                const pctPropio = (t.porcentaje_propio ?? (esComp ? 50 : 100)) / 100;
                const totalPropio = esComp ? t.monto_total * pctPropio : t.monto_total;
                const esCuota = t.cuotas_totales > 1;
                const cuotaNominal = t.monto_cuota || (esCuota ? t.monto_total / t.cuotas_totales : t.monto_total);
                const cuotaPropia = esComp ? cuotaNominal * pctPropio : cuotaNominal;
                const montoPrincipal = modoMontoGrid === 'cuota' && esCuota ? cuotaPropia : totalPropio;

                return (
                  <tr
                    key={t.id}
                    id={`mov-${t.id}`}
                    onClick={() => setEditing(t)}
                    className={`group cursor-pointer transition hover:bg-white/[0.06] ${t.saldado ? 'opacity-70' : ''}`}
                    title="Tocá para editar o eliminar"
                  >
                    <td className="num whitespace-nowrap px-2.5 py-2 text-xs text-jade">
                      {fmtDate(t.fecha_compra)}
                    </td>
                    <td className="px-2.5 py-2 font-medium text-pebble">
                      <div className="flex max-w-[200px] items-center gap-1.5 lg:max-w-xs xl:max-w-md">
                        <span className="truncate" title={t.descripcion}>{t.descripcion}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1">
                        <span
                          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                            esFijo ? 'bg-cyan/15 text-cyan' : 'bg-white/5 text-jade'
                          }`}
                        >
                          {esFijo ? '📌 Fijo' : '⚡ Variable'}
                        </span>
                        {esComp && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-400"
                            title={`Compartido al ${t.porcentaje_propio ?? 50}% ${t.compartido_con ? `con ${t.compartido_con}` : ''}`}
                          >
                            👥 {t.porcentaje_propio ?? 50}%
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs">
                      {cat ? (
                        <span
                          className="inline-flex max-w-[140px] items-center gap-1 truncate rounded-full px-2 py-0.5 text-pebble text-[11px]"
                          style={{ background: `${cat.color}22`, border: `1px solid ${cat.color}55` }}
                        >
                          <span className="shrink-0">{cat.icono ?? '🏷️'}</span>
                          <span className="truncate">{cat.nombre}</span>
                        </span>
                      ) : (
                        <span className="text-jade">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-jade">
                      {cta ? (
                        <span className="inline-flex max-w-[140px] items-center gap-1 truncate text-[11px]">
                          <span className="shrink-0">{cuentaIcon(cta.tipo)}</span>
                          <span className="truncate">{cta.nombre}</span>
                        </span>
                      ) : (
                        <span className="text-jade/60">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-center text-xs">
                      <span
                        className={`inline-flex items-center justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
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
                    <td className="whitespace-nowrap px-2.5 py-2 text-right">
                      <div className="flex flex-col items-end">
                        <div className="flex items-center justify-end gap-1">
                          {modoMontoGrid === 'cuota' && esCuota && (
                            <span className="text-[9.5px] rounded bg-teal/15 text-cyan px-1 py-0.2 font-semibold uppercase tracking-wider">
                              cuota
                            </span>
                          )}
                          <span className={`num font-bold text-xs md:text-sm tracking-tight ${color}`}>
                            {t.tipo === 'egreso' ? '-' : '+'}
                            {money(montoPrincipal)}
                          </span>
                        </div>
                        {esCuota && (
                          <div className="num text-[10px] text-jade/70">
                            {modoMontoGrid === 'cuota' ? (
                              <span>Total {money(totalPropio)}</span>
                            ) : (
                              <span>{p.label}: {money(cuotaPropia)}</span>
                            )}
                          </div>
                        )}
                        {esComp && (
                          <div className="num text-[9.5px] text-jade/50 line-through" title="Total sin dividir">
                            100%: {money(t.monto_total)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-center">
                      {esComp ? (
                        <button
                          type="button"
                          onClick={(e) => toggleSaldadoRapido(t, e)}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium transition ${
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
                        <span className="text-xs text-jade/50">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-2 text-center text-xs">
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white/5 text-jade transition group-hover:bg-cyan/15 group-hover:text-cyan"
                        title="Editar movimiento"
                      >
                        ✎
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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
          const esComp = isCompartido(t);
          const esFijo = isFijo(t);
          const pctPropio = (t.porcentaje_propio ?? (esComp ? 50 : 100)) / 100;
          const totalPropio = esComp ? t.monto_total * pctPropio : t.monto_total;
          const esCuota = t.cuotas_totales > 1;
          const cuotaNominal = t.monto_cuota || (esCuota ? t.monto_total / t.cuotas_totales : t.monto_total);
          const cuotaPropia = esComp ? cuotaNominal * pctPropio : cuotaNominal;
          const montoPrincipal = modoMontoGrid === 'cuota' && esCuota ? cuotaPropia : totalPropio;

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
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${
                        esFijo ? 'bg-cyan/15 text-cyan' : 'bg-white/5 text-jade'
                      }`}
                    >
                      {esFijo ? '📌 Fijo' : '⚡ Variable'}
                    </span>
                    {esComp && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
                        👥 {t.porcentaje_propio ?? 50}%
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="flex items-center justify-end gap-1">
                    {modoMontoGrid === 'cuota' && esCuota && (
                      <span className="text-[9.5px] rounded bg-teal/15 text-cyan px-1 py-0.2 font-semibold uppercase tracking-wider">
                        cuota
                      </span>
                    )}
                    <p className={`num font-bold text-sm ${color}`}>
                      {t.tipo === 'egreso' ? '-' : '+'}
                      {money(montoPrincipal)}
                    </p>
                  </div>
                  {esCuota && (
                    <p className="num text-[10.5px] text-jade/70">
                      {modoMontoGrid === 'cuota' ? `Total ${money(totalPropio)}` : `${p.label}: ${money(cuotaPropia)}`}
                    </p>
                  )}
                  {esComp && (
                    <p className="num text-[9.5px] text-jade/50 line-through">
                      100%: {money(t.monto_total)}
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
      </>
      )}

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
