'use client';

import { useMemo, useState, useEffect, useCallback, Fragment } from 'react';
import * as XLSX from 'xlsx';
import { getSupabase } from '@/lib/supabase/client';
import { TX_EVENT } from '@/lib/offlineQueue';
import { money, monthLabel } from '@/lib/format';
import { addMonths, todayISO, monthDiff } from '@/lib/cuotas';
import { useCatalogs } from '@/lib/catalogs';
import TransactionEditor, { type Transaccion } from './TransactionEditor';
import { isFijo, isCompartido } from './MovimientosGrid';
import {
  getActiveSimMovimientos,
  getSimMontoMes,
  SCENARIOS_EVENT,
  type SimMovimiento,
} from '@/lib/scenarios';

type ModoMonto = 'total' | 'propio';

function getMontoMes(t: Transaccion, targetYM: string, modo: ModoMonto = 'total'): number {
  const startYM = (t.fecha_primera_cuota || t.fecha_compra).slice(0, 7);
  const esF = isFijo(t);
  const esC = isCompartido(t);
  const pctPropio = (t.porcentaje_propio ?? (esC ? 50 : 100)) / 100;

  let valor = 0;
  if (esF) {
    if (startYM <= targetYM) {
      valor = t.monto_cuota || t.monto_total;
    }
  } else if (t.cuotas_totales > 1) {
    const diff = monthDiff(startYM, targetYM);
    const nroCuota = t.cuota_actual + diff;
    if (nroCuota >= t.cuota_actual && nroCuota <= t.cuotas_totales) {
      if (nroCuota === t.cuotas_totales) {
        const resto = t.monto_total - t.monto_cuota * (t.cuotas_totales - 1);
        valor = resto > 0 ? resto : t.monto_cuota || t.monto_total / t.cuotas_totales;
      } else {
        valor = t.monto_cuota || t.monto_total / t.cuotas_totales;
      }
    }
  } else {
    if (startYM === targetYM) {
      valor = t.monto_total;
    }
  }

  if (modo === 'propio' && t.tipo === 'egreso') {
    return valor * pctPropio;
  }
  return valor;
}

function getSeccionTransaccion(t: Transaccion, ctaMap: Map<string, any>): string {
  const cta = t.cuenta_id ? ctaMap.get(t.cuenta_id) : null;
  const ctaNombre = cta?.nombre?.toLowerCase() || '';
  const desc = t.descripcion.toLowerCase();

  if (ctaNombre.includes('naranja') || desc.includes('naranja') || desc.includes('zeta')) {
    return 'Naranja X';
  }
  if (ctaNombre.includes('visa') || desc.includes('visa')) {
    return 'Visa Galicia';
  }
  if (ctaNombre.includes('amex') || desc.includes('amex')) {
    return 'Amex Galicia';
  }
  if (
    cta?.tipo === 'prestamo' ||
    ctaNombre.includes('prestamo') ||
    desc.includes('prestamo') ||
    desc.includes('préstamo') ||
    desc.includes('hipotecario') ||
    desc.includes('debito muni')
  ) {
    return 'Préstamos Banco';
  }
  if (ctaNombre && !ctaNombre.includes('efectivo')) {
    return cta.nombre;
  }
  return 'Gastos Fijos y Servicios';
}

