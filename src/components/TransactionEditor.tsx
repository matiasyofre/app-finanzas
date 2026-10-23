'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase, type NaturalezaGasto, type PagadoPor } from '@/lib/supabase/client';
import { notifyChange } from '@/lib/offlineQueue';
import { cuentaIcon, type Categoria, type Cuenta } from '@/lib/catalogs';
import { addMonths, firstInstallmentMonth, todayISO, ymLabel } from '@/lib/cuotas';
import { parseAmount, splitInstallments } from '@/lib/parser/parseExpense';
import { money } from '@/lib/format';
import Modal from './Modal';

export type Transaccion = {
  id: string;
  tipo: 'ingreso' | 'egreso';
  naturaleza?: NaturalezaGasto;
  porcentaje_propio?: number;
  pagado_por?: PagadoPor;
  compartido_con?: string | null;
  saldado?: boolean;
  fecha_saldado?: string | null;
  es_recurrente?: boolean;
  descripcion: string;
  monto_total: number;
  monto_cuota: number;
  cuotas_totales: number;
  cuota_actual: number;
  fecha_compra: string;
  fecha_primera_cuota: string;
  categoria_id: string | null;
  cuenta_id: string | null;
};

type CuotaDetalle = {
  nro_cuota: number;
  mes: string;
  monto_nominal: number;
  monto_propio: number;
  cuota_saldada?: boolean;
};

const input =
  'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-pebble outline-none focus:border-cyan/60 [color-scheme:dark]';

