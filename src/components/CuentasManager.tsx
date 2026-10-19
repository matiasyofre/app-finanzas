'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { notifyCatalogs, cuentaIcon, TIPOS_CUENTA, useCatalogs, type Cuenta, type TipoCuenta } from '@/lib/catalogs';
import { TX_EVENT, notifyChange } from '@/lib/offlineQueue';
import { money, monthLabel } from '@/lib/format';
import { addMonths, todayISO } from '@/lib/cuotas';
import Modal from './Modal';
import TransactionEditor, { type Transaccion } from './TransactionEditor';

type CuentaDraft = {
  id?: string;
  nombre: string;
  tipo: TipoCuenta;
  saldo_inicial: number;
  dia_cierre: number | null;
  dia_vencimiento: number | null;
  activa: boolean;
  // Campos específicos de préstamo:
  prestamo_monto_total?: number;
  prestamo_cuotas_totales?: number;
  prestamo_cuota_actual?: number;
  prestamo_monto_cuota?: number;
  prestamo_mes_inicio?: string;
};

const emptyDraft: CuentaDraft = {
  nombre: '',
  tipo: 'billetera',
  saldo_inicial: 0,
  dia_cierre: null,
  dia_vencimiento: null,
  activa: true,
};

const emptyPrestamoDraft: CuentaDraft = {
  nombre: '',
  tipo: 'prestamo',
  saldo_inicial: 0,
  dia_cierre: null,
  dia_vencimiento: 10,
  activa: true,
  prestamo_monto_total: 0,
  prestamo_cuotas_totales: 12,
  prestamo_cuota_actual: 1,
  prestamo_monto_cuota: 0,
  prestamo_mes_inicio: todayISO().slice(0, 7),
};