export default function ExcelMatrixGrid() {
  const { categorias, cuentas } = useCatalogs();
  const [rows, setRows] = useState<Transaccion[] | null>(null);
  const [q, setQ] = useState('');
  const [modo, setModo] = useState<ModoMonto>('total');
  const [editing, setEditing] = useState<Transaccion | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [incluirSimulaciones, setIncluirSimulaciones] = useState(true);
  const [simMovimientos, setSimMovimientos] = useState<{ mov: SimMovimiento; escenarioNombre: string }[]>([]);

  const currentYM = todayISO().slice(0, 7);

  const load = useCallback(async () => {
    const { data } = await getSupabase()
      .from('transacciones')
      .select('id,tipo,naturaleza,porcentaje_propio,pagado_por,compartido_con,saldado,fecha_saldado,es_recurrente,descripcion,monto_total,monto_cuota,cuotas_totales,cuota_actual,fecha_compra,fecha_primera_cuota,categoria_id,cuenta_id')
      .eq('tipo', 'egreso')
      .order('fecha_compra', { ascending: false });

    if (data) {
      setRows(
        data.map((r: any) => ({
          ...r,
          monto_total: Number(r.monto_total),
          monto_cuota: Number(r.monto_cuota),
          porcentaje_propio: Number(r.porcentaje_propio ?? 100),
          pagado_por: r.pagado_por ?? 'yo',
          saldado: Boolean(r.saldado),
        })),
      );
    }
  }, []);

  const refreshSimulaciones = useCallback(() => {
    setSimMovimientos(getActiveSimMovimientos().filter((s) => s.mov.tipo === 'egreso'));
  }, []);

  useEffect(() => {
    load();
    refreshSimulaciones();
    window.addEventListener(TX_EVENT, load);
    window.addEventListener(SCENARIOS_EVENT, refreshSimulaciones);
    return () => {
      window.removeEventListener(TX_EVENT, load);
      window.removeEventListener(SCENARIOS_EVENT, refreshSimulaciones);
    };
  }, [load, refreshSimulaciones]);

  const catMap = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const ctaMap = useMemo(() => new Map(cuentas.map((c) => [c.id, c])), [cuentas]);

  // Generar las 12 columnas mensuales consecutivas
  const meses12 = useMemo(() => {
    return Array.from({ length: 12 }).map((_, i) => {
      const ym = addMonths(currentYM, i);
      const label = monthLabel(`${ym}-01`, { month: 'short', year: '2-digit' });
      return { ym, label };
    });
  }, [currentYM]);

  // Filtrado de transacciones
  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const ctaNom = r.cuenta_id ? ctaMap.get(r.cuenta_id)?.nombre || '' : '';
      const catNom = r.categoria_id ? catMap.get(r.categoria_id)?.nombre || '' : '';
      return `${r.descripcion} ${ctaNom} ${catNom} ${r.compartido_con || ''}`.toLowerCase().includes(s);
    });
  }, [rows, q, ctaMap, catMap]);

  // Agrupación por sección estilo Excel
  const seccionOrder = ['Naranja X', 'Visa Galicia', 'Amex Galicia', 'Préstamos Banco', 'Gastos Fijos y Servicios'];

  const secciones = useMemo(() => {
    const map = new Map<string, Transaccion[]>();

    for (const r of filteredRows) {
      const sec = getSeccionTransaccion(r, ctaMap);
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(r);
    }

    const orderedKeys = Array.from(map.keys()).sort((a, b) => {
      const ia = seccionOrder.indexOf(a);
      const ib = seccionOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    return orderedKeys.map((nombre) => {
      const items = map.get(nombre)!;
      const subtotales = meses12.map(({ ym }) => {
        return items.reduce((sum, item) => sum + getMontoMes(item, ym, modo), 0);
      });
      return { nombre, items, subtotales };
    });
  }, [filteredRows, ctaMap, meses12, modo]);

  // Subtotales simulados por mes
  const simSubtotales = useMemo(() => {
    if (!incluirSimulaciones || simMovimientos.length === 0) {
      return meses12.map(() => 0);
    }
    return meses12.map(({ ym }) => {
      return simMovimientos.reduce((sum, s) => {
        return sum + getSimMontoMes(s.mov, ym, modo === 'propio');
      }, 0);
    });
  }, [incluirSimulaciones, simMovimientos, meses12, modo]);

  // Gran total proyectado mensual (incluyendo opcionalmente simulaciones)
  const granTotalMeses = useMemo(() => {
    return meses12.map(({ ym }, idx) => {
      const real = (filteredRows || []).reduce((sum, item) => sum + getMontoMes(item, ym, modo), 0);
      const sim = simSubtotales[idx] || 0;
      return real + sim;
    });
  }, [filteredRows, meses12, modo, simSubtotales]);

  const toggleSection = (nombre: string) => {
    setCollapsedSections((prev) => ({ ...prev, [nombre]: !prev[nombre] }));
  };

  // Exportar a Excel
  const handleExport = () => {
    const headers = [
      'Categoría / Grupo',
      'Detalle',
      'Fijo/Variable',
      'Compartido',
      'Pagado Por',
      ...meses12.map((m) => m.label),
    ];

    const dataRows: (string | number)[][] = [];

    for (const sec of secciones) {
      for (const t of sec.items) {
        const esF = isFijo(t);
        const esC = isCompartido(t);
        const rowData: (string | number)[] = [
          sec.nombre,
          t.descripcion,
          esF ? 'Fijo' : 'Variable',
          esC ? `${t.porcentaje_propio}%` : '0',
          t.pagado_por === 'otro' ? 'Sofi' : 'Yo',
          ...meses12.map(({ ym }) => {
            const v = getMontoMes(t, ym, modo);
            return v > 0 ? Math.round(v * 100) / 100 : 0;
          }),
        ];
        dataRows.push(rowData);
      }

      // Fila de subtotal
      dataRows.push([
        '',
        `Subtotal ${sec.nombre}`,
        '',
        '',
        '',
        ...sec.subtotales.map((v) => Math.round(v * 100) / 100),
      ]);
    }

    if (incluirSimulaciones && simMovimientos.length > 0) {
      for (const s of simMovimientos) {
        dataRows.push([
          `Simulación (${s.escenarioNombre})`,
          s.mov.descripcion,
          s.mov.es_recurrente ? 'Fijo' : 'Variable',
          `${s.mov.porcentaje_propio}%`,
          'Yo',
          ...meses12.map(({ ym }) => {
            const v = getSimMontoMes(s.mov, ym, modo === 'propio');
            return v > 0 ? Math.round(v * 100) / 100 : 0;
          }),
        ]);
      }
      dataRows.push([
        '',
        'Subtotal Escenarios Simulados',
        '',
        '',
        '',
        ...simSubtotales.map((v) => Math.round(v * 100) / 100),
      ]);
    }

    // Gran Total
    dataRows.push([
      '',
      'TOTAL PROYECTADO',
      '',
      '',
      '',
      ...granTotalMeses.map((v) => Math.round(v * 100) / 100),
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws['!cols'] = [
      { wch: 18 },
      { wch: 34 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      ...meses12.map(() => ({ wch: 14 })),
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Proyección Detallada');
    XLSX.writeFile(wb, `Proyeccion_Detallada_${currentYM}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Barra de Controles y Filtros */}
      <div className="glass p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Búsqueda */}
          <div className="relative flex-1 max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-jade">🔍</span>
            <input
              type="text"
              placeholder="Filtrar por detalle, tarjeta o persona..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-8 text-xs text-pebble placeholder-jade/60 focus:border-teal focus:outline-none"
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

          {/* Toggle de Modo, Switch de Simulación y Botón Exportar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl bg-white/5 p-1 text-xs">
              <button
                type="button"
                onClick={() => setModo('total')}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  modo === 'total' ? 'bg-teal text-pebble shadow-sm font-semibold' : 'text-jade hover:text-pebble'
                }`}
                title="Muestra los montos nominales totales (100%), tal como en la planilla original"
              >
                Monto Total (100%)
              </button>
              <button
                type="button"
                onClick={() => setModo('propio')}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  modo === 'propio' ? 'bg-teal text-pebble shadow-sm font-semibold' : 'text-jade hover:text-pebble'
                }`}
                title="Muestra únicamente tu parte según el % propio de cada gasto"
              >
                Mi Bolsillo (%)
              </button>
            </div>

            {simMovimientos.length > 0 && (
              <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-xs text-purple-200 transition hover:bg-purple-500/20 select-none">
                <input
                  type="checkbox"
                  checked={incluirSimulaciones}
                  onChange={(e) => setIncluirSimulaciones(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-purple-400 bg-white/10 text-purple-500 accent-purple-500 cursor-pointer"
                />
                <span className="font-semibold text-[11px]">🔮 +{simMovimientos.length} simulados</span>
              </label>
            )}

            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-pebble hover:bg-white/10 transition"
              title="Descargar esta planilla a archivo .xlsx"
            >
              📥 Descargar Excel
            </button>
          </div>
        </div>

        {/* Leyenda de Colores */}
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-jade pt-1 border-t border-white/5">
          <span className="font-semibold text-pebble/80">Código visual:</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 border border-emerald-300/40" />
            <span>Verde = Saldado / Al día</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400 border border-amber-300/40" />
            <span>Amarillo = Pagó Sofi (Por liquidar)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/40 border border-white/20" />
            <span>Blanco = Gasto propio</span>
          </span>
          {incluirSimulaciones && simMovimientos.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-purple-400 border border-purple-300/40" />
              <span>Violeta = Escenario simulado ("what-if")</span>
            </span>
          )}
        </div>
      </div>

      {/* Planilla Matricial Estilo Excel */}
      <div className="glass overflow-hidden">
        <div className="custom-scrollbar overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/10 bg-spruce-950 text-jade uppercase tracking-wider text-[11px]">
                {/* Col 1 */}
                <th className="sticky left-0 z-20 bg-spruce-950 px-3 py-2.5 w-[140px] min-w-[140px] max-w-[140px] font-semibold border-r border-white/10">
                  Categoría
                </th>
                {/* Col 2 */}
                <th className="sticky left-[140px] z-20 bg-spruce-950 px-3 py-2.5 w-[220px] min-w-[220px] max-w-[220px] font-semibold border-r border-white/10">
                  Detalle
                </th>
                {/* Col 3 */}
                <th className="px-2 py-2.5 text-center w-[65px] min-w-[65px] max-w-[65px] font-semibold">Tipo</th>
                {/* Col 4 */}
                <th className="px-2 py-2.5 text-center w-[65px] min-w-[65px] max-w-[65px] font-semibold">Comp.</th>
                {/* Col 5..16 */}
                {meses12.map((m, idx) => (
                  <th
                    key={m.ym}
                    className={`whitespace-nowrap px-3 py-2.5 text-right w-[105px] min-w-[105px] font-bold ${
                      idx === 0 ? 'bg-cyan/15 text-cyan border-x border-cyan/20' : 'text-pebble'
                    }`}
                  >
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-white/5">
              {!rows && (
                <tr>
                  <td colSpan={16} className="p-8 text-center text-xs text-jade animate-pulse">
                    Cargando proyección matricial...
                  </td>
                </tr>
              )}

              {rows &&
                secciones.map((sec) => {
                  const isCollapsed = Boolean(collapsedSections[sec.nombre]);
                  return (
                    <Fragment key={sec.nombre}>
                      {/* Fila Encabezado / Subtotal de la Sección: 16 celdas exactas */}
                      <tr
                        onClick={() => toggleSection(sec.nombre)}
                        className="bg-white/[0.04] text-pebble font-semibold cursor-pointer hover:bg-white/10 select-none transition border-y border-white/10"
                        title="Tocá para contraer o expandir la sección"
                      >
                        {/* Col 1: Sticky */}
                        <td className="sticky left-0 z-10 bg-spruce-950 px-3 py-2 text-xs border-r border-white/10 w-[140px] min-w-[140px] max-w-[140px] truncate">
                          <span className="inline-flex items-center gap-1.5 text-teal">
                            <span>{isCollapsed ? '▶' : '▼'}</span>
                            <span className="font-bold text-pebble truncate">{sec.nombre}</span>
                          </span>
                        </td>
                        {/* Col 2: Sticky */}
                        <td className="sticky left-[140px] z-10 bg-spruce-950 px-3 py-2 text-xs border-r border-white/10 w-[220px] min-w-[220px] max-w-[220px]">
                          <span className="inline-flex items-center gap-2">
                            <span className="text-pebble/80 font-semibold truncate">Subtotal {sec.nombre}</span>
                            <span className="rounded-full bg-white/10 px-1.5 py-0.2 text-[10px] text-jade font-normal shrink-0">
                              {sec.items.length}
                            </span>
                          </span>
                        </td>
                        {/* Col 3 */}
                        <td className="w-[65px] min-w-[65px] max-w-[65px] px-2 py-2 text-center text-jade/40 text-[11px]">—</td>
                        {/* Col 4 */}
                        <td className="w-[65px] min-w-[65px] max-w-[65px] px-2 py-2 text-center text-jade/40 text-[11px]">—</td>
                        {/* Col 5..16 */}
                        {meses12.map(({ ym }, idx) => {
                          const val = sec.subtotales[idx];
                          const isCurrent = idx === 0;
                          return (
                            <td
                              key={ym}
                              className={`whitespace-nowrap px-3 py-2 text-right num text-xs font-bold text-pebble w-[105px] min-w-[105px] ${
                                isCurrent ? 'bg-cyan/10 border-x border-cyan/20 text-cyan' : ''
                              }`}
                            >
                              {val > 0 ? money(val) : '—'}
                            </td>
                          );
                        })}
                      </tr>

                      {/* Filas de Movimientos dentro de la sección */}
                      {!isCollapsed &&
                        sec.items.map((t) => {
                          const esF = isFijo(t);
                          const esC = isCompartido(t);
                          const esSofi = t.pagado_por === 'otro';
                          const esVerde = t.saldado;

                          let rowBorder = 'hover:bg-white/[0.04]';
                          let pillClass = 'bg-white/10 text-pebble';
                          if (esSofi) {
                            rowBorder = 'bg-amber-500/[0.03] hover:bg-amber-500/[0.08]';
                            pillClass = 'bg-amber-500/20 text-amber-300 border border-amber-400/30';
                          } else if (esVerde) {
                            rowBorder = 'bg-emerald-500/[0.02] hover:bg-emerald-500/[0.06]';
                            pillClass = 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30';
                          }

                          return (
                            <tr
                              key={t.id}
                              onClick={() => setEditing(t)}
                              className={`group cursor-pointer transition ${rowBorder}`}
                              title="Tocá para editar movimiento"
                            >
                              {/* Col 1: Categoría / Tarjeta (Sticky) */}
                              <td className="sticky left-0 z-10 bg-spruce-950 group-hover:bg-spruce-900 px-3 py-2 border-r border-white/5 whitespace-nowrap text-jade w-[140px] min-w-[140px] max-w-[140px] truncate">
                                <span className="truncate max-w-[130px] inline-block">{sec.nombre}</span>
                              </td>

                              {/* Col 2: Detalle (Sticky) */}
                              <td className="sticky left-[140px] z-10 bg-spruce-950 group-hover:bg-spruce-900 px-3 py-2 border-r border-white/5 font-medium text-pebble w-[220px] min-w-[220px] max-w-[220px]">
                                <div className="flex items-center gap-1.5 truncate">
                                  {esSofi && (
                                    <span
                                      className="h-2 w-2 rounded-full bg-amber-400 shrink-0"
                                      title="Pagado por Sofi (por liquidar)"
                                    />
                                  )}
                                  {esVerde && (
                                    <span
                                      className="h-2 w-2 rounded-full bg-emerald-400 shrink-0"
                                      title="Saldado al día"
                                    />
                                  )}
                                  <span className="truncate" title={t.descripcion}>
                                    {t.descripcion}
                                  </span>
                                </div>
                              </td>

                              {/* Col 3: Tipo (Fijo/Variable) */}
                              <td className="w-[65px] min-w-[65px] max-w-[65px] px-2 py-2 text-center whitespace-nowrap">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                    esF ? 'bg-cyan/15 text-cyan' : 'bg-white/5 text-jade'
                                  }`}
                                >
                                  {esF ? 'Fijo' : 'Var'}
                                </span>
                              </td>

                              {/* Col 4: Compartido */}
                              <td className="w-[65px] min-w-[65px] max-w-[65px] px-2 py-2 text-center whitespace-nowrap">
                                {esC ? (
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${pillClass}`}>
                                    {t.porcentaje_propio ?? 50}%
                                  </span>
                                ) : (
                                  <span className="text-jade/40 text-[10px]">0</span>
                                )}
                              </td>

                              {/* Col 5..16: 12 Meses */}
                              {meses12.map(({ ym }, idx) => {
                                const val = getMontoMes(t, ym, modo);
                                const isCurrent = idx === 0;
                                return (
                                  <td
                                    key={ym}
                                    className={`whitespace-nowrap px-3 py-2 text-right num text-xs w-[105px] min-w-[105px] ${
                                      isCurrent ? 'bg-cyan/[0.03] border-x border-cyan/15 font-semibold text-pebble' : ''
                                    } ${val > 0 ? (esSofi ? 'text-amber-200/90' : 'text-pebble/90') : 'text-jade/30'}`}
                                  >
                                    {val > 0 ? money(val) : '—'}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                    </Fragment>
                  );
                })}

              {/* SECCIÓN OPCIONAL: ESCENARIOS SIMULADOS ("WHAT-IF") */}
              {incluirSimulaciones && simMovimientos.length > 0 && (
                <Fragment>
                  <tr className="bg-purple-950/30 text-purple-200 font-semibold border-y border-purple-500/30">
                    <td className="sticky left-0 z-10 bg-spruce-950 px-3 py-2 text-xs border-r border-white/10 w-[140px] min-w-[140px] max-w-[140px] truncate text-purple-300 font-bold">
                      🔮 Simulación
                    </td>
                    <td className="sticky left-[140px] z-10 bg-spruce-950 px-3 py-2 text-xs border-r border-white/10 w-[220px] min-w-[220px] max-w-[220px] text-purple-200">
                      Subtotal Escenarios Activos ({simMovimientos.length})
                    </td>
                    <td className="w-[65px] min-w-[65px] max-w-[65px] px-2 py-2 text-center text-jade/40 text-[11px]">—</td>
                    <td className="w-[65px] min-w-[65px] max-w-[65px] px-2 py-2 text-center text-jade/40 text-[11px]">—</td>
                    {meses12.map(({ ym }, idx) => {
                      const val = simSubtotales[idx];
                      const isCurrent = idx === 0;
                      return (
                        <td
                          key={ym}
                          className={`whitespace-nowrap px-3 py-2 text-right num text-xs font-bold text-purple-200 w-[105px] min-w-[105px] ${
                            isCurrent ? 'bg-purple-500/20 text-purple-100 border-x border-purple-500/30' : ''
                          }`}
                        >
                          {val > 0 ? money(val) : '—'}
                        </td>
                      );
                    })}
                  </tr>

                  {simMovimientos.map((s) => (
                    <tr
                      key={s.mov.id}
                      className="bg-purple-950/10 border-b border-purple-500/10 hover:bg-purple-950/20 text-purple-100"
                    >
                      <td className="sticky left-0 z-10 bg-spruce-950 px-3 py-2 border-r border-white/5 whitespace-nowrap text-purple-300/80 text-xs w-[140px] min-w-[140px] max-w-[140px] truncate">
                        {s.escenarioNombre}
                      </td>
                      <td className="sticky left-[140px] z-10 bg-spruce-950 px-3 py-2 border-r border-white/5 font-medium text-purple-200 text-xs w-[220px] min-w-[220px] max-w-[220px] truncate">
                        <span className="truncate" title={s.mov.descripcion}>
                          🔮 {s.mov.descripcion}
                        </span>
                      </td>
                      <td className="w-[65px] min-w-[65px] max-w-[65px] px-2 py-2 text-center whitespace-nowrap">
                        <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300">
                          {s.mov.cuotas_totales > 1 ? `${s.mov.cuotas_totales}c` : '1 pago'}
                        </span>
                      </td>
                      <td className="w-[65px] min-w-[65px] max-w-[65px] px-2 py-2 text-center whitespace-nowrap">
                        <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300">
                          {s.mov.porcentaje_propio}%
                        </span>
                      </td>
                      {meses12.map(({ ym }) => {
                        const val = getSimMontoMes(s.mov, ym, modo === 'propio');
                        return (
                          <td
                            key={ym}
                            className={`whitespace-nowrap px-3 py-2 text-right num text-xs w-[105px] min-w-[105px] ${
                              val > 0 ? 'text-purple-300 font-medium' : 'text-jade/30'
                            }`}
                          >
                            {val > 0 ? money(val) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              )}

              {/* FILA FINAL: TOTAL PROYECTADO (Exactamente 16 columnas) */}
              {rows && (
                <tr className="border-t-2 border-teal/40 bg-teal/20 font-bold text-pebble sticky bottom-0 z-20 shadow-xl">
                  {/* Col 1 */}
                  <td className="sticky left-0 z-30 bg-spruce-950 px-3 py-3 border-r border-white/10 text-teal text-xs w-[140px] min-w-[140px] max-w-[140px] font-bold">
                    TOTAL
                  </td>
                  {/* Col 2 */}
                  <td className="sticky left-[140px] z-30 bg-spruce-950 px-3 py-3 border-r border-white/10 uppercase tracking-wide text-xs text-teal w-[220px] min-w-[220px] max-w-[220px] font-bold">
                    TOTAL PROYECTADO
                  </td>
                  {/* Col 3 */}
                  <td className="w-[65px] min-w-[65px] max-w-[65px] px-2 py-3 text-center text-jade text-[11px]">—</td>
                  {/* Col 4 */}
                  <td className="w-[65px] min-w-[65px] max-w-[65px] px-2 py-3 text-center text-jade text-[11px]">—</td>
                  {/* Col 5..16 */}
                  {meses12.map(({ ym }, idx) => {
                    const total = granTotalMeses[idx];
                    const isCurrent = idx === 0;
                    return (
                      <td
                        key={ym}
                        className={`whitespace-nowrap px-3 py-3 text-right num text-xs md:text-sm font-bold w-[105px] min-w-[105px] ${
                          isCurrent ? 'bg-teal/40 text-cyan border-x border-teal/40 font-extrabold' : 'text-pebble'
                        }`}
                      >
                        {total > 0 ? money(total) : '—'}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
