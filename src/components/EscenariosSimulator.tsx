'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { getSupabase } from '@/lib/supabase/client';
import { money, compact, monthLabel } from '@/lib/format';
import { addMonths, todayISO, monthDiff } from '@/lib/cuotas';
import { useCatalogs } from '@/lib/catalogs';
import {
  getEscenarios,
  saveEscenarios,
  getSimMontoMes,
  type Escenario,
  type SimMovimiento,
  SCENARIOS_EVENT,
} from '@/lib/scenarios';
import { isFijo, isCompartido } from './MovimientosGrid';

type TxSimple = {
  id: string;
  tipo: 'ingreso' | 'egreso';
  monto_total: number;
  monto_cuota: number;
  cuotas_totales: number;
  cuota_actual: number;
  fecha_compra: string;
  fecha_primera_cuota: string | null;
  naturaleza?: string;
  porcentaje_propio?: number;
  es_recurrente?: boolean;
};

export default function EscenariosSimulator() {
  const { cuentas } = useCatalogs();
  const [escenarios, setEscenarios] = useState<Escenario[]>([]);
  const [realTxs, setRealTxs] = useState<TxSimple[]>([]);
  const [loading, setLoading] = useState(true);

  // Formulario nuevo escenario / movimiento
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEscenarioId, setSelectedEscenarioId] = useState<string | null>(null);

  // Estados del formulario de movimiento simulado
  const [formDesc, setFormDesc] = useState('');
  const [formTipo, setFormTipo] = useState<'egreso' | 'ingreso'>('egreso');
  const [formModalidad, setFormModalidad] = useState<'cuotas' | 'unico' | 'recurrente'>('cuotas');
  const [formMonto, setFormMonto] = useState('');
  const [formEsMontoCuota, setFormEsMontoCuota] = useState(false);
  const [formCuotas, setFormCuotas] = useState('6');
  const [formMesInicio, setFormMesInicio] = useState(todayISO().slice(0, 7));
  const [formPctPropio, setFormPctPropio] = useState('100');
  const [formCuenta, setFormCuenta] = useState('');

  // Formulario nuevo escenario contenedor
  const [nuevoEscModal, setNuevoEscModal] = useState(false);
  const [nuevoEscNombre, setNuevoEscNombre] = useState('');
  const [nuevoEscDesc, setNuevoEscDesc] = useState('');

  const currentYM = todayISO().slice(0, 7);

  // Cargar escenarios
  const refreshEscenarios = useCallback(() => {
    setEscenarios(getEscenarios());
  }, []);

  // Cargar transacciones reales para comparar
  const loadReal = useCallback(async () => {
    setLoading(true);
    const { data } = await getSupabase()
      .from('transacciones')
      .select('id,tipo,monto_total,monto_cuota,cuotas_totales,cuota_actual,fecha_compra,fecha_primera_cuota,naturaleza,porcentaje_propio,es_recurrente');
    if (data) {
      setRealTxs(
        data.map((r: any) => ({
          ...r,
          monto_total: Number(r.monto_total),
          monto_cuota: Number(r.monto_cuota),
          porcentaje_propio: Number(r.porcentaje_propio ?? 100),
        })),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshEscenarios();
    loadReal();
    window.addEventListener(SCENARIOS_EVENT, refreshEscenarios);
    return () => window.removeEventListener(SCENARIOS_EVENT, refreshEscenarios);
  }, [refreshEscenarios, loadReal]);

  // Generar 12 meses
  const meses12 = useMemo(() => {
    return Array.from({ length: 12 }).map((_, i) => {
      const ym = addMonths(currentYM, i);
      const label = monthLabel(`${ym}-01`, { month: 'short', year: '2-digit' });
      const fullLabel = monthLabel(`${ym}-01`, { month: 'long', year: 'numeric' });
      return { ym, label, fullLabel };
    });
  }, [currentYM]);

  // Cálculo mensual del flujo real (bolsillo propio)
  const flujoReal = useMemo(() => {
    return meses12.map(({ ym }) => {
      let ingresos = 0;
      let egresos = 0;

      for (const t of realTxs) {
        const esC = isCompartido(t as any);
        const factor = esC ? (t.porcentaje_propio ?? 50) / 100 : 1;
        const startYM = (t.fecha_primera_cuota || t.fecha_compra).slice(0, 7);

        let impacto = 0;
        if (isFijo(t as any)) {
          if (startYM <= ym) impacto = (t.monto_cuota || t.monto_total) * factor;
        } else if (t.cuotas_totales > 1) {
          const diff = monthDiff(startYM, ym);
          const nroCuota = t.cuota_actual + diff;
          if (nroCuota >= t.cuota_actual && nroCuota <= t.cuotas_totales) {
            impacto = (t.monto_cuota || t.monto_total / t.cuotas_totales) * factor;
          }
        } else {
          if (startYM === ym) impacto = t.monto_total * factor;
        }

        if (t.tipo === 'ingreso') {
          ingresos += impacto;
        } else {
          egresos += impacto;
        }
      }

      return {
        ym,
        ingresos,
        egresos,
        saldo: ingresos - egresos,
      };
    });
  }, [realTxs, meses12]);

  // Movimientos simulados activos
  const simActivos = useMemo(() => {
    const list: { mov: SimMovimiento; escenarioNombre: string }[] = [];
    for (const esc of escenarios) {
      if (!esc.activo) continue;
      for (const m of esc.movimientos) {
        if (m.activo) list.push({ mov: m, escenarioNombre: esc.nombre });
      }
    }
    return list;
  }, [escenarios]);

  // Cálculo mensual simulado (Real + Escenarios activos)
  const flujoSimulado = useMemo(() => {
    return meses12.map(({ ym }, idx) => {
      const base = flujoReal[idx] || { ingresos: 0, egresos: 0, saldo: 0 };
      let deltaIngresos = 0;
      let deltaEgresos = 0;

      for (const s of simActivos) {
        const val = getSimMontoMes(s.mov, ym, true);
        if (s.mov.tipo === 'ingreso') {
          deltaIngresos += val;
        } else {
          deltaEgresos += val;
        }
      }

      const ingTotal = base.ingresos + deltaIngresos;
      const egrTotal = base.egresos + deltaEgresos;
      const saldoTotal = ingTotal - egrTotal;

      return {
        ym,
        label: meses12[idx].label,
        fullLabel: meses12[idx].fullLabel,
        saldoReal: base.saldo,
        saldoSimulado: saldoTotal,
        deltaEgresos,
        deltaIngresos,
        impactoNeto: deltaIngresos - deltaEgresos,
      };
    });
  }, [flujoReal, simActivos, meses12]);

  // Diagnóstico Inteligente de Viabilidad
  const diagnostico = useMemo(() => {
    if (simActivos.length === 0) return null;

    let peorSaldo = Infinity;
    let mesPeor = '';
    let mesesConDeficit: string[] = [];
    let totalCostoBolsillo = 0;

    for (const s of simActivos) {
      const cuotas = s.mov.cuotas_totales > 1 ? s.mov.cuotas_totales : 1;
      const montoTotal = s.mov.monto_total || s.mov.monto_cuota * cuotas;
      const miParte = montoTotal * (s.mov.porcentaje_propio / 100);
      if (s.mov.tipo === 'egreso') totalCostoBolsillo += miParte;
    }

    for (const f of flujoSimulado) {
      if (f.saldoSimulado < peorSaldo) {
        peorSaldo = f.saldoSimulado;
        mesPeor = f.fullLabel;
      }
      if (f.saldoSimulado < 0) {
        mesesConDeficit.push(f.label);
      }
    }

    const esDeficitario = mesesConDeficit.length > 0;
    const esAjustado = !esDeficitario && peorSaldo < 150000;
    const esViable = !esDeficitario && !esAjustado;

    return {
      peorSaldo,
      mesPeor,
      mesesConDeficit,
      totalCostoBolsillo,
      esDeficitario,
      esAjustado,
      esViable,
    };
  }, [flujoSimulado, simActivos]);

  // Manejo de escenarios
  const handleToggleEscenario = (id: string) => {
    const next = escenarios.map((e) => (e.id === id ? { ...e, activo: !e.activo } : e));
    setEscenarios(next);
    saveEscenarios(next);
  };

  const handleToggleMov = (escId: string, movId: string) => {
    const next = escenarios.map((e) => {
      if (e.id !== escId) return e;
      return {
        ...e,
        movimientos: e.movimientos.map((m) => (m.id === movId ? { ...m, activo: !m.activo } : m)),
      };
    });
    setEscenarios(next);
    saveEscenarios(next);
  };

  const handleDeleteMov = (escId: string, movId: string) => {
    const next = escenarios.map((e) => {
      if (e.id !== escId) return e;
      return { ...e, movimientos: e.movimientos.filter((m) => m.id !== movId) };
    });
    setEscenarios(next);
    saveEscenarios(next);
  };

  const handleDeleteEscenario = (id: string) => {
    if (!confirm('¿Eliminar este escenario y sus simulaciones?')) return;
    const next = escenarios.filter((e) => e.id !== id);
    setEscenarios(next);
    saveEscenarios(next);
  };

  const handleCreateEscenario = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoEscNombre.trim()) return;
    const nuevo: Escenario = {
      id: `esc-${Date.now()}`,
      nombre: nuevoEscNombre.trim(),
      descripcion: nuevoEscDesc.trim() || undefined,
      activo: true,
      color: '#A855F7',
      created_at: new Date().toISOString(),
      movimientos: [],
    };
    const next = [nuevo, ...escenarios];
    setEscenarios(next);
    saveEscenarios(next);
    setNuevoEscNombre('');
    setNuevoEscDesc('');
    setNuevoEscModal(false);
  };

  const handleAddMovimiento = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEscenarioId || !formDesc.trim() || !formMonto) return;

    const montoNum = parseFloat(formMonto.replace(/[^0-9.]/g, '')) || 0;
    const cuotasNum = formModalidad === 'cuotas' ? parseInt(formCuotas) || 1 : 1;
    const esRecurrente = formModalidad === 'recurrente';

    let mTotal = montoNum;
    let mCuota = montoNum;

    if (formModalidad === 'cuotas') {
      if (formEsMontoCuota) {
        mCuota = montoNum;
        mTotal = montoNum * cuotasNum;
      } else {
        mTotal = montoNum;
        mCuota = montoNum / cuotasNum;
      }
    }

    const nuevoMov: SimMovimiento = {
      id: `sim-${Date.now()}`,
      descripcion: formDesc.trim(),
      tipo: formTipo,
      monto_total: mTotal,
      monto_cuota: mCuota,
      cuotas_totales: cuotasNum,
      mes_inicio: formMesInicio,
      es_recurrente: esRecurrente,
      porcentaje_propio: Number(formPctPropio) || 100,
      cuenta_simulada: formCuenta || undefined,
      activo: true,
    };

    const next = escenarios.map((esc) => {
      if (esc.id !== selectedEscenarioId) return esc;
      return {
        ...esc,
        movimientos: [...esc.movimientos, nuevoMov],
      };
    });

    setEscenarios(next);
    saveEscenarios(next);
    setModalOpen(false);
    setFormDesc('');
    setFormMonto('');
  };

  return (
    <div className="space-y-6">
      {/* Encabezado del Simulador */}
      <div className="glass p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🔮</span>
            <h2 className="text-base font-bold text-pebble">Simulador de Escenarios Financieros ("What-If")</h2>
          </div>
          <p className="text-xs text-jade mt-1">
            Proyectá gastos o ingresos antes de comprometer tus fondos. Comprobá el impacto en tu liquidez mensual a 12 meses.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setNuevoEscModal(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-pebble px-4 py-2.5 text-xs font-bold transition shadow-glow shrink-0"
        >
          <span>➕</span> Nuevo Escenario
        </button>
      </div>

      {/* Diagnóstico de Viabilidad */}
      {diagnostico && (
        <section
          className={`glass p-5 md:p-6 border-l-4 transition ${
            diagnostico.esDeficitario
              ? 'border-l-rose-500 bg-rose-950/15'
              : diagnostico.esAjustado
              ? 'border-l-amber-500 bg-amber-950/15'
              : 'border-l-emerald-500 bg-emerald-950/15'
          }`}
          aria-labelledby="diagnostico-title"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg">
                  {diagnostico.esDeficitario ? '🚨' : diagnostico.esAjustado ? '⚠️' : '✅'}
                </span>
                <h3 id="diagnostico-title" className="text-sm font-bold text-pebble uppercase tracking-wide">
                  {diagnostico.esDeficitario
                    ? 'Erogación con Riesgo de Déficit'
                    : diagnostico.esAjustado
                    ? 'Erogación Viable pero con Margen Ajustado'
                    : 'Erogación Totalmente Viable'}
                </h3>
              </div>
              <p className="text-xs text-jade mt-1.5 leading-relaxed">
                {diagnostico.esDeficitario ? (
                  <>
                    Esta erogación genera saldo negativo en{' '}
                    <strong className="text-rose-300 font-bold">{diagnostico.mesesConDeficit.join(', ')}</strong>.
                    El mes más crítico es <strong>{diagnostico.mesPeor}</strong> con un saldo de{' '}
                    <span className="text-rose-300 font-bold">{money(diagnostico.peorSaldo)}</span>.
                  </>
                ) : diagnostico.esAjustado ? (
                  <>
                    Tu saldo neto se mantiene en positivo, pero en <strong>{diagnostico.mesPeor}</strong> el
                    margen de seguridad baja a{' '}
                    <strong className="text-amber-300">{money(diagnostico.peorSaldo)}</strong>.
                  </>
                ) : (
                  <>
                    Tu flujo de fondos soporta esta erogación holgadamente sin entrar en zona de riesgo. En el mes
                    más bajo (<strong>{diagnostico.mesPeor}</strong>) aún conservás{' '}
                    <strong className="text-emerald-300">{money(diagnostico.peorSaldo)}</strong> de saldo neto.
                  </>
                )}
              </p>
            </div>

            <div className="glass px-4 py-3 rounded-xl border border-white/10 shrink-0 text-right">
              <p className="label text-[10.5px]">Impacto bolsillo</p>
              <p className="num text-lg font-bold text-pebble">-{money(diagnostico.totalCostoBolsillo)}</p>
              <p className="text-[10px] text-jade">gasto total asumido</p>
            </div>
          </div>
        </section>
      )}

      {/* Gráfico Comparativo de Saldo Neto (Real vs Simulado) */}
      <section className="glass p-5 md:p-6" aria-labelledby="chart-sim-title">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 id="chart-sim-title" className="label text-sm">Comparativa de Saldo Neto Mensual (12 Meses)</h3>
            <p className="text-xs text-jade">Compará cómo queda tu remanente libre con y sin el escenario proyectado</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-jade">
            <span className="flex items-center gap-1.5">
              <i className="h-3 w-3 rounded bg-teal" /> Saldo Real
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-3 w-3 rounded bg-purple-500" /> Con Escenario
            </span>
          </div>
        </div>

        <div className="mt-6 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={flujoSimulado} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={compact} tick={{ fill: '#7A8B8F', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as (typeof flujoSimulado)[0];
                  return (
                    <div className="glass-strong rounded-2xl p-3.5 text-xs shadow-2xl">
                      <p className="font-bold text-pebble capitalize mb-2">{d.fullLabel}</p>
                      <div className="space-y-1">
                        <p className="flex justify-between gap-4 text-teal">
                          <span>Saldo real actual:</span>
                          <span className="num font-bold">{money(d.saldoReal)}</span>
                        </p>
                        <p className="flex justify-between gap-4 text-purple-300">
                          <span>Saldo con simulación:</span>
                          <span className={`num font-bold ${d.saldoSimulado < 0 ? 'text-rose-400' : ''}`}>
                            {money(d.saldoSimulado)}
                          </span>
                        </p>
                        <div className="my-1.5 h-px bg-white/10" />
                        <p className="flex justify-between gap-4 text-jade font-semibold">
                          <span>Diferencia mensual:</span>
                          <span className={`num ${d.impactoNeto < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                            {d.impactoNeto < 0 ? '-' : '+'}{money(Math.abs(d.impactoNeto))}
                          </span>
                        </p>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="saldoReal" name="Saldo Real" fill="#0F766E" radius={[4, 4, 0, 0]} />
              <Bar dataKey="saldoSimulado" name="Con Simulación" fill="#A855F7" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Listado de Escenarios Creados */}
      <div className="space-y-4">
        <h3 className="label text-sm">Escenarios y Potenciales Decisiones</h3>

        {escenarios.map((esc) => {
          return (
            <div
              key={esc.id}
              className={`glass p-4 sm:p-5 border transition ${
                esc.activo ? 'border-purple-500/40 bg-purple-950/[0.08]' : 'border-white/10 opacity-70'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id={`toggle-esc-${esc.id}`}
                    checked={esc.activo}
                    onChange={() => handleToggleEscenario(esc.id)}
                    className="h-4 w-4 rounded border-purple-400 bg-white/10 text-purple-600 accent-purple-600 cursor-pointer"
                  />
                  <div>
                    <h4 className="font-bold text-pebble text-sm flex items-center gap-2">
                      <span>{esc.nombre}</span>
                      {esc.activo ? (
                        <span className="rounded-full bg-purple-500/20 text-purple-300 text-[10px] px-2 py-0.5 font-bold">
                          Activo en Proyecciones
                        </span>
                      ) : (
                        <span className="rounded-full bg-white/5 text-jade text-[10px] px-2 py-0.5 font-medium">
                          Pausado
                        </span>
                      )}
                    </h4>
                    {esc.descripcion && <p className="text-xs text-jade mt-0.5">{esc.descripcion}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEscenarioId(esc.id);
                      setModalOpen(true);
                    }}
                    className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-semibold text-pebble transition"
                  >
                    ➕ Agregar erogación
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteEscenario(esc.id)}
                    className="rounded-xl border border-white/10 bg-white/5 hover:bg-rose-500/20 px-2.5 py-1.5 text-xs text-rose-300 transition"
                    title="Eliminar escenario"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Movimientos del escenario */}
              <div className="mt-3 space-y-2">
                {esc.movimientos.length === 0 && (
                  <p className="text-xs text-jade/70 italic py-2">
                    No agregaste erogaciones o ingresos a este escenario. Hacé clic en "➕ Agregar erogación".
                  </p>
                )}

                {esc.movimientos.map((m) => {
                  const esCuota = m.cuotas_totales > 1;
                  const cuotaVal = m.monto_cuota || m.monto_total / m.cuotas_totales;
                  const miCuota = cuotaVal * (m.porcentaje_propio / 100);
                  const miTotal = m.monto_total * (m.porcentaje_propio / 100);

                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl border ${
                        m.activo
                          ? 'bg-white/[0.04] border-white/10'
                          : 'bg-white/[0.01] border-white/5 opacity-50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={m.activo}
                          onChange={() => handleToggleMov(esc.id, m.id)}
                          className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 text-purple-600 accent-purple-600 cursor-pointer"
                        />
                        <div>
                          <p className="text-xs font-bold text-pebble">{m.descripcion}</p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-jade mt-0.5">
                            <span className="rounded bg-white/5 px-1.5 py-0.2">
                              📅 Inicio: {monthLabel(`${m.mes_inicio}-01`)}
                            </span>
                            <span className="rounded bg-white/5 px-1.5 py-0.2">
                              {esCuota ? `💳 ${m.cuotas_totales} cuotas` : m.es_recurrente ? '📌 Recurrente' : '1 pago'}
                            </span>
                            {m.porcentaje_propio < 100 && (
                              <span className="rounded bg-amber-500/15 text-amber-300 px-1.5 py-0.2">
                                👥 {m.porcentaje_propio}% propio
                              </span>
                            )}
                            {m.cuenta_simulada && (
                              <span className="rounded bg-white/5 px-1.5 py-0.2">
                                🏦 {m.cuenta_simulada}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="text-right">
                          <p className={`num font-bold text-xs sm:text-sm ${m.tipo === 'egreso' ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {m.tipo === 'egreso' ? '-' : '+'}{money(esCuota ? miCuota : miTotal)}
                            {esCuota && <span className="text-[10px] text-jade font-normal"> /mes</span>}
                          </p>
                          {esCuota && (
                            <p className="num text-[10px] text-jade/70">
                              Total: {money(miTotal)}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteMov(esc.id, m.id)}
                          className="text-xs text-jade hover:text-rose-400 transition p-1"
                          title="Eliminar movimiento"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL: NUEVO ESCENARIO */}
      {nuevoEscModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-strong w-full max-w-md rounded-2xl p-5 border border-white/10 shadow-2xl space-y-4">
            <h3 className="font-bold text-pebble text-sm">Crear Nuevo Escenario ("What-If")</h3>
            <form onSubmit={handleCreateEscenario} className="space-y-3">
              <div>
                <label className="label text-[11px]">Nombre del Escenario</label>
                <input
                  type="text"
                  placeholder="ej. Compra de Moto 0km / Mudanza / Viaje"
                  value={nuevoEscNombre}
                  onChange={(e) => setNuevoEscNombre(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-pebble mt-1 focus:border-purple-400 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="label text-[11px]">Descripción / Notas (Opcional)</label>
                <input
                  type="text"
                  placeholder="ej. Evaluar si me conviene pagar en 12 o 18 cuotas"
                  value={nuevoEscDesc}
                  onChange={(e) => setNuevoEscDesc(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-pebble mt-1 focus:border-purple-400 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNuevoEscModal(false)}
                  className="rounded-xl px-3.5 py-2 text-xs text-jade hover:text-pebble transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-bold text-pebble transition shadow-glow"
                >
                  Crear Escenario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: AGREGAR EROGACIÓN SIMULADA */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-strong w-full max-w-md rounded-2xl p-5 border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-pebble text-sm">Agregar Gasto / Ingreso Simulado</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-jade hover:text-pebble text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddMovimiento} className="space-y-3">
              {/* Tipo */}
              <div className="flex rounded-xl bg-white/5 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setFormTipo('egreso')}
                  className={`flex-1 rounded-lg py-1.5 font-bold transition ${
                    formTipo === 'egreso' ? 'bg-debt text-pebble' : 'text-jade hover:text-pebble'
                  }`}
                >
                  Gasto (Egreso)
                </button>
                <button
                  type="button"
                  onClick={() => setFormTipo('ingreso')}
                  className={`flex-1 rounded-lg py-1.5 font-bold transition ${
                    formTipo === 'ingreso' ? 'bg-income text-pebble' : 'text-jade hover:text-pebble'
                  }`}
                >
                  Ingreso Extra
                </button>
              </div>

              {/* Concepto */}
              <div>
                <label className="label text-[11px]">Concepto / Detalle</label>
                <input
                  type="text"
                  placeholder="ej. Pasajes avión, Cuota moto, Nuevo cliente"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-pebble mt-1 focus:border-purple-400 focus:outline-none"
                  required
                />
              </div>

              {/* Modalidad de Pago */}
              <div>
                <label className="label text-[11px]">Modalidad</label>
                <div className="grid grid-cols-3 gap-1.5 mt-1">
                  {(
                    [
                      ['cuotas', 'En cuotas'],
                      ['unico', 'Gasto único'],
                      ['recurrente', 'Recurrente'],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setFormModalidad(m)}
                      className={`rounded-xl py-1.5 text-xs font-semibold transition ${
                        formModalidad === m
                          ? 'bg-purple-600 text-pebble'
                          : 'bg-white/5 text-jade hover:text-pebble'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Monto y Toggle Monto de Cuota vs Monto Total */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="label text-[11px]">
                    {formModalidad === 'cuotas'
                      ? formEsMontoCuota
                        ? 'Importe de cada cuota'
                        : 'Monto total de la compra'
                      : 'Monto ($)'}
                  </label>
                  {formModalidad === 'cuotas' && (
                    <button
                      type="button"
                      onClick={() => setFormEsMontoCuota(!formEsMontoCuota)}
                      className="text-[10px] text-cyan hover:underline"
                    >
                      {formEsMontoCuota ? 'Cambiar a monto total' : 'Cambiar a valor por cuota'}
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  placeholder="ej. 150000"
                  value={formMonto}
                  onChange={(e) => setFormMonto(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-pebble mt-1 focus:border-purple-400 focus:outline-none num font-bold"
                  required
                />
              </div>

              {/* Cantidad de Cuotas (si aplica) */}
              {formModalidad === 'cuotas' && (
                <div>
                  <label className="label text-[11px]">Cantidad de cuotas</label>
                  <select
                    value={formCuotas}
                    onChange={(e) => setFormCuotas(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-spruce-900 px-3 py-2 text-xs text-pebble mt-1 focus:border-purple-400 focus:outline-none"
                  >
                    {[2, 3, 4, 5, 6, 9, 10, 12, 18, 24, 36, 48].map((c) => (
                      <option key={c} value={c}>
                        {c} cuotas
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Mes de Inicio y % Propio */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label text-[11px]">Mes de inicio</label>
                  <select
                    value={formMesInicio}
                    onChange={(e) => setFormMesInicio(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-spruce-900 px-3 py-2 text-xs text-pebble mt-1 focus:border-purple-400 focus:outline-none"
                  >
                    {meses12.map((m) => (
                      <option key={m.ym} value={m.ym}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label text-[11px]">% Propio (Bolsillo)</label>
                  <select
                    value={formPctPropio}
                    onChange={(e) => setFormPctPropio(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-spruce-900 px-3 py-2 text-xs text-pebble mt-1 focus:border-purple-400 focus:outline-none"
                  >
                    <option value="100">100% (Solo mío)</option>
                    <option value="50">50% (Compartido)</option>
                    <option value="30">30% propio</option>
                    <option value="70">70% propio</option>
                  </select>
                </div>
              </div>

              {/* Tarjeta simulada */}
              <div>
                <label className="label text-[11px]">Tarjeta / Cuenta estimada (opcional)</label>
                <select
                  value={formCuenta}
                  onChange={(e) => setFormCuenta(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-spruce-900 px-3 py-2 text-xs text-pebble mt-1 focus:border-purple-400 focus:outline-none"
                >
                  <option value="">(Sin asignar)</option>
                  {cuentas.map((c) => (
                    <option key={c.id} value={c.nombre}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl px-3.5 py-2 text-xs text-jade hover:text-pebble transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-bold text-pebble transition shadow-glow"
                >
                  Guardar Simulación
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