export default function CuentasManager() {
  const { categorias } = useCatalogs();
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [movimientos, setMovimientos] = useState<Transaccion[]>([]);
  const [loading, setLoading] = useState(true);
  const [cuentaFiltro, setCuentaFiltro] = useState<string | null>(null);
  const [draft, setDraft] = useState<CuentaDraft | null>(null);
  const [editingTx, setEditingTx] = useState<Transaccion | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const sb = getSupabase();

    try {
      const [ctaRes, txRes] = await Promise.all([
        sb.from('cuentas_tarjetas').select('*').order('nombre'),
        sb
          .from('transacciones')
          .select('id,tipo,naturaleza,porcentaje_propio,pagado_por,compartido_con,saldado,fecha_saldado,es_recurrente,descripcion,monto_total,monto_cuota,cuotas_totales,cuota_actual,fecha_compra,fecha_primera_cuota,categoria_id,cuenta_id')
          .order('fecha_compra', { ascending: false }),
      ]);

      const ctas = ((ctaRes.data ?? []) as Cuenta[]).map((c) => ({
        ...c,
        saldo_inicial: Number(c.saldo_inicial ?? 0),
      }));

      const txs = ((txRes.data ?? []) as Transaccion[]).map((t) => ({
        ...t,
        monto_total: Number(t.monto_total),
        monto_cuota: Number(t.monto_cuota),
        porcentaje_propio: Number(t.porcentaje_propio ?? 100),
        pagado_por: t.pagado_por ?? 'yo',
        saldado: Boolean(t.saldado),
      }));

      setCuentas(ctas);
      setMovimientos(txs);
    } catch (e) {
      console.error('Error cargando cuentas:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    window.addEventListener(TX_EVENT, loadData);
    return () => window.removeEventListener(TX_EVENT, loadData);
  }, [loadData]);

  // Cálculo de saldos y métricas por cuenta
  const cuentasConSaldo = useMemo(() => {
    return cuentas.map((cta) => {
      const txsDeEstaCuenta = movimientos.filter((t) => t.cuenta_id === cta.id);

      let totalIngresos = 0;
      let totalEgresos = 0;

      for (const t of txsDeEstaCuenta) {
        if (t.tipo === 'ingreso') {
          totalIngresos += t.monto_total;
        } else {
          if (t.pagado_por === 'yo') {
            totalEgresos += t.monto_total;
          }
        }
      }

      const saldoInicial = Number(cta.saldo_inicial ?? 0);
      const saldoActual = saldoInicial + totalIngresos - totalEgresos;

      // Métricas avanzadas para préstamos
      const txPrestamo = txsDeEstaCuenta.find((t) => t.cuotas_totales > 1) || txsDeEstaCuenta[0];
      const cuotasTotales = txPrestamo?.cuotas_totales || 1;
      const cuotaActual = txPrestamo?.cuota_actual || 1;
      const montoTotalPrestamo = txPrestamo?.monto_total || 0;
      const montoCuotaPrestamo = txPrestamo?.monto_cuota || (montoTotalPrestamo > 0 ? montoTotalPrestamo / cuotasTotales : 0);
      const cuotasRestantes = Math.max(0, cuotasTotales - cuotaActual + 1);
      const deudaRestante = montoCuotaPrestamo * cuotasRestantes;
      const fechaPrimera = txPrestamo?.fecha_primera_cuota || txPrestamo?.fecha_compra || todayISO();
      const mesVencimientoFinal = addMonths(fechaPrimera.slice(0, 7), cuotasTotales - cuotaActual);

      return {
        ...cta,
        saldo_inicial: saldoInicial,
        saldoActual,
        totalIngresos,
        totalEgresos,
        movimientosCount: txsDeEstaCuenta.length,
        // Datos del préstamo:
        txPrestamo,
        cuotasTotales,
        cuotaActual,
        montoTotalPrestamo,
        montoCuotaPrestamo,
        cuotasRestantes,
        deudaRestante,
        fechaPrimera,
        mesVencimientoFinal,
      };
    });
  }, [cuentas, movimientos]);

  // Cuentas de dinero disponible (bancos, billeteras, débito, efectivo)
  const cuentasDisponibles = useMemo(
    () => cuentasConSaldo.filter((c) => c.tipo !== 'credito' && c.tipo !== 'prestamo'),
    [cuentasConSaldo],
  );

  // Tarjetas de crédito
  const cuentasCredito = useMemo(
    () => cuentasConSaldo.filter((c) => c.tipo === 'credito'),
    [cuentasConSaldo],
  );

  // Préstamos
  const cuentasPrestamo = useMemo(
    () => cuentasConSaldo.filter((c) => c.tipo === 'prestamo'),
    [cuentasConSaldo],
  );

  // Total consolidado de dinero disponible
  const totalDineroDisponible = useMemo(
    () => cuentasDisponibles.reduce((sum, c) => sum + c.saldoActual, 0),
    [cuentasDisponibles],
  );

  // Total de deuda en préstamos
  const totalDeudaPrestamos = useMemo(
    () => cuentasPrestamo.reduce((sum, c) => sum + (c.deudaRestante > 0 ? c.deudaRestante : c.totalEgresos), 0),
    [cuentasPrestamo],
  );

  // Movimientos filtrados para el historial inferior
  const movimientosFiltrados = useMemo(() => {
    if (!cuentaFiltro) return movimientos;
    return movimientos.filter((m) => m.cuenta_id === cuentaFiltro);
  }, [movimientos, cuentaFiltro]);

  const saveCuenta = async () => {
    if (!draft?.nombre.trim()) return setErr('Ingresá el nombre de la cuenta o préstamo.');
    setErr(null);

    const sb = getSupabase();
    const esCredito = draft.tipo === 'credito';
    const esPrestamo = draft.tipo === 'prestamo';

    try {
      const userRes = await sb.auth.getUser();
      const user = userRes.data?.user;
      if (!user) throw new Error('No se encontró sesión de usuario activa.');

      const payload = {
        nombre: draft.nombre.trim(),
        tipo: draft.tipo,
        saldo_inicial: Number(draft.saldo_inicial) || 0,
        dia_cierre: esCredito ? draft.dia_cierre : null,
        dia_vencimiento: esCredito || esPrestamo ? draft.dia_vencimiento : null,
        activa: draft.activa,
      };

      let ctaId = draft.id;
      if (draft.id) {
        const { error } = await sb.from('cuentas_tarjetas').update(payload).eq('id', draft.id);
        if (error) throw error;
      } else {
        const { data: newCta, error } = await sb
          .from('cuentas_tarjetas')
          .insert({ ...payload, usuario_id: user.id })
          .select('id')
          .single();
        if (error) throw error;
        ctaId = newCta?.id;
      }

      // Si es un préstamo, guardar/actualizar su transacción con cuotas y cronograma
      if (esPrestamo && ctaId) {
        const ctot = Math.max(1, Number(draft.prestamo_cuotas_totales) || 1);
        const cact = Math.max(1, Math.min(ctot, Number(draft.prestamo_cuota_actual) || 1));
        const mtot = Number(draft.prestamo_monto_total) || 0;
        const mcuota = Number(draft.prestamo_monto_cuota) || (mtot > 0 ? Math.round(mtot / ctot) : 0);
        const mesInicio = draft.prestamo_mes_inicio || todayISO().slice(0, 7);

        // Buscar si ya existe la transacción del préstamo
        const { data: existingTx } = await sb
          .from('transacciones')
          .select('id')
          .eq('cuenta_id', ctaId)
          .limit(1)
          .maybeSingle();

        const txPayload = {
          usuario_id: user.id,
          cuenta_id: ctaId,
          descripcion: draft.nombre.trim(),
          tipo: 'egreso' as const,
          naturaleza: 'variable' as const,
          monto_total: mtot > 0 ? mtot : mcuota * ctot,
          monto_cuota: mcuota,
          cuotas_totales: ctot,
          cuota_actual: cact,
          fecha_compra: `${mesInicio}-01`,
          fecha_primera_cuota: `${mesInicio}-01`,
          porcentaje_propio: 100,
          pagado_por: 'yo' as const,
        };

        if (existingTx?.id) {
          await sb.from('transacciones').update(txPayload).eq('id', existingTx.id);
        } else {
          await sb.from('transacciones').insert(txPayload);
        }
      }

      notifyCatalogs();
      notifyChange();
      setDraft(null);
      loadData();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error al guardar');
    }
  };

  const removeCuenta = async () => {
    if (!draft?.id || !confirm(`¿Eliminar "${draft.nombre}"? Los movimientos quedarán sin cuenta asociada.`)) return;
    try {
      const { error } = await getSupabase().from('cuentas_tarjetas').delete().eq('id', draft.id);
      if (error) throw error;
      notifyCatalogs();
      notifyChange();
      setDraft(null);
      loadData();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error al eliminar');
    }
  };

  const inputCls =
    'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-pebble outline-none focus:border-cyan/60 [color-scheme:dark]';

  return (
    <div className="space-y-6">
      {/* Tarjeta de Saldo Consolidado */}
      <section className="glass animate-rise p-6 relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-4 -mr-4 h-32 w-32 rounded-full bg-gradient-to-br from-cyan/20 to-teal/10 blur-2xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <span className="label text-xs">Total Dinero Disponible</span>
            <p className={`num mt-1 text-3xl sm:text-4xl font-extrabold ${totalDineroDisponible >= 0 ? 'text-income' : 'text-debt'}`}>
              {money(totalDineroDisponible)}
            </p>
            <p className="text-xs text-jade mt-1">
              Consolidado en {cuentasDisponibles.length} cuenta{cuentasDisponibles.length === 1 ? '' : 's'} (billeteras, bancos y efectivo)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { setErr(null); setDraft({ ...emptyDraft }); }}
              className="btn-primary py-2.5 px-4 text-xs font-semibold"
            >
              ＋ Nueva cuenta
            </button>
            <button
              type="button"
              onClick={() => { setErr(null); setDraft({ ...emptyPrestamoDraft }); }}
              className="rounded-2xl border border-purple-500/30 bg-purple-500/15 py-2.5 px-4 text-xs font-semibold text-purple-200 hover:bg-purple-500/25 transition"
            >
              📄 + Nuevo préstamo
            </button>
          </div>
        </div>
      </section>

      {/* SECCIÓN 1: Billeteras Virtuales, Bancos y Efectivo */}
      <section className="space-y-3">
        <h2 className="label text-sm">Bancos y billeteras virtuales</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cuentasDisponibles.map((cta) => {
            const isSelected = cuentaFiltro === cta.id;
            return (
              <div
                key={cta.id}
                className={`glass p-4 transition-all relative cursor-pointer ${
                  isSelected ? 'ring-2 ring-cyan bg-cyan/5 shadow-glow' : 'hover:bg-white/10'
                }`}
                onClick={() => setCuentaFiltro(isSelected ? null : cta.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-xl">
                      {cuentaIcon(cta.tipo)}
                    </span>
                    <div>
                      <h3 className="font-semibold text-pebble text-sm">{cta.nombre}</h3>
                      <span className="text-[11px] text-jade">
                        {TIPOS_CUENTA.find((t) => t.value === cta.tipo)?.label.split(' ')[0]}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    title="Editar cuenta y saldo inicial"
                    onClick={(e) => {
                      e.stopPropagation();
                      setErr(null);
                      setDraft({
                        id: cta.id,
                        nombre: cta.nombre,
                        tipo: cta.tipo,
                        saldo_inicial: cta.saldo_inicial ?? 0,
                        dia_cierre: cta.dia_cierre,
                        dia_vencimiento: cta.dia_vencimiento,
                        activa: cta.activa,
                      });
                    }}
                    className="rounded-lg p-1.5 text-jade hover:bg-white/10 hover:text-pebble transition"
                  >
                    ✏️
                  </button>
                </div>

                <div className="mt-4">
                  <span className="text-[10px] text-jade uppercase tracking-wider font-semibold">Saldo Actual</span>
                  <p className={`num text-2xl font-bold mt-0.5 ${cta.saldoActual >= 0 ? 'text-income' : 'text-debt'}`}>
                    {money(cta.saldoActual)}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-jade">
                  <span>Inicial: {money(cta.saldo_inicial)}</span>
                  <span>{cta.movimientosCount} movs</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* SECCIÓN 2: Tarjetas de Crédito */}
      {cuentasCredito.length > 0 && (
        <section className="space-y-3">
          <h2 className="label text-sm">Tarjetas de crédito</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cuentasCredito.map((cta) => {
              const isSelected = cuentaFiltro === cta.id;
              return (
                <div
                  key={cta.id}
                  className={`glass p-4 transition-all relative cursor-pointer ${
                    isSelected ? 'ring-2 ring-cyan bg-cyan/5 shadow-glow' : 'hover:bg-white/10'
                  }`}
                  onClick={() => setCuentaFiltro(isSelected ? null : cta.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-xl">
                        {cuentaIcon(cta.tipo)}
                      </span>
                      <div>
                        <h3 className="font-semibold text-pebble text-sm">{cta.nombre}</h3>
                        <span className="text-[11px] text-jade">
                          Tarjeta de Crédito {cta.dia_cierre ? `· Cierra día ${cta.dia_cierre}` : ''}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      title="Editar tarjeta"
                      onClick={(e) => {
                        e.stopPropagation();
                        setErr(null);
                        setDraft({
                          id: cta.id,
                          nombre: cta.nombre,
                          tipo: cta.tipo,
                          saldo_inicial: cta.saldo_inicial ?? 0,
                          dia_cierre: cta.dia_cierre,
                          dia_vencimiento: cta.dia_vencimiento,
                          activa: cta.activa,
                        });
                      }}
                      className="rounded-lg p-1.5 text-jade hover:bg-white/10 hover:text-pebble transition"
                    >
                      ✏️
                    </button>
                  </div>

                  <div className="mt-4">
                    <span className="text-[10px] text-jade uppercase tracking-wider font-semibold">Total Consumos</span>
                    <p className="num text-2xl font-bold mt-0.5 text-debt">
                      -{money(cta.totalEgresos)}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-jade">
                    <span>{cta.dia_vencimiento ? `Vence día ${cta.dia_vencimiento}` : 'Sin vto'}</span>
                    <span>{cta.movimientosCount} compras</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SECCIÓN 3: Préstamos Activos (Dedicada y con información de vencimiento) */}
      {cuentasPrestamo.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="label text-sm text-purple-200">📄 Préstamos activos</h2>
              <p className="text-xs text-jade">Seguimiento de cuotas, día de vencimiento y fecha de cancelación</p>
            </div>
            {totalDeudaPrestamos > 0 && (
              <span className="text-xs font-bold text-debt">
                Deuda total: -{money(totalDeudaPrestamos)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cuentasPrestamo.map((cta) => {
              const isSelected = cuentaFiltro === cta.id;
              const pctAvance = cta.cuotasTotales > 0 ? Math.round((cta.cuotaActual / cta.cuotasTotales) * 100) : 0;

              return (
                <div
                  key={cta.id}
                  className={`glass p-4 transition-all relative cursor-pointer border border-purple-500/20 ${
                    isSelected ? 'ring-2 ring-purple-400 bg-purple-500/10 shadow-glow' : 'hover:bg-white/10'
                  }`}
                  onClick={() => setCuentaFiltro(isSelected ? null : cta.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-500/15 text-xl">
                        📄
                      </span>
                      <div>
                        <h3 className="font-bold text-pebble text-sm">{cta.nombre}</h3>
                        <span className="text-[11px] text-purple-300 font-medium">
                          {cta.dia_vencimiento ? `Vence el día ${cta.dia_vencimiento} de cada mes` : 'Sin día fijado'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      title="Editar préstamo"
                      onClick={(e) => {
                        e.stopPropagation();
                        setErr(null);
                        setDraft({
                          id: cta.id,
                          nombre: cta.nombre,
                          tipo: cta.tipo,
                          saldo_inicial: cta.saldo_inicial ?? 0,
                          dia_cierre: null,
                          dia_vencimiento: cta.dia_vencimiento,
                          activa: cta.activa,
                          prestamo_monto_total: cta.montoTotalPrestamo,
                          prestamo_cuotas_totales: cta.cuotasTotales,
                          prestamo_cuota_actual: cta.cuotaActual,
                          prestamo_monto_cuota: cta.montoCuotaPrestamo,
                          prestamo_mes_inicio: cta.fechaPrimera.slice(0, 7),
                        });
                      }}
                      className="rounded-lg p-1.5 text-jade hover:bg-white/10 hover:text-pebble transition"
                    >
                      ✏️
                    </button>
                  </div>

                  {/* Cuota mensual y deuda pendiente */}
                  <div className="mt-3.5 flex items-baseline justify-between">
                    <div>
                      <span className="text-[10px] text-jade uppercase tracking-wider font-semibold">Cuota mensual</span>
                      <p className="num text-2xl font-extrabold text-debt mt-0.5">
                        -{money(cta.montoCuotaPrestamo)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-jade uppercase tracking-wider font-semibold">Deuda pendiente</span>
                      <p className="num text-sm font-bold text-pebble mt-0.5">
                        {money(cta.deudaRestante > 0 ? cta.deudaRestante : cta.totalEgresos)}
                      </p>
                    </div>
                  </div>

                  {/* Barra de progreso de cuotas */}
                  <div className="mt-3">
                    <div className="flex justify-between text-[11px] text-jade font-medium mb-1">
                      <span>Cuota {cta.cuotaActual} de {cta.cuotasTotales}</span>
                      <span>{pctAvance}% pagado</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-purple-500 to-teal transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(5, pctAvance))}%` }}
                      />
                    </div>
                  </div>

                  {/* Vencimiento final */}
                  <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-jade">
                    <span className="text-purple-200">
                      Finaliza en {monthLabel(`${cta.mesVencimientoFinal}-01`, { month: 'short', year: 'numeric' })}
                    </span>
                    <span>Quedan {cta.cuotasRestantes} cuota{cta.cuotasRestantes === 1 ? '' : 's'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Historial de Movimientos de la Cuenta seleccionada */}
      <section className="glass animate-rise p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="label text-sm">
              {cuentaFiltro
                ? `Movimientos de ${cuentas.find((c) => c.id === cuentaFiltro)?.nombre}`
                : 'Todos los movimientos de cuentas'}
            </h2>
            <p className="text-xs text-jade">
              {cuentaFiltro
                ? 'Mostrando solo los registros asociados a esta cuenta'
                : 'Tocá una tarjeta arriba para filtrar sus movimientos'}
            </p>
          </div>
          {cuentaFiltro && (
            <button
              onClick={() => setCuentaFiltro(null)}
              className="text-xs font-semibold text-cyan hover:underline self-start sm:self-auto"
            >
              ✕ Ver todas las cuentas
            </button>
          )}
        </div>

        <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-spruce-900/60 overflow-hidden">
          {movimientosFiltrados.slice(0, 50).map((m) => {
            const cat = m.categoria_id ? categorias.find((c) => c.id === m.categoria_id) : null;
            const cta = m.cuenta_id ? cuentas.find((c) => c.id === m.cuenta_id) : null;
            const esIngreso = m.tipo === 'ingreso';

            return (
              <div
                key={m.id}
                onClick={() => setEditingTx(m)}
                className="flex items-center justify-between p-3.5 hover:bg-white/5 transition cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-base">
                    {cat?.icono ?? (esIngreso ? '💰' : '📦')}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-pebble text-xs sm:text-sm truncate">{m.descripcion}</p>
                    <div className="flex items-center gap-2 text-[11px] text-jade mt-0.5">
                      <span>{new Date(m.fecha_compra + 'T12:00:00').toLocaleDateString('es-AR')}</span>
                      {cta && (
                        <span className="rounded bg-white/5 px-1.5 py-0.2">
                          {cuentaIcon(cta.tipo)} {cta.nombre}
                        </span>
                      )}
                      {m.cuotas_totales > 1 && (
                        <span className="rounded bg-white/5 px-1.5 py-0.2">
                          {m.cuota_actual}/{m.cuotas_totales} cuotas
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className={`num font-bold text-xs sm:text-sm ${esIngreso ? 'text-income' : 'text-debt'}`}>
                    {esIngreso ? '+' : '-'}{money(m.monto_total)}
                  </p>
                  {m.naturaleza === 'compartido' && (
                    <span className="text-[10px] text-jade block">
                      {m.porcentaje_propio}% propio
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {movimientosFiltrados.length === 0 && (
            <p className="p-8 text-center text-sm text-jade">No hay movimientos registrados para esta cuenta.</p>
          )}
        </div>
      </section>

      {/* Modal para Crear / Editar Cuenta o Préstamo */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={
          draft?.tipo === 'prestamo'
            ? draft?.id ? 'Editar préstamo' : 'Nuevo préstamo'
            : draft?.id ? 'Editar cuenta' : 'Nueva cuenta o billetera'
        }
      >
        {draft && (
          <div className="space-y-4">
            <label className="block">
              <span className="label">
                {draft.tipo === 'prestamo' ? 'Nombre o entidad del préstamo' : 'Nombre de la cuenta / billetera'}
              </span>
              <input
                autoFocus
                className={inputCls}
                value={draft.nombre}
                onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
                placeholder={
                  draft.tipo === 'prestamo'
                    ? 'Ej: Préstamo Banco Galicia, Crédito Auto'
                    : 'Ej: Mercado Pago, Galicia, Ualá, Efectivo'
                }
              />
            </label>

            <div>
              <span className="label">Tipo de cuenta</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {TIPOS_CUENTA.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setDraft({ ...draft, tipo: t.value })}
                    className={`rounded-2xl border px-3 py-2 text-left text-xs transition ${
                      draft.tipo === t.value
                        ? 'border-cyan bg-cyan/15 text-cyan font-semibold'
                        : 'border-white/10 bg-white/5 text-pebble/80 hover:bg-white/10'
                    }`}
                  >
                    {t.icon} {t.label.split('(')[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Saldo inicial para cuentas de dinero líquido */}
            {draft.tipo !== 'credito' && draft.tipo !== 'prestamo' && (
              <label className="block">
                <span className="label">Saldo actual inicial ($ ARS)</span>
                <input
                  type="number"
                  step="any"
                  className={inputCls}
                  value={draft.saldo_inicial || ''}
                  onChange={(e) => setDraft({ ...draft, saldo_inicial: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                />
                <span className="text-[11px] text-jade mt-1 block">
                  El dinero que tenés hoy en esta billetera o banco. A partir de acá se sumarán ingresos y restarán gastos.
                </span>
              </label>
            )}

            {/* Campos de Tarjeta de Crédito */}
            {draft.tipo === 'credito' && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label">Día de cierre</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className={inputCls}
                    value={draft.dia_cierre ?? ''}
                    onChange={(e) => setDraft({ ...draft, dia_cierre: Number(e.target.value) || null })}
                    placeholder="25"
                  />
                </label>
                <label className="block">
                  <span className="label">Día de vencimiento</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className={inputCls}
                    value={draft.dia_vencimiento ?? ''}
                    onChange={(e) => setDraft({ ...draft, dia_vencimiento: Number(e.target.value) || null })}
                    placeholder="5"
                  />
                </label>
              </div>
            )}

            {/* CAMPOS DEDICADOS PARA PRÉSTAMOS */}
            {draft.tipo === 'prestamo' && (
              <div className="space-y-3 rounded-2xl border border-purple-500/20 bg-purple-500/5 p-3.5">
                <p className="text-xs font-bold text-pebble flex items-center gap-2">
                  <span>📄</span> Configuración del Préstamo
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="label">Monto total ($ ARS)</span>
                    <input
                      type="number"
                      step="any"
                      className={inputCls}
                      value={draft.prestamo_monto_total || ''}
                      onChange={(e) => {
                        const tot = parseFloat(e.target.value) || 0;
                        const ctot = draft.prestamo_cuotas_totales || 1;
                        setDraft({
                          ...draft,
                          prestamo_monto_total: tot,
                          prestamo_monto_cuota: tot > 0 && ctot > 0 ? Math.round(tot / ctot) : 0,
                        });
                      }}
                      placeholder="Ej: 1200000"
                    />
                  </label>

                  <label className="block">
                    <span className="label">Cuotas totales</span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      className={inputCls}
                      value={draft.prestamo_cuotas_totales || ''}
                      onChange={(e) => {
                        const ctot = parseInt(e.target.value, 10) || 1;
                        const tot = draft.prestamo_monto_total || 0;
                        setDraft({
                          ...draft,
                          prestamo_cuotas_totales: ctot,
                          prestamo_monto_cuota: tot > 0 && ctot > 0 ? Math.round(tot / ctot) : 0,
                        });
                      }}
                      placeholder="Ej: 24"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="label">Monto cuota ($)</span>
                    <input
                      type="number"
                      step="any"
                      className={inputCls}
                      value={draft.prestamo_monto_cuota || ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          prestamo_monto_cuota: parseFloat(e.target.value) || 0,
                        })
                      }
                      placeholder="Ej: 50000"
                    />
                  </label>

                  <label className="block">
                    <span className="label">Empieza en cuota</span>
                    <input
                      type="number"
                      min={1}
                      max={draft.prestamo_cuotas_totales || 120}
                      className={inputCls}
                      value={draft.prestamo_cuota_actual ?? 1}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          prestamo_cuota_actual: parseInt(e.target.value, 10) || 1,
                        })
                      }
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="label">Mes 1ª cuota</span>
                    <input
                      type="month"
                      className={inputCls}
                      value={draft.prestamo_mes_inicio || todayISO().slice(0, 7)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          prestamo_mes_inicio: e.target.value,
                        })
                      }
                    />
                  </label>

                  <label className="block">
                    <span className="label">Día vencimiento (mes)</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      className={inputCls}
                      value={draft.dia_vencimiento ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          dia_vencimiento: Number(e.target.value) || null,
                        })
                      }
                      placeholder="Ej: 10"
                    />
                  </label>
                </div>

                {draft.prestamo_cuotas_totales && draft.prestamo_mes_inicio && (
                  <div className="rounded-xl bg-purple-500/10 p-2.5 text-xs text-pebble border border-purple-500/20">
                    <span className="text-jade block">Estimación de vencimiento:</span>
                    <span className="font-semibold text-purple-200">
                      Vence el día {draft.dia_vencimiento || '—'} de cada mes · Finaliza en{' '}
                      {monthLabel(
                        `${addMonths(
                          draft.prestamo_mes_inicio,
                          (draft.prestamo_cuotas_totales || 1) - (draft.prestamo_cuota_actual || 1),
                        )}-01`,
                        { month: 'long', year: 'numeric' },
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            {err && <p className="text-xs text-debt">{err}</p>}

            <div className="flex gap-2 pt-2">
              {draft.id && (
                <button
                  type="button"
                  onClick={removeCuenta}
                  className="rounded-xl border border-debt/30 py-2.5 px-4 text-xs font-semibold text-debt hover:bg-debt/10 transition"
                >
                  Eliminar
                </button>
              )}
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-medium text-jade hover:bg-white/5 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveCuenta}
                className="btn-primary flex-1 py-2.5 text-xs font-semibold"
              >
                Guardar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {editingTx && (
        <TransactionEditor
          tx={editingTx}
          categorias={categorias}
          cuentas={cuentas}
          onClose={() => {
            setEditingTx(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}
