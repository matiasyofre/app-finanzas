'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getSupabase, type ProyeccionDesglosada } from '@/lib/supabase/client';
import { TX_EVENT } from '@/lib/offlineQueue';
import { compact, money, monthLabel } from '@/lib/format';
import { addMonths, todayISO } from '@/lib/cuotas';
import WaterfallChart from './WaterfallChart';

type Tab = 'consolidado' | 'tarjetas' | 'prestamos' | 'ingresos';

const COLOR_INGRESOS = '#25D366'; // Verde WhatsApp
const COLOR_TARJETAS = '#C98B6D'; // Terracota Clay
const COLOR_PRESTAMOS = '#A78BFA'; // Púrpura suave
const COLOR_FIJOS = '#0F766E'; // Teal
const COLOR_CYAN = '#22D3EE'; // Cyan

export default function ProyeccionesManager() {
  const [tab, setTab] = useState<Tab>('consolidado');
  const [data, setData] = useState<ProyeccionDesglosada[] | null>(null);
  const [cuentasData, setCuentasData] = useState<{ mes: string; cuenta: string; monto: number; tipo: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getSupabase();
    const startYM = todayISO().slice(0, 7);

    // Intentar vía RPC get_proyeccion_desglosada o agrupar desde v_cronograma_cuotas
    try {
      const { data: rpcRows, error: rpcErr } = await sb.rpc('get_proyeccion_desglosada', { p_meses: 12 });
      if (!rpcErr && rpcRows && rpcRows.length > 0) {
        setData(
          (rpcRows as ProyeccionDesglosada[]).map((r) => ({
            ...r,
            ingresos: Number(r.ingresos),
            tarjetas: Number(r.tarjetas),
            prestamos: Number(r.prestamos),
            fijos: Number(r.fijos),
            variables: Number(r.variables),
            total_egresos: Number(r.total_egresos),
            saldo_neto: Number(r.saldo_neto),
          })),
        );
      } else {
        // Fallback: consultar v_cronograma_cuotas directamente
        const { data: rawRows } = await sb
          .from('v_cronograma_cuotas')
          .select('mes, tipo, naturaleza, cuenta_tipo, monto')
          .gte('mes', `${startYM}-01`);

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

        const mesMap = new Map<string, ProyeccionDesglosada>(meses12.map((m) => [m.mes.slice(0, 7), m]));

        for (const row of rawRows ?? []) {
          const ym = (row.mes as string).slice(0, 7);
          const target = mesMap.get(ym);
          if (!target) continue;
          const m = Number(row.monto);
          if (row.tipo === 'ingreso') {
            target.ingresos += m;
          } else {
            if (row.cuenta_tipo === 'credito') target.tarjetas += m;
            else if (row.cuenta_tipo === 'prestamo') target.prestamos += m;
            else if (row.naturaleza === 'fijo') target.fijos += m;
            else target.variables += m;
            target.total_egresos += m;
          }
        }

        for (const item of meses12) {
          item.saldo_neto = item.ingresos - item.total_egresos;
        }

        setData(meses12);
      }

      // Detalle de cuentas para gráficos específicos
      const { data: rawDetalle } = await sb
        .from('v_cronograma_cuotas')
        .select('mes, cuenta_tipo, cuenta_nombre, monto')
        .eq('tipo', 'egreso')
        .gte('mes', `${startYM}-01`);

      setCuentasData(
        (rawDetalle ?? []).map((r) => ({
          mes: (r.mes as string).slice(0, 7),
          cuenta: (r.cuenta_nombre as string) || 'Sin asignar',
          monto: Number(r.monto),
          tipo: (r.cuenta_tipo as string) || 'otro',
        })),
      );
    } catch {
      // Ignorar errores transitorios de red
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(TX_EVENT, load);
    return () => window.removeEventListener(TX_EVENT, load);
  }, [load]);

  // Totales acumulados 12 meses
  const totales12m = useMemo(() => {
    if (!data) return { ingresos: 0, tarjetas: 0, prestamos: 0, fijos: 0, egresos: 0, saldo: 0 };
    return data.reduce(
      (acc, r) => ({
        ingresos: acc.ingresos + r.ingresos,
        tarjetas: acc.tarjetas + r.tarjetas,
        prestamos: acc.prestamos + r.prestamos,
        fijos: acc.fijos + r.fijos,
        egresos: acc.egresos + r.total_egresos,
        saldo: acc.saldo + r.saldo_neto,
      }),
      { ingresos: 0, tarjetas: 0, prestamos: 0, fijos: 0, egresos: 0, saldo: 0 },
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
      {/* Selector de pestañas de Proyección */}
      <div className="glass flex flex-wrap gap-1 p-1">
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
                  return max ? `${monthLabel(max.mes)} (${compact(max.tarjetas)})` : '—';
                })()}
              </p>
              <p className="text-[11px] text-jade">pico de vencimientos</p>
            </div>
          </div>

          <section className="glass p-5 md:p-6">
            <h2 className="label text-sm">Vencimiento mensual de cuotas de tarjetas</h2>
            <p className="text-xs text-jade">Evolución de resúmenes de tarjetas de crédito a lo largo del año</p>

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
                          <p className="num text-debt font-bold text-sm">Cuotas tarjeta: {money(r.tarjetas)}</p>
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
                {totales12m.prestamos > 0 ? 'Activo' : 'Sin deuda'}
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
