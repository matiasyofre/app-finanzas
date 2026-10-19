'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getSupabase, type ProyeccionDesglosada } from '@/lib/supabase/client';
import { TX_EVENT } from '@/lib/offlineQueue';
import { compact, money, monthLabel } from '@/lib/format';
import { addMonths, todayISO } from '@/lib/cuotas';
import { useCatalogs, cuentaIcon } from '@/lib/catalogs';
import WaterfallChart from './WaterfallChart';

type Tab = 'consolidado' | 'tarjetas' | 'prestamos' | 'ingresos';

const COLOR_INGRESOS = '#25D366'; // Verde WhatsApp
const COLOR_TARJETAS = '#C98B6D'; // Terracota Clay
const COLOR_PRESTAMOS = '#A78BFA'; // Púrpura suave
const COLOR_FIJOS = '#0F766E'; // Teal
const COLOR_CYAN = '#22D3EE'; // Cyan

type TxRow = {
  id: string;
  descripcion: string;
  monto_total: number;
  cuotas_totales: number;
  cuota_actual: number;
  monto_cuota: number | null;
  fecha_compra: string;
  fecha_primera_cuota: string | null;
  tipo: 'ingreso' | 'egreso';
  naturaleza?: 'fijo' | 'variable' | 'compartido';
  porcentaje_propio?: number;
  pagado_por?: 'yo' | 'otro';
  saldado?: boolean;
  es_recurrente?: boolean;
  cuenta_id?: string | null;
  cuentas_tarjetas?: { id: string; nombre: string; tipo: string } | null;
};

type CuotaCustom = {
  transaccion_id: string;
  nro_cuota: number;
  monto_cuota: number;
  saldada: boolean;
};

