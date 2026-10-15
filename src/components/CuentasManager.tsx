'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { notifyCatalogs, cuentaIcon, TIPOS_CUENTA, useCatalogs, type Cuenta, type TipoCuenta } from '@/lib/catalogs';
import { TX_EVENT, notifyChange } from '@/lib/offlineQueue';
import { money } from '@/lib/format';
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
};

const emptyDraft: CuentaDraft = {
  nombre: '',
  tipo: 'billetera',
  saldo_inicial: 0,
  dia_cierre: null,
  dia_vencimiento: null,
  activa: true,
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

  // Cálculo de saldos por cuenta
  const cuentasConSaldo = useMemo(() => {
    return cuentas.map((cta) => {
      const txsDeEstaCuenta = movimientos.filter((t) => t.cuenta_id === cta.id);

      let totalIngresos = 0;
      let totalEgresos = 0;

      for (const t of txsDeEstaCuenta) {
        // En cuentas bancarias/billeteras, el dinero sale según quién pagó
        if (t.tipo === 'ingreso') {
          totalIngresos += t.monto_total;
        } else {
          // Si lo pagué yo, salió el total de mi cuenta (aunque después me deban)
          // Si lo pagó otro, no salió de mi cuenta
          if (t.pagado_por === 'yo') {
            totalEgresos += t.monto_total;
          }
        }
      }

      const saldoInicial = Number(cta.saldo_inicial ?? 0);
      const saldoActual = saldoInicial + totalIngresos - totalEgresos;

      return {
        ...cta,
        saldo_inicial: saldoInicial,
        saldoActual,
        totalIngresos,
        totalEgresos,
        movimientosCount: txsDeEstaCuenta.length,
      };
    });
  }, [cuentas, movimientos]);

  // Cuentas de dinero disponible (bancos, billeteras, débito, efectivo)
  const cuentasDisponibles = useMemo(
    () => cuentasConSaldo.filter((c) => c.tipo !== 'credito' && c.tipo !== 'prestamo'),
    [cuentasConSaldo],
  );

  // Tarjetas de crédito y préstamos (pasivos)
  const cuentasCredito = useMemo(
    () => cuentasConSaldo.filter((c) => c.tipo === 'credito' || c.tipo === 'prestamo'),
    [cuentasConSaldo],
  );

  // Total consolidado de dinero disponible
  const totalDineroDisponible = useMemo(
    () => cuentasDisponibles.reduce((sum, c) => sum + c.saldoActual, 0),
    [cuentasDisponibles],
  );

  // Movimientos filtrados para el historial
  const movimientosFiltrados = useMemo(() => {
    if (!cuentaFiltro) return movimientos;
    return movimientos.filter((m) => m.cuenta_id === cuentaFiltro);
  }, [movimientos, cuentaFiltro]);

  const saveCuenta = async () => {
    if (!draft?.nombre.trim()) return setErr('Ingresá el nombre de la cuenta o billetera.');
    setErr(null);

    const sb = getSupabase();
    const esCredito = draft.tipo === 'credito';

    const payload = {
      nombre: draft.nombre.trim(),
      tipo: draft.tipo,
      saldo_inicial: Number(draft.saldo_inicial) || 0,
      dia_cierre: esCredito ? draft.dia_cierre : null,
      dia_vencimiento: esCredito ? draft.dia_vencimiento : null,
      activa: draft.activa,
    };

    try {
      const { error } = draft.id
        ? await sb.from('cuentas_tarjetas').update(payload).eq('id', draft.id)
        : await sb.from('cuentas_tarjetas').insert(payload);

      if (error) {
        // Si la columna saldo_inicial aún no se corrió en SQL, reintentar sin ella
        if (error.message.includes('saldo_inicial')) {
          delete (payload as Record<string, unknown>).saldo_inicial;
          const retry = draft.id
            ? await sb.from('cuentas_tarjetas').update(payload).eq('id', draft.id)
            : await sb.from('cuentas_tarjetas').insert(payload);
          if (retry.error) throw retry.error;
        } else {
          throw error;
        }
      }

      notifyCatalogs();
      notifyChange();
      setDraft(null);
      loadData();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error al guardar la cuenta');
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
          <button
            type="button"
            onClick={() => { setErr(null); setDraft({ ...emptyDraft }); }}
            className="btn-primary py-2.5 px-4 text-xs font-semibold self-start sm:self-auto"
          >
            ＋ Nueva cuenta / billetera
          </button>
        </div>
      </section>

      {/* Grilla de Billeteras y Bancos */}
      <section className="space-y-3">
        <h2 className="label text-sm">Billeteras virtuales y cuentas bancarias</h2>
        {cuentasDisponibles.length === 0 && !loading && (
          <div className="glass p-6 text-center text-sm text-jade">
            No tenés cuentas ni billeteras creadas todavía. Creá una para llevar el control de tus saldos reales.
          </div>
        )}
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

                {/* Saldo actual */}
                <div className="mt-4">
                  <span className="text-[10px] text-jade uppercase tracking-wider font-semibold">Saldo Actual</span>
                  <p className={`num text-2xl font-bold mt-0.5 ${cta.saldoActual >= 0 ? 'text-income' : 'text-debt'}`}>
                    {money(cta.saldoActual)}
                  </p>
                </div>

                {/* Detalle de flujo */}
                <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-jade">
                  <span>Inicial: {money(cta.saldo_inicial)}</span>
                  <span>{cta.movimientosCount} movs</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Tarjetas de Crédito y Préstamos */}
      {cuentasCredito.length > 0 && (
        <section className="space-y-3">
          <h2 className="label text-sm">Tarjetas de crédito y préstamos</h2>
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
                          {cta.tipo === 'credito' ? 'Crédito' : 'Préstamo'}
                          {cta.dia_cierre ? ` · Cierra día ${cta.dia_cierre}` : ''}
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

      {/* Historial de Movimientos de la Cuenta */}
      <section className="glass animate-rise p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="label text-sm">
              {cuentaFiltro
                ? `Movimientos en ${cuentas.find((c) => c.id === cuentaFiltro)?.nombre ?? 'Cuenta'}`
                : 'Últimos movimientos en todas las cuentas'}
            </h2>
            <p className="text-xs text-jade">
              {cuentaFiltro ? 'Mostrando sólo los movimientos asociados a esta cuenta' : 'Tocá una cuenta arriba para filtrar'}
            </p>
          </div>
          {cuentaFiltro && (
            <button
              type="button"
              onClick={() => setCuentaFiltro(null)}
              className="text-xs text-cyan hover:underline self-start sm:self-auto"
            >
              ✕ Quitar filtro y ver todas
            </button>
          )}
        </div>

        {/* Lista de movimientos */}
        <div className="divide-y divide-white/5 rounded-2xl border border-white/5 overflow-hidden">
          {movimientosFiltrados.slice(0, 50).map((m) => {
            const cta = cuentas.find((c) => c.id === m.cuenta_id);
            const esIngreso = m.tipo === 'ingreso';
            return (
              <div
                key={m.id}
                onClick={() => setEditingTx(m)}
                className="flex items-center justify-between p-3.5 hover:bg-white/5 transition cursor-pointer gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{cta ? cuentaIcon(cta.tipo) : '💵'}</span>
                    <p className="font-semibold text-pebble text-sm truncate">{m.descripcion}</p>
                  </div>
                  <p className="text-[11px] text-jade mt-0.5">
                    {m.fecha_compra} · {cta?.nombre ?? 'Sin cuenta asociada'}
                    {m.cuotas_totales > 1 ? ` · Cuota ${m.cuota_actual}/${m.cuotas_totales}` : ''}
                    {m.naturaleza === 'compartido' ? ` · Dividido (${m.porcentaje_propio}%)` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`num font-bold text-sm ${esIngreso ? 'text-income' : 'text-debt'}`}>
                    {esIngreso ? '+' : '-'}{money(m.monto_total)}
                  </p>
                  {m.naturaleza === 'compartido' && (
                    <span className="text-[10px] text-amber-300 block">
                      Tu parte: {money(m.monto_total * ((m.porcentaje_propio ?? 100) / 100))}
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

      {/* Modal para Crear / Editar Cuenta */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Editar cuenta o billetera' : 'Nueva cuenta o billetera'}
      >
        {draft && (
          <div className="space-y-4">
            <label className="block">
              <span className="label">Nombre de la cuenta / billetera</span>
              <input
                autoFocus
                className={inputCls}
                value={draft.nombre}
                onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
                placeholder="Ej: Mercado Pago, Galicia, Ualá, Efectivo"
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

            {err && <p className="text-xs text-debt">{err}</p>}

            <div className="flex gap-2 pt-2">
              {draft.id && (
                <button
                  type="button"
                  onClick={removeCuenta}
                  className="rounded-xl border border-debt/40 px-3.5 py-2.5 text-xs text-debt hover:bg-debt/10 transition"
                >
                  Eliminar
                </button>
              )}
              <button
                type="button"
                onClick={saveCuenta}
                className="btn-primary flex-1 py-2.5 text-xs font-semibold"
              >
                Guardar cuenta
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal para editar movimiento si se clickea en la lista */}
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