export default function TransactionEditor({
  tx,
  categorias,
  cuentas,
  onClose,
}: {
  tx: Transaccion | null;
  categorias: Categoria[];
  cuentas: Cuenta[];
  onClose: () => void;
}) {
  const [f, setF] = useState<Transaccion | null>(tx);
  const [montoStr, setMontoStr] = useState('');
  const [modoMonto, setModoMonto] = useState<'total' | 'cuota'>('total');
  const [montoCuotaStr, setMontoCuotaStr] = useState('');
  const [mes, setMes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Estado para gestión y ajuste de cuotas específicas
  const [cuotasLista, setCuotasLista] = useState<CuotaDetalle[]>([]);
  const [mostrarCuotas, setMostrarCuotas] = useState(false);
  const [editandoCuota, setEditandoCuota] = useState<{ nro: number; monto: number } | null>(null);
  const [aplicarAFuturas, setAplicarAFuturas] = useState(true);

  // Cargar cronograma real de cuotas (para cuotas o proyección de 24 meses si es fijo/recurrente)
  const loadCuotas = useCallback(async (transaccionId: string, currentTx?: Transaccion | null) => {
    const sb = getSupabase();
    const target = currentTx || tx;
    const esFijoRec = target ? (target.naturaleza === 'fijo' || Boolean(target.es_recurrente)) : false;

    // 1. Obtener posibles ajustes de cuotas manuales
    const { data: customData } = await sb
      .from('transacciones_cuotas')
      .select('nro_cuota, monto_cuota, saldada')
      .eq('transaccion_id', transaccionId);

    const customMap = new Map((customData || []).map((x: any) => [x.nro_cuota, x]));

    // 2. Si es fijo / recurrente (ingreso o egreso), proyectamos 24 meses continuos hacia adelante
    if (esFijoRec && target) {
      const startYM = (target.fecha_primera_cuota || target.fecha_compra || todayISO()).slice(0, 7);
      const baseNominal = target.monto_cuota || target.monto_total || 0;
      const pctPropio = (target.porcentaje_propio ?? (target.compartido_con ? 50 : 100)) / 100;
      const list: CuotaDetalle[] = [];

      for (let c = 1; c <= 24; c++) {
        const cMes = addMonths(startYM, c - 1);
        const override = customMap.get(c);
        const nominal = override ? Number(override.monto_cuota) : baseNominal;
        list.push({
          nro_cuota: c,
          mes: cMes,
          monto_nominal: nominal,
          monto_propio: nominal * pctPropio,
          cuota_saldada: override ? Boolean(override.saldada) : Boolean(target.saldado),
        });
      }
      setCuotasLista(list);
      return;
    }

    // 3. Si es en cuotas tradicional (préstamo / tarjeta)
    const { data } = await sb
      .from('v_cronograma_cuotas')
      .select('nro_cuota, mes, monto_nominal, monto, cuota_saldada')
      .eq('transaccion_id', transaccionId)
      .order('nro_cuota');

    if (data && data.length > 0) {
      setCuotasLista(
        data.map((r) => ({
          nro_cuota: Number(r.nro_cuota),
          mes: (r.mes as string).slice(0, 7),
          monto_nominal: Number(r.monto_nominal),
          monto_propio: Number(r.monto),
          cuota_saldada: Boolean(r.cuota_saldada),
        })),
      );
    }
  }, [tx]);

  useEffect(() => {
    setF(tx);
    setErr(null);
    setMostrarCuotas(false);
    setEditandoCuota(null);
    setModoMonto('total');
    if (tx) {
      const esItemFijo = tx.naturaleza === 'fijo' || Boolean(tx.es_recurrente);
      const cNom = tx.monto_cuota || (tx.cuotas_totales > 0 ? tx.monto_total / tx.cuotas_totales : tx.monto_total);
      if (tx.tipo === 'ingreso' && esItemFijo && tx.monto_cuota > 0) {
        setMontoStr(String(tx.monto_cuota).replace('.', ','));
      } else {
        setMontoStr(String(tx.monto_total).replace('.', ','));
      }
      setMontoCuotaStr(String(Math.round(cNom * 100) / 100).replace('.', ','));
      setMes(tx.fecha_primera_cuota.slice(0, 7));
      if (tx.cuotas_totales > 1 || esItemFijo) {
        loadCuotas(tx.id, tx);
      }
    }
  }, [tx, loadCuotas]);

  const total = montoStr ? parseAmount(montoStr) : 0;
  const split = useMemo(() => (f && total > 0 ? splitInstallments(total, f.cuotas_totales) : null), [f, total]);

  if (!f) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const set = <K extends keyof Transaccion>(k: K, v: Transaccion[K]) => setF((p) => (p ? { ...p, [k]: v } : p));

  const recalc = (fecha: string, cuentaId: string | null) =>
    setMes(firstInstallmentMonth(fecha, cuentas.find((c) => c.id === cuentaId)));

  const toggleSaldado = async () => {
    const nuevoSaldado = !f.saldado;
    set('saldado', nuevoSaldado);
    setBusy(true);
    const { error } = await getSupabase()
      .from('transacciones')
      .update({
        saldado: nuevoSaldado,
        fecha_saldado: nuevoSaldado ? todayISO() : null,
      })
      .eq('id', f.id);
    setBusy(false);
    if (error) {
      set('saldado', !nuevoSaldado);
      return setErr(error.message);
    }
    notifyChange();
    if (f.cuotas_totales > 1 || f.naturaleza === 'fijo' || f.es_recurrente) {
      loadCuotas(f.id);
    }
  };

  const toggleCuotaSaldada = async (nroCuota: number, actual: boolean) => {
    setBusy(true);
    const sb = getSupabase();
    await sb.from('transacciones_cuotas').upsert(
      {
        transaccion_id: f.id,
        nro_cuota: nroCuota,
        monto_cuota: cuotasLista.find((x) => x.nro_cuota === nroCuota)?.monto_nominal || f.monto_cuota,
        saldada: !actual,
      },
      { onConflict: 'transaccion_id,nro_cuota' },
    );
    await loadCuotas(f.id, f);
    notifyChange();
    setBusy(false);
  };

  const save = async () => {
    if (!f.descripcion.trim() || !(total > 0) || f.cuotas_totales < 1) return setErr('Revisá descripción, monto y cuotas.');
    setBusy(true);
    const esFijo = f.naturaleza === 'fijo' || Boolean(f.es_recurrente);
    const { error } = await getSupabase()
      .from('transacciones')
      .update({
        tipo: f.tipo,
        naturaleza: esFijo ? 'fijo' : (esComp ? 'compartido' : 'variable'),
        es_recurrente: esFijo,
        porcentaje_propio: esComp ? (f.porcentaje_propio ?? 50) : 100,
        pagado_por: esComp ? (f.pagado_por ?? 'yo') : 'yo',
        compartido_con: esComp ? (f.compartido_con?.trim() || null) : null,
        saldado: f.saldado ?? false,
        descripcion: f.descripcion.trim(),
        monto_total: esFijo && f.tipo === 'ingreso' ? total * Math.max(f.cuotas_totales, 12) : total,
        monto_cuota: esFijo ? total : (modoMonto === 'cuota' ? parseAmount(montoCuotaStr) : (total / f.cuotas_totales)),
        cuotas_totales: esFijo && f.tipo === 'ingreso' ? Math.max(f.cuotas_totales, 12) : f.cuotas_totales,
        cuota_actual: Math.min(f.cuota_actual, esFijo && f.tipo === 'ingreso' ? Math.max(f.cuotas_totales, 12) : f.cuotas_totales),
        fecha_compra: f.fecha_compra,
        fecha_primera_cuota: `${mes}-01`,
        categoria_id: f.categoria_id,
        cuenta_id: f.cuenta_id,
      })
      .eq('id', f.id);
    setBusy(false);
    if (error) return setErr(error.message);
    notifyChange();
    onClose();
  };

  const remove = async () => {
    if (!confirm(`¿Eliminar "${f.descripcion}"? Se borran todas sus cuotas.`)) return;
    setBusy(true);
    const { error } = await getSupabase().from('transacciones').delete().eq('id', f.id);
    setBusy(false);
    if (error) return setErr(error.message);
    notifyChange();
    onClose();
  };

  const guardarAjusteCuota = async () => {
    if (!editandoCuota || !f) return;
    setBusy(true);
    const sb = getSupabase();
    try {
      const { error: rpcErr } = await sb.rpc('ajustar_cuota_transaccion', {
        p_transaccion_id: f.id,
        p_desde_cuota: editandoCuota.nro,
        p_nuevo_monto: editandoCuota.monto,
        p_aplicar_a_futuras: aplicarAFuturas,
      });

      if (rpcErr) {
        const maxCuotas = f.naturaleza === 'fijo' || f.es_recurrente ? 24 : f.cuotas_totales;
        const hasta = aplicarAFuturas ? maxCuotas : editandoCuota.nro;
        const inserts = [];
        for (let c = editandoCuota.nro; c <= hasta; c++) {
          inserts.push({
            transaccion_id: f.id,
            nro_cuota: c,
            monto_cuota: editandoCuota.monto,
          });
        }
        await sb.from('transacciones_cuotas').upsert(inserts, { onConflict: 'transaccion_id,nro_cuota' });
      }

      await loadCuotas(f.id, f);
      notifyChange();
      setEditandoCuota(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al guardar el ajuste';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  const mesActualYM = todayISO().slice(0, 7);
  const esFijo = f.naturaleza === 'fijo' || Boolean(f.es_recurrente);
  const esComp =
    f.tipo === 'egreso' &&
    (f.naturaleza === 'compartido' ||
      (f.porcentaje_propio != null && f.porcentaje_propio < 100) ||
      Boolean(f.compartido_con) ||
      f.pagado_por === 'otro');
  const labelSaldado = esComp
    ? f.pagado_por === 'yo'
      ? f.saldado ? '✓ Ya cobraste tu parte' : '💰 Marcar como COBRADO'
      : f.saldado ? '✓ Ya pagaste tu parte' : '💸 Marcar como PAGADO'
    : f.saldado ? '✓ Movimiento saldado' : '✓ Marcar como saldado/pagado';

  return (
    <Modal open onClose={onClose} title="Editar movimiento">
      <div className="space-y-3.5">
        {/* BOTÓN RÁPIDO DE SALDADO / COBRADO / PAGADO */}
        <div className="flex items-center justify-between rounded-2xl bg-white/5 p-2.5">
          <div>
            <span className="text-xs font-semibold text-pebble">Estado de liquidación</span>
            <p className="text-[11px] text-jade">
              {f.saldado ? 'Sin deudas ni saldos pendientes.' : 'Pendiente de cobro o pago.'}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleSaldado}
            disabled={busy}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition shadow-sm ${
              f.saldado
                ? 'bg-income/20 text-income border border-income/40'
                : 'bg-white/10 text-pebble hover:bg-white/20'
            }`}
          >
            {labelSaldado}
          </button>
        </div>

        <div className="flex rounded-full bg-white/5 p-1 text-sm">
          {(['egreso', 'ingreso'] as const).map((t) => (
            <button
              key={t}
              onClick={() => set('tipo', t)}
              className={`flex-1 rounded-full py-1.5 capitalize ${f.tipo === t ? (t === 'ingreso' ? 'bg-income/20 text-income font-medium' : 'bg-debt/20 text-debt font-medium') : 'text-jade'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Clasificación independiente: Variable vs Fijo + Toggle Compartido */}
        {f.tipo === 'egreso' && (
          <div className="flex gap-2">
            <div className="flex flex-1 gap-1 rounded-xl bg-white/5 p-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  set('es_recurrente', false);
                  set('naturaleza', esComp ? 'compartido' : 'variable');
                  if (tx) loadCuotas(tx.id, { ...f, es_recurrente: false, naturaleza: esComp ? 'compartido' : 'variable' });
                }}
                className={`flex-1 rounded-lg py-1.5 transition ${
                  !esFijo ? 'bg-white/15 text-pebble font-bold shadow-sm' : 'text-jade hover:text-pebble'
                }`}
              >
                ⚡ Variable
              </button>
              <button
                type="button"
                onClick={() => {
                  set('es_recurrente', true);
                  set('naturaleza', 'fijo');
                  if (tx) loadCuotas(tx.id, { ...f, es_recurrente: true, naturaleza: 'fijo' });
                }}
                className={`flex-1 rounded-lg py-1.5 transition ${
                  esFijo ? 'bg-teal/40 text-cyan font-bold shadow-sm' : 'text-jade hover:text-pebble'
                }`}
              >
                📌 Fijo
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                if (esComp) {
                  set('porcentaje_propio', 100);
                  set('compartido_con', null);
                  set('pagado_por', 'yo');
                  set('naturaleza', esFijo ? 'fijo' : 'variable');
                } else {
                  set('porcentaje_propio', 50);
                  if (!esFijo) set('naturaleza', 'compartido');
                }
              }}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition border ${
                esComp
                  ? 'border-amber-400/50 bg-amber-500/20 text-amber-200 shadow-sm'
                  : 'border-white/10 bg-white/5 text-jade hover:text-pebble'
              }`}
            >
              <span>👥</span>
              <span>Compartido</span>
              {esComp && <span className="ml-0.5 text-amber-300">✓</span>}
            </button>
          </div>
        )}

        {/* Clasificación para Ingresos: Recurrente mensual vs Puntual */}
        {f.tipo === 'ingreso' && (
          <div className="flex gap-2">
            <div className="flex flex-1 gap-1 rounded-xl bg-white/5 p-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  set('es_recurrente', true);
                  set('naturaleza', 'fijo');
                  if (tx) loadCuotas(tx.id, { ...f, es_recurrente: true, naturaleza: 'fijo' });
                }}
                className={`flex-1 rounded-lg py-2 transition flex items-center justify-center gap-1.5 ${
                  esFijo ? 'bg-income/20 text-income font-bold border border-income/30 shadow-sm' : 'text-jade hover:text-pebble'
                }`}
              >
                <span>🔁</span>
                <span>Recurrente mensual (para adelante)</span>
                {esFijo && <span className="ml-0.5 text-income font-bold">✓</span>}
              </button>
              <button
                type="button"
                onClick={() => {
                  set('es_recurrente', false);
                  set('naturaleza', 'variable');
                  if (tx) loadCuotas(tx.id, { ...f, es_recurrente: false, naturaleza: 'variable' });
                }}
                className={`flex-1 rounded-lg py-2 transition flex items-center justify-center gap-1.5 ${
                  !esFijo ? 'bg-white/15 text-pebble font-bold shadow-sm' : 'text-jade hover:text-pebble'
                }`}
              >
                <span>⚡</span>
                <span>Puntual (solo este mes)</span>
                {!esFijo && <span className="ml-0.5 text-pebble font-bold">✓</span>}
              </button>
            </div>
          </div>
        )}

        {/* Detalle si es compartido */}
        {esComp && (
          <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <div>
              <span className="label text-[10px] text-amber-300">¿Quién pagó el gasto?</span>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => set('pagado_por', 'yo')}
                  className={`flex-1 rounded-lg py-1 px-2 text-xs transition ${
                    (f.pagado_por ?? 'yo') === 'yo'
                      ? 'bg-amber-500/30 text-amber-200 font-bold border border-amber-400'
                      : 'bg-white/5 text-jade'
                  }`}
                >
                  🙋‍♂️ Lo pagué yo
                </button>
                <button
                  type="button"
                  onClick={() => set('pagado_por', 'otro')}
                  className={`flex-1 rounded-lg py-1 px-2 text-xs transition ${
                    f.pagado_por === 'otro'
                      ? 'bg-amber-500/30 text-amber-200 font-bold border border-amber-400'
                      : 'bg-white/5 text-jade'
                  }`}
                >
                  👥 Lo pagó otra persona
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="label text-[10px]">Tu parte (%)</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className={`${input} num`}
                  value={f.porcentaje_propio ?? 50}
                  onChange={(e) => set('porcentaje_propio', Math.min(100, Math.max(1, Number(e.target.value) || 50)))}
                />
              </div>
              <div>
                <span className="label text-[10px]">Compartido con</span>
                <input
                  className={input}
                  value={f.compartido_con ?? ''}
                  placeholder="Ej: Pareja"
                  onChange={(e) => set('compartido_con', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <label className="block">
          <span className="label">Descripción</span>
          <input id="edit-desc" className={input} value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} />
        </label>

        <div>
          {f.cuotas_totales > 1 && (
            <div className="flex items-center justify-between pb-1.5">
              <div className="flex items-center gap-1 rounded-lg bg-white/5 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setModoMonto('total')}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                    modoMonto === 'total' ? 'bg-cyan/20 text-cyan font-bold shadow-sm' : 'text-jade hover:text-pebble'
                  }`}
                >
                  Total general
                </button>
                <button
                  type="button"
                  onClick={() => setModoMonto('cuota')}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                    modoMonto === 'cuota' ? 'bg-cyan/20 text-cyan font-bold shadow-sm' : 'text-jade hover:text-pebble'
                  }`}
                >
                  Importe por cuota
                </button>
              </div>

              <span className="text-[11px] text-jade">
                {modoMonto === 'total'
                  ? `${f.cuotas_totales} cuotas de ${money(total / f.cuotas_totales)}`
                  : `Total: ${money(total)}`}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">
                {f.tipo === 'ingreso' && esFijo
                  ? 'Ingreso mensual'
                  : (modoMonto === 'cuota' && f.cuotas_totales > 1 ? 'Importe por cuota' : 'Monto total')}
              </span>
              <input
                id="edit-monto"
                inputMode="decimal"
                className={`${input} num`}
                value={modoMonto === 'cuota' && f.cuotas_totales > 1 ? montoCuotaStr : montoStr}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^\d.,]/g, '');
                  if (modoMonto === 'cuota' && f.cuotas_totales > 1) {
                    setMontoCuotaStr(val);
                    const nVal = parseAmount(val) * f.cuotas_totales;
                    setMontoStr(String(Math.round(nVal * 100) / 100).replace('.', ','));
                  } else {
                    setMontoStr(val);
                    if (f.cuotas_totales > 1) {
                      const cVal = parseAmount(val) / f.cuotas_totales;
                      setMontoCuotaStr(String(Math.round(cVal * 100) / 100).replace('.', ','));
                    }
                  }
                }}
              />
            </label>
            <label className="block">
              <span className="label">Fecha compra</span>
              <input
                id="edit-fecha"
                type="date"
                className={input}
                value={f.fecha_compra}
                onChange={(e) => { set('fecha_compra', e.target.value); if (e.target.value) recalc(e.target.value, f.cuenta_id); }}
              />
            </label>
          </div>
        </div>

        {f.tipo === 'ingreso' && esFijo ? (
          <div className="rounded-xl border border-income/30 bg-income/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-income">🔁 Proyección mensual hacia adelante</span>
              <span className="text-[11px] text-jade">Ingreso continuo</span>
            </div>
            <p className="text-xs text-pebble">
              Se registrará un ingreso de <strong className="text-income">{money(total)}</strong> todos los meses a partir de <strong>{ymLabel(mes)}</strong>.
            </p>
            <p className="text-[11px] text-jade">
              💡 Podés programar aumentos futuros o ajustes tocando <strong>&quot;Ver meses&quot;</strong> en la sección de ajuste de abajo.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Cuotas totales</span>
              <input
                id="edit-cuotas"
                type="number"
                min={1}
                className={`${input} num`}
                value={f.cuotas_totales}
                onChange={(e) => {
                  const newCuotas = Math.max(1, Number(e.target.value) || 1);
                  set('cuotas_totales', newCuotas);
                  if (modoMonto === 'cuota' && newCuotas > 1) {
                    const cVal = parseAmount(montoCuotaStr);
                    setMontoStr(String(Math.round(cVal * newCuotas * 100) / 100).replace('.', ','));
                  } else if (total > 0) {
                    setMontoCuotaStr(String(Math.round((total / newCuotas) * 100) / 100).replace('.', ','));
                  }
                }}
              />
            </label>
            <label className="block">
              <span className="label">Empieza en cuota</span>
              <input id="edit-cuota-actual" type="number" min={1} max={f.cuotas_totales} className={`${input} num`} value={f.cuota_actual} onChange={(e) => set('cuota_actual', Math.max(1, Number(e.target.value) || 1))} />
            </label>
          </div>
        )}

        <label className="block">
          <span className="label">Medio de pago / Préstamo / Tarjeta</span>
          <select
            id="edit-cuenta"
            className={input}
            value={f.cuenta_id ?? ''}
            onChange={(e) => { const v = e.target.value || null; set('cuenta_id', v); recalc(f.fecha_compra, v); }}
          >
            <option value="">— Sin cuenta / Tarjeta —</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {cuentaIcon(c.tipo)} {c.nombre} {c.tipo === 'prestamo' ? '(Préstamo)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Mes de la {f.cuota_actual > 1 ? `cuota ${f.cuota_actual}` : '1ª cuota'}</span>
          <input id="edit-mes" type="month" className={input} value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
          {f.cuotas_totales > 1 && mes && (
            <span className="mt-1 block text-xs text-jade">
              Última cuota: {ymLabel(addMonths(mes, f.cuotas_totales - f.cuota_actual))}
            </span>
          )}
        </label>

        <label className="block">
          <span className="label">Categoría</span>
          <select id="edit-categoria" className={input} value={f.categoria_id ?? ''} onChange={(e) => set('categoria_id', e.target.value || null)}>
            <option value="">— Sin categoría —</option>
            {categorias.filter((c) => c.tipo === f.tipo).map((c) => (
              <option key={c.id} value={c.id}>{c.icono} {c.nombre}</option>
            ))}
          </select>
        </label>

        {/* CRONOGRAMA DE CUOTAS Y AJUSTE POR INFLACIÓN / TARIFA */}
        {(f.cuotas_totales > 1 || f.naturaleza === 'fijo' || f.es_recurrente) && (
          <div className="rounded-2xl border border-cyan/20 bg-cyan/5 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-pebble">
                  {f.naturaleza === 'fijo' || f.es_recurrente
                    ? (f.tipo === 'ingreso' ? 'Ajuste de ingresos futuros / aumentos' : 'Ajuste mensual por inflación / tarifa')
                    : 'Ajuste de cuotas por inflación / tasa'}
                </p>
                <p className="text-[11px] text-jade">
                  {f.naturaleza === 'fijo' || f.es_recurrente
                    ? (f.tipo === 'ingreso' ? 'Podés variar el importe de un mes futuro sin alterar meses pasados' : 'Podés variar el importe de un mes sin alterar los meses anteriores')
                    : 'Permite cambiar el importe futuro sin alterar meses pasados'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMostrarCuotas(!mostrarCuotas)}
                className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-medium text-cyan hover:bg-white/15"
              >
                {mostrarCuotas ? 'Ocultar' : f.naturaleza === 'fijo' || f.es_recurrente ? 'Ver meses' : 'Ver cuotas'}
              </button>
            </div>

            {mostrarCuotas && (
              <div className="mt-3 space-y-2 border-t border-white/10 pt-2.5">
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1 no-scrollbar">
                  {cuotasLista.map((c) => {
                    const esPasada = c.mes < mesActualYM;
                    const esActual = c.mes === mesActualYM;
                    const estaSaldada = f.saldado || c.cuota_saldada;

                    return (
                      <div
                        key={c.nro_cuota}
                        className={`flex items-center justify-between rounded-xl px-3 py-1.5 text-xs ${
                          estaSaldada
                            ? 'bg-income/10 border border-income/20'
                            : esActual
                            ? 'bg-cyan/20 border border-cyan/30'
                            : esPasada
                            ? 'bg-white/[0.02] opacity-60'
                            : 'bg-white/5'
                        }`}
                      >
                        <div>
                          <span className="font-semibold text-pebble">
                            {f.naturaleza === 'fijo' || f.es_recurrente ? ymLabel(c.mes) : `Cuota ${c.nro_cuota}`}
                          </span>
                          {!(f.naturaleza === 'fijo' || f.es_recurrente) && (
                            <span className="ml-2 text-jade">{ymLabel(c.mes)}</span>
                          )}
                          {estaSaldada ? (
                            <span className="ml-2 text-[10px] text-income font-bold">
                              {f.tipo === 'ingreso' ? '✓ Cobrado' : '✓ Saldada'}
                            </span>
                          ) : esActual ? (
                            <span className="ml-2 text-[10px] text-cyan font-bold">(Mes actual)</span>
                          ) : esPasada ? (
                            <span className="ml-2 text-[10px] text-jade">(Pasada)</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="num font-bold text-pebble">{money(c.monto_nominal)}</span>
                          <button
                            type="button"
                            title={estaSaldada ? 'Marcar pendiente' : f.tipo === 'ingreso' ? 'Marcar cobrado' : 'Marcar pagada'}
                            onClick={() => toggleCuotaSaldada(c.nro_cuota, Boolean(c.cuota_saldada))}
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              estaSaldada ? 'bg-income/20 text-income' : 'bg-white/10 text-jade hover:text-pebble'
                            }`}
                          >
                            {estaSaldada ? '✓' : f.tipo === 'ingreso' ? 'Cobrar' : 'Saldar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditandoCuota({ nro: c.nro_cuota, monto: c.monto_nominal })}
                            className="rounded px-2 py-0.5 text-[11px] bg-white/10 text-cyan hover:bg-white/20"
                          >
                            Modificar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Sub-formulario para editar la cuota seleccionada */}
                {editandoCuota && (
                  <div className="rounded-xl border border-cyan/40 bg-spruce-900/90 p-3 mt-2 space-y-2.5">
                    <p className="text-xs font-bold text-cyan">
                      Modificar Cuota {editandoCuota.nro} ({cuotasLista.find((x) => x.nro_cuota === editandoCuota.nro)?.mes})
                    </p>
                    <label className="block">
                      <span className="text-[11px] text-jade">Nuevo valor de la cuota:</span>
                      <input
                        type="number"
                        step="any"
                        className={`${input} num mt-1`}
                        value={editandoCuota.monto}
                        onChange={(e) => setEditandoCuota({ ...editandoCuota, monto: Number(e.target.value) || 0 })}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-pebble cursor-pointer">
                      <input
                        type="checkbox"
                        checked={aplicarAFuturas}
                        onChange={(e) => setAplicarAFuturas(e.target.checked)}
                        className="h-4 w-4 accent-cyan"
                      />
                      <span>Aplicar este nuevo valor a partir de esta cuota y a todas las futuras</span>
                    </label>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setEditandoCuota(null)}
                        className="flex-1 rounded-xl bg-white/10 py-1.5 text-xs text-jade hover:text-pebble"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={guardarAjusteCuota}
                        disabled={busy}
                        className="flex-1 btn-primary py-1.5 text-xs font-semibold"
                      >
                        {busy ? 'Guardando…' : 'Actualizar importe'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {err && <p className="text-sm text-debt">{err}</p>}

        <div className="flex gap-3 pt-2">
          <button id="edit-delete" onClick={remove} disabled={busy} className="rounded-2xl border border-debt/40 px-4 py-2.5 text-debt transition hover:bg-debt/10">
            Eliminar
          </button>
          <button id="edit-save" onClick={save} disabled={busy} className="btn-primary flex-1 py-2.5">
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