export default function ProyeccionesManager() {
  const { cuentas } = useCatalogs();
  const [tab, setTab] = useState<Tab>('consolidado');
  const [selectedCuenta, setSelectedCuenta] = useState<string>('todas');
  const [data, setData] = useState<ProyeccionDesglosada[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getSupabase();
    const startYM = todayISO().slice(0, 7);

    try {
      // 1. Obtener todas las transacciones activas con su cuenta asociada
      const [txRes, cuotasCustomRes] = await Promise.all([
        sb
          .from('transacciones')
          .select('id,descripcion,monto_total,cuotas_totales,cuota_actual,monto_cuota,fecha_compra,fecha_primera_cuota,tipo,naturaleza,porcentaje_propio,pagado_por,saldado,es_recurrente,cuenta_id,cuentas_tarjetas(id,nombre,tipo)'),
        sb.from('transacciones_cuotas').select('transaccion_id,nro_cuota,monto_cuota,saldada'),
      ]);

      const transacciones = (txRes.data ?? []) as unknown as TxRow[];
      const cuotasCustom = (cuotasCustomRes.data ?? []) as CuotaCustom[];

      // Mapear ajustes de cuotas personalizadas
      const customMap = new Map<string, number>();
      for (const cc of cuotasCustom) {
        customMap.set(`${cc.transaccion_id}:${cc.nro_cuota}`, Number(cc.monto_cuota));
      }

      // Preparar estructura de los 12 meses futuros
      const meses12: ProyeccionDesglosada[] = Array.from({ length: 12 }).map((_, i) => {
        const ym = addMonths(startYM, i);
        return {
          mes: `${ym}-01`,
          ingresos: 0,
          tarjetas: 0,
          prestamos: 0,
          fijos: 0,
          variables: 0,
          total_egresos: 0,
          saldo_neto: 0,
        };
      });

      const mesMap = new Map<string, ProyeccionDesglosada>(
        meses12.map((m) => [m.mes.slice(0, 7), m]),
      );

      // 2. Procesar cada transacción y proyectarla
      for (const tx of transacciones) {
        if (selectedCuenta !== 'todas' && tx.cuenta_id !== selectedCuenta) continue;

        const montoTotal = Number(tx.monto_total) || 0;
        const cuotasTotales = Math.max(1, Number(tx.cuotas_totales) || 1);
        const cuotaActual = Math.max(1, Math.min(cuotasTotales, Number(tx.cuota_actual) || 1));
        const baseCuota = tx.monto_cuota ? Number(tx.monto_cuota) : montoTotal / cuotasTotales;

        const baseYM = (tx.fecha_primera_cuota || tx.fecha_compra || todayISO()).slice(0, 7);
        const naturaleza = tx.naturaleza || (tx.tipo === 'ingreso' ? 'fijo' : 'variable');
        const pctPropio = (tx.porcentaje_propio ?? 100) / 100;
        const pagadoPor = tx.pagado_por ?? 'yo';

        const cuentaTipo = tx.cuentas_tarjetas?.tipo;
        const esPrestamo = cuentaTipo === 'prestamo' || tx.descripcion.toLowerCase().includes('préstamo') || tx.descripcion.toLowerCase().includes('prestamo');
        const esCuota = cuotasTotales > 1 || cuentaTipo === 'credito';
        const esFijo = naturaleza === 'fijo' || tx.es_recurrente || (tx.tipo === 'ingreso' && /sueldo|honorarios|salario/i.test(tx.descripcion));

        // Caso A: Ingresos
        if (tx.tipo === 'ingreso') {
          if (esFijo) {
            // Ingreso fijo mensual: proyectar en todos los meses futuros a partir de baseYM
            for (const item of meses12) {
              const ym = item.mes.slice(0, 7);
              if (ym >= baseYM) {
                item.ingresos += montoTotal;
              }
            }
          } else {
            // Ingreso puntual
            const target = mesMap.get(baseYM);
            if (target) target.ingresos += montoTotal;
          }
          continue;
        }

        // Caso B: Egresos en cuotas (tarjetas o préstamos)
        if (esCuota) {
          for (let n = cuotaActual; n <= cuotasTotales; n++) {
            const cuotaYM = addMonths(baseYM, n - cuotaActual);
            const target = mesMap.get(cuotaYM);
            if (!target) continue;

            const cuotaPersonalizada = customMap.get(`${tx.id}:${n}`);
            let nominal = cuotaPersonalizada ?? baseCuota;
            if (n === cuotasTotales && !cuotaPersonalizada) {
              nominal = montoTotal - baseCuota * (cuotasTotales - 1);
            }

            // Si es compartido:
            // Si lo pagó 'yo': mi gasto real es el porcentaje propio
            // Si lo pagó 'otro': debo abonar mi porcentaje
            const montoBolsillo = round2(nominal * pctPropio);

            if (esPrestamo) {
              target.prestamos += montoBolsillo;
            } else {
              target.tarjetas += montoBolsillo;
            }
          }
          continue;
        }

        // Caso C: Egresos fijos de un solo pago recurrente
        if (esFijo) {
          const montoBolsillo = round2(montoTotal * pctPropio);
          for (const item of meses12) {
            const ym = item.mes.slice(0, 7);
            if (ym >= baseYM) {
              item.fijos += montoBolsillo;
            }
          }
          continue;
        }

        // Caso D: Egresos variables puntuales
        const target = mesMap.get(baseYM);
        if (target) {
          const montoBolsillo = round2(montoTotal * pctPropio);
          target.variables += montoBolsillo;
        }
      }

      // 3. Totalizar egresos y saldo neto por mes
      for (const item of meses12) {
        item.total_egresos = round2(item.tarjetas + item.prestamos + item.fijos + item.variables);
        item.saldo_neto = round2(item.ingresos - item.total_egresos);
      }

      setData(meses12);
    } catch (err) {
      console.error('Error calculando proyecciones:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCuenta]);

  useEffect(() => {
    load();
    window.addEventListener(TX_EVENT, load);

    // Suscripción en tiempo real a cambios en transacciones
    const sb = getSupabase();
    const channel = sb
      .channel('realtime:proyecciones')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transacciones' }, () => {
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transacciones_cuotas' }, () => {
        load();
      })
      .subscribe();

    return () => {
      window.removeEventListener(TX_EVENT, load);
      sb.removeChannel(channel);
    };
  }, [load]);

  // Totales acumulados 12 meses
  const totales12m = useMemo(() => {
    if (!data) return { ingresos: 0, tarjetas: 0, prestamos: 0, fijos: 0, variables: 0, egresos: 0, saldo: 0 };
    return data.reduce(
      (acc, r) => ({
        ingresos: acc.ingresos + r.ingresos,
        tarjetas: acc.tarjetas + r.tarjetas,
        prestamos: acc.prestamos + r.prestamos,
        fijos: acc.fijos + r.fijos,
        variables: acc.variables + r.variables,
        egresos: acc.egresos + r.total_egresos,
        saldo: acc.saldo + r.saldo_neto,
      }),
      { ingresos: 0, tarjetas: 0, prestamos: 0, fijos: 0, variables: 0, egresos: 0, saldo: 0 },
    );
  }, [data]);

  // Datos formateados para Recharts
  const chartRows = useMemo(() => {
    if (!data) return [];
    return data.map((r) => ({
      ...r,
      label: monthLabel(r.mes),
      mesFull: monthLabel(r.mes, { month: 'long', year: 'numeric' }),
    }));
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Barra superior: Pestañas de Proyección + Filtro de Cuenta */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="glass flex flex-1 flex-wrap gap-1 p-1">
          {(
            [
              ['consolidado', '📊 Consolidado'],
              ['tarjetas', '💳 Cuotas Tarjetas'],
              ['prestamos', '📄 Préstamos'],
              ['ingresos', '💼 Ingresos'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              id={`tab-proy-${k}`}
              onClick={() => setTab(k)}
              className={`flex-1 min-w-[120px] rounded-2xl py-2.5 px-3 text-xs md:text-sm font-semibold transition ${
                tab === k ? 'bg-teal text-pebble shadow-glow' : 'text-jade hover:bg-white/5 hover:text-pebble'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={selectedCuenta}
          onChange={(e) => setSelectedCuenta(e.target.value)}
          aria-label="Filtrar proyección por cuenta"
          className="rounded-2xl border border-white/10 bg-spruce-900/90 px-3.5 py-2.5 text-xs font-semibold text-pebble focus:outline-none focus:ring-1 focus:ring-teal shrink-0"
        >
          <option value="todas">💳 Todas las cuentas</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {cuentaIcon(c.tipo)} {c.nombre}
            </option>
          ))}
        </select>
      </div>

      {loading && !data && <div className="glass h-96 animate-pulse" />}

      {/* PESTAÑA 1: CONSOLIDADO */}
      {tab === 'consolidado' && data && (
        <div className="space-y-6">
          {/* Métricas clave */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="glass p-4">
              <p className="label text-[11px]">Ingresos 12m</p>
              <p className="num mt-1 text-2xl font-bold text-income">+{money(totales12m.ingresos)}</p>
              <p className="text-[11px] text-jade">total proyectado</p>
            </div>
            <div className="glass p-4">
              <p className="label text-[11px]">Tarjetas 12m</p>
              <p className="num mt-1 text-2xl font-bold text-debt">-{money(totales12m.tarjetas)}</p>
              <p className="text-[11px] text-jade">cuotas acumuladas</p>
            </div>
            <div className="glass p-4">
              <p className="label text-[11px]">Préstamos 12m</p>
              <p className="num mt-1 text-2xl font-bold text-purple-300">-{money(totales12m.prestamos)}</p>
              <p className="text-[11px] text-jade">compromiso bancario</p>
            </div>
            <div className="glass p-4">
              <p className="label text-[11px]">Saldo Neto 12m</p>
              <p className={`num mt-1 text-2xl font-bold ${totales12m.saldo >= 0 ? 'text-income' : 'text-debt'}`}>
                {totales12m.saldo >= 0 ? '+' : ''}{money(totales12m.saldo)}
              </p>
              <p className="text-[11px] text-jade">remanente estimado</p>
            </div>
          </div>

          {/* Gráfico Consolidado: Ingresos vs Gastos con Desglose */}
          <section className="glass p-5 md:p-6" aria-labelledby="chart-consolidado-title">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="chart-consolidado-title" className="label text-sm">Flujo de caja consolidado</h2>
                <p className="text-xs text-jade">Comparativa mensual de ingresos vs egresos por tipo</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-jade">
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_INGRESOS }} /> Ingresos</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_TARJETAS }} /> Tarjetas</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_PRESTAMOS }} /> Préstamos</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_FIJOS }} /> Fijos / Otros</span>
              </div>
            </div>

            <div className="mt-6 h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={compact} tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const r = payload[0].payload as (typeof chartRows)[0];
                      return (
                        <div className="glass-strong rounded-2xl p-4 text-xs shadow-2xl">
                          <p className="font-semibold text-pebble capitalize mb-2">{r.mesFull}</p>
                          <div className="space-y-1">
                            <p className="flex justify-between gap-4 text-income">
                              <span>Ingresos:</span>
                              <span className="num font-bold">+{money(r.ingresos)}</span>
                            </p>
                            <p className="flex justify-between gap-4 text-debt">
                              <span>Tarjetas:</span>
                              <span className="num font-bold">-{money(r.tarjetas)}</span>
                            </p>
                            <p className="flex justify-between gap-4 text-purple-300">
                              <span>Préstamos:</span>
                              <span className="num font-bold">-{money(r.prestamos)}</span>
                            </p>
                            <p className="flex justify-between gap-4 text-cyan">
                              <span>Fijos / Otros:</span>
                              <span className="num font-bold">-{money(r.fijos + r.variables)}</span>
                            </p>
                            <div className="my-1.5 h-px bg-white/10" />
                            <p className="flex justify-between gap-4 font-bold text-pebble">
                              <span>Saldo neto:</span>
                              <span className={`num ${r.saldo_neto >= 0 ? 'text-income' : 'text-debt'}`}>
                                {r.saldo_neto >= 0 ? '+' : ''}{money(r.saldo_neto)}
                              </span>
                            </p>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="ingresos" name="Ingresos" fill={COLOR_INGRESOS} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="tarjetas" name="Tarjetas" fill={COLOR_TARJETAS} stackId="egresos" />
                  <Bar dataKey="prestamos" name="Préstamos" fill={COLOR_PRESTAMOS} stackId="egresos" />
                  <Bar dataKey="fijos" name="Fijos" fill={COLOR_FIJOS} stackId="egresos" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Gráfico de Cascada (Waterfall) original */}
          <WaterfallChart />
        </div>
      )}

      {/* PESTAÑA 2: CUOTAS DE TARJETAS */}
      {tab === 'tarjetas' && data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div className="glass p-4">
              <p className="label text-[11px]">Total cuotas en tarjetas</p>
              <p className="num mt-1 text-2xl font-bold text-debt">{money(totales12m.tarjetas)}</p>
              <p className="text-[11px] text-jade">próximos 12 meses</p>
            </div>
            <div className="glass p-4">
              <p className="label text-[11px]">Promedio mensual</p>
              <p className="num mt-1 text-2xl font-bold text-pebble">{money(totales12m.tarjetas / 12)}</p>
              <p className="text-[11px] text-jade">resumen mensual estimado</p>
            </div>
            <div className="glass col-span-2 sm:col-span-1 p-4">
              <p className="label text-[11px]">Mes con mayor carga</p>
              <p className="num mt-1 text-2xl font-bold text-cyan">
                {(() => {
                  const max = [...data].sort((a, b) => b.tarjetas - a.tarjetas)[0];
                  return max && max.tarjetas > 0 ? `${monthLabel(max.mes)} (${compact(max.tarjetas)})` : '—';
                })()}
              </p>
              <p className="text-[11px] text-jade">pico de vencimientos</p>
            </div>
          </div>

          <section className="glass p-5 md:p-6">
            <h2 className="label text-sm">Vencimiento mensual de cuotas de tarjetas</h2>
            <p className="text-xs text-jade">Evolución de resúmenes de tarjetas y compras en cuotas</p>

            <div className="mt-6 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={compact} tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const r = payload[0].payload as (typeof chartRows)[0];
                      return (
                        <div className="glass-strong rounded-2xl p-3 text-xs shadow-xl">
                          <p className="font-semibold text-pebble capitalize mb-1">{r.mesFull}</p>
                          <p className="num text-debt font-bold text-sm">Cuotas: {money(r.tarjetas)}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="tarjetas" fill={COLOR_TARJETAS} radius={[6, 6, 0, 0]}>
                    {chartRows.map((_, i) => (
                      <Cell key={i} fill={COLOR_TARJETAS} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}

      {/* PESTAÑA 3: CUOTAS DE PRÉSTAMOS */}
      {tab === 'prestamos' && data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div className="glass p-4">
              <p className="label text-[11px]">Compromiso en préstamos 12m</p>
              <p className="num mt-1 text-2xl font-bold text-purple-300">{money(totales12m.prestamos)}</p>
              <p className="text-[11px] text-jade">total a desembolsar</p>
            </div>
            <div className="glass p-4">
              <p className="label text-[11px]">Cuota mensual estimada</p>
              <p className="num mt-1 text-2xl font-bold text-pebble">{money(totales12m.prestamos / 12)}</p>
              <p className="text-[11px] text-jade">promedio mensual</p>
            </div>
            <div className="glass col-span-2 sm:col-span-1 p-4">
              <p className="label text-[11px]">Estado</p>
              <p className="num mt-1 text-2xl font-bold text-cyan">
                {totales12m.prestamos > 0 ? 'Activo' : 'Sin deuda de préstamos'}
              </p>
              <p className="text-[11px] text-jade">líneas bancarias / préstamos</p>
            </div>
          </div>

          <section className="glass p-5 md:p-6">
            <h2 className="label text-sm">Amortización de préstamos</h2>
            <p className="text-xs text-jade">Cuotas a pagar de préstamos en los próximos 12 meses</p>

            <div className="mt-6 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={compact} tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const r = payload[0].payload as (typeof chartRows)[0];
                      return (
                        <div className="glass-strong rounded-2xl p-3 text-xs shadow-xl">
                          <p className="font-semibold text-pebble capitalize mb-1">{r.mesFull}</p>
                          <p className="num text-purple-300 font-bold text-sm">Cuota préstamo: {money(r.prestamos)}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="prestamos" fill={COLOR_PRESTAMOS} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}

      {/* PESTAÑA 4: INGRESOS */}
      {tab === 'ingresos' && data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div className="glass p-4">
              <p className="label text-[11px]">Ingresos esperados 12m</p>
              <p className="num mt-1 text-2xl font-bold text-income">+{money(totales12m.ingresos)}</p>
              <p className="text-[11px] text-jade">flujo total entrante</p>
            </div>
            <div className="glass p-4">
              <p className="label text-[11px]">Ingreso promedio</p>
              <p className="num mt-1 text-2xl font-bold text-pebble">+{money(totales12m.ingresos / 12)}</p>
              <p className="text-[11px] text-jade">por mes</p>
            </div>
            <div className="glass col-span-2 sm:col-span-1 p-4">
              <p className="label text-[11px]">Cargas fijas cubiertas</p>
              <p className="num mt-1 text-2xl font-bold text-cyan">
                {totales12m.egresos > 0 && totales12m.ingresos > 0
                  ? `${Math.round((totales12m.ingresos / totales12m.egresos) * 100)}%`
                  : '100%'}
              </p>
              <p className="text-[11px] text-jade">cobertura de gastos</p>
            </div>
          </div>

          <section className="glass p-5 md:p-6">
            <h2 className="label text-sm">Proyección de ingresos mensuales</h2>
            <p className="text-xs text-jade">Flujo proyectado de sueldos, cobros y entradas de fondos</p>

            <div className="mt-6 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={compact} tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const r = payload[0].payload as (typeof chartRows)[0];
                      return (
                        <div className="glass-strong rounded-2xl p-3 text-xs shadow-xl">
                          <p className="font-semibold text-pebble capitalize mb-1">{r.mesFull}</p>
                          <p className="num text-income font-bold text-sm">Ingreso: +{money(r.ingresos)}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="ingresos" fill={COLOR_INGRESOS} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
