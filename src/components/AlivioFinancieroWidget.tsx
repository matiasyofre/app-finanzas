'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { TX_EVENT } from '@/lib/offlineQueue';
import { money, monthLabel } from '@/lib/format';
import { addMonths, todayISO } from '@/lib/cuotas';

type PlanTermina = {
  descripcion: string;
  montoCuota: number;
  cuotas_totales: number;
  naturaleza: string;
  cuenta_nombre?: string;
};

type MesAlivio = {
  mesYM: string;
  label: string;
  comprometido: number;
  liberadoMes: number;
  alivioAcumulado: number;
  planesQueTerminan: PlanTermina[];
};

export default function AlivioFinancieroWidget() {
  const [loading, setLoading] = useState(true);
  const [proyeccion, setProyeccion] = useState<MesAlivio[]>([]);
  const [mostrarProyeccion, setMostrarProyeccion] = useState(false);
  const [mesDetalle, setMesDetalle] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getSupabase();
    const startYM = todayISO().slice(0, 7);

    try {
      // Obtenemos todas las transacciones activas y sus cuotas custom
      const [txRes, cuotasRes] = await Promise.all([
        sb
          .from('transacciones')
          .select('id,descripcion,monto_total,cuotas_totales,cuota_actual,monto_cuota,fecha_compra,fecha_primera_cuota,tipo,naturaleza,porcentaje_propio,es_recurrente,cuenta_id,cuentas_tarjetas(nombre,tipo)')
          .eq('tipo', 'egreso'),
        sb.from('transacciones_cuotas').select('transaccion_id,nro_cuota,monto_cuota'),
      ]);

      const txs = (txRes.data ?? []) as any[];
      const customCuotas = (cuotasRes.data ?? []) as any[];
      const customMap = new Map<string, number>();
      for (const cc of customCuotas) {
        customMap.set(`${cc.transaccion_id}:${cc.nro_cuota}`, Number(cc.monto_cuota));
      }

      // Proyectamos 12 meses hacia adelante
      const meses12: MesAlivio[] = Array.from({ length: 12 }).map((_, i) => {
        const ym = addMonths(startYM, i);
        return {
          mesYM: ym,
          label: monthLabel(`${ym}-01`, { month: 'short' }),
          comprometido: 0,
          liberadoMes: 0,
          alivioAcumulado: 0,
          planesQueTerminan: [],
        };
      });

      const mesMap = new Map<string, MesAlivio>(meses12.map((m) => [m.mesYM, m]));

      for (const tx of txs) {
        const esFijo = tx.naturaleza === 'fijo' || Boolean(tx.es_recurrente);
        const pct = Number(tx.porcentaje_propio ?? 100) / 100;
        const cuotasTot = Number(tx.cuotas_totales || 1);
        const cuotaAct = Number(tx.cuota_actual || 1);
        const baseYM = (tx.fecha_primera_cuota ? tx.fecha_primera_cuota.slice(0, 7) : tx.fecha_compra.slice(0, 7));
        const montoBase = Number(tx.monto_cuota || (tx.monto_total / cuotasTot)) * pct;
        const cuentaNombre = tx.cuentas_tarjetas?.nombre || 'General';

        if (esFijo) {
          // Gasto fijo: Se propaga por todos los meses proyectados desde baseYM.
          // NO se libera porque nunca termina (se mantiene constante o se ajusta por inflación).
          for (let m = 0; m < 12; m++) {
            const ym = addMonths(startYM, m);
            if (ym >= baseYM) {
              const item = mesMap.get(ym);
              if (item) {
                const customMonto = customMap.get(`${tx.id}:${m + 1}`);
                item.comprometido += (customMonto !== undefined ? customMonto * pct : montoBase);
              }
            }
          }
        } else if (cuotasTot > 1) {
          // Compra en cuotas o préstamo: tiene un cronograma finito cuota por cuota
          for (let c = cuotaAct; c <= cuotasTot; c++) {
            const monthOffset = c - cuotaAct;
            const ym = addMonths(baseYM, monthOffset);
            const item = mesMap.get(ym);
            if (item) {
              const customMonto = customMap.get(`${tx.id}:${c}`);
              const val = customMonto !== undefined ? customMonto * pct : montoBase;
              item.comprometido += val;

              // En la última cuota, se registra que este plan finaliza en este mes
              if (c === cuotasTot) {
                item.liberadoMes += val;
                item.planesQueTerminan.push({
                  descripcion: tx.descripcion,
                  montoCuota: val,
                  cuotas_totales: cuotasTot,
                  naturaleza: tx.naturaleza || 'variable',
                  cuenta_nombre: cuentaNombre,
                });
              }
            }
          }
        } else {
          // Gasto variable de 1 solo pago (efectivo, transferencia, QR)
          // Impacta únicamente en su mes de compra. En el mes siguiente se libera.
          const item = mesMap.get(baseYM);
          if (item) {
            item.comprometido += montoBase;
            item.liberadoMes += montoBase;
            item.planesQueTerminan.push({
              descripcion: tx.descripcion,
              montoCuota: montoBase,
              cuotas_totales: 1,
              naturaleza: 'variable',
              cuenta_nombre: cuentaNombre,
            });
          }
        }
      }

      // Calcular alivio acumulado respecto al mes 0 (actual)
      const baseComprometido = meses12[0]?.comprometido || 0;
      for (const m of meses12) {
        m.alivioAcumulado = Math.max(0, baseComprometido - m.comprometido);
      }

      setProyeccion(meses12);
    } catch (err) {
      console.error('Error calculando proyección de alivio financiero:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(TX_EVENT, load);
    return () => window.removeEventListener(TX_EVENT, load);
  }, [load]);

  const mes0 = proyeccion[0]; // Mes actual (ej. Octubre)
  const mes1 = proyeccion[1]; // Mes siguiente (ej. Noviembre)

  const delta = useMemo(() => {
    if (!mes0 || !mes1) return 0;
    return mes1.comprometido - mes0.comprometido;
  }, [mes0, mes1]);

  const alivio = delta <= 0;
  const abs = Math.abs(delta);
  const actual = mes0?.comprometido || 0;
  const siguiente = mes1?.comprometido || 0;
  const pct = actual > 0 ? Math.min(100, (siguiente / actual) * 100) : siguiente > 0 ? 100 : 0;
  const mesSigLabel = mes1 ? monthLabel(`${mes1.mesYM}-01`, { month: 'long' }) : 'el mes próximo';

  if (loading && !proyeccion.length) {
    return <div className="glass h-52 animate-pulse" />;
  }

  return (
    <article
      id="widget-alivio"
      className={`glass relative animate-rise overflow-hidden p-5 sm:p-6 [animation-delay:80ms] ${
        alivio ? 'ring-1 ring-income/20' : 'ring-1 ring-debt/20'
      }`}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl ${
          alivio ? 'bg-income/25' : 'bg-debt/25'
        }`}
      />

      <div className="flex items-center justify-between">
        <p className="label">Alivio financiero · {mesSigLabel}</p>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            alivio ? 'bg-income/15 text-income' : 'bg-debt/15 text-debt'
          }`}
        >
          {alivio ? '▼ menos cuotas' : '▲ más cuotas'}
        </span>
      </div>

      <p className="mt-3 text-sm text-jade">
        {abs === 0 ? 'Sin cambios' : alivio ? 'Se liberan' : 'Se sumaron'}
      </p>
      <p className={`num text-4xl sm:text-5xl font-semibold tracking-tight ${alivio ? 'text-income' : 'text-debt'}`}>
        {alivio ? '' : '-'}
        {money(abs)}
      </p>

      {/* Cajas resumen */}
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-jade text-xs">Terminan en {monthLabel(`${mes0?.mesYM}-01`, { month: 'short' })}</p>
          <p className="num font-bold text-income text-base sm:text-lg">+{money(mes0?.liberadoMes || 0)}</p>
          <p className="text-[11px] text-jade">
            {mes0?.planesQueTerminan.length || 0} gasto{(mes0?.planesQueTerminan.length || 0) === 1 ? '' : 's'} o plan{(mes0?.planesQueTerminan.length || 0) === 1 ? '' : 'es'}
          </p>
        </div>
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-jade text-xs">Compromiso {mesSigLabel}</p>
          <p className="num font-bold text-pebble text-base sm:text-lg">{money(siguiente)}</p>
          <p className="text-[11px] text-jade">gastos que continúan</p>
        </div>
      </div>

      {/* Barra comparativa mes actual vs siguiente */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-jade">
          <span>Este mes {money(actual)}</span>
          <span>{mesSigLabel} {money(siguiente)}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ${
              alivio ? 'bg-gradient-to-r from-teal to-income' : 'bg-gradient-to-r from-teal to-debt'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Botón para expandir la proyección de alivio financiero a 12 meses */}
      <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMostrarProyeccion(!mostrarProyeccion)}
          className="text-xs font-semibold text-teal hover:underline flex items-center gap-1.5 transition"
        >
          <span>{mostrarProyeccion ? '▲ Ocultar proyección' : '📈 Ver proyección del alivio (12 meses)'}</span>
        </button>
        <span className="text-[11px] text-jade">
          {proyeccion.filter((p) => p.liberadoMes > 0).length} meses con liberación
        </span>
      </div>

      {/* Proyección interactiva multi-mes de alivio financiero */}
      {mostrarProyeccion && (
        <div className="mt-4 animate-fadeIn space-y-4">
          <p className="text-xs text-jade">
            Evolución de compromisos y dinero que se va liberando a medida que finalizan cuotas y compras:
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {proyeccion.slice(1, 9).map((m) => {
              const isSelected = mesDetalle === m.mesYM;
              return (
                <div
                  key={m.mesYM}
                  onClick={() => setMesDetalle(isSelected ? null : m.mesYM)}
                  className={`rounded-xl border p-2.5 cursor-pointer transition text-left ${
                    isSelected
                      ? 'border-income/40 bg-income/10 ring-1 ring-income/30'
                      : 'border-white/10 bg-spruce-900/60 hover:bg-white/5'
                  }`}
                >
                  <p className="text-[11px] font-semibold text-jade uppercase">{m.label}</p>
                  <p className="num text-sm font-bold text-pebble mt-0.5">{money(m.comprometido)}</p>
                  {m.alivioAcumulado > 0 && (
                    <p className="num text-[11px] font-semibold text-income mt-1">
                      Liberás {money(m.alivioAcumulado)}
                    </p>
                  )}
                  {m.planesQueTerminan.length > 0 ? (
                    <span className="inline-block mt-1 text-[10px] text-teal">
                      Terminan {m.planesQueTerminan.length} plan{m.planesQueTerminan.length === 1 ? '' : 'es'}
                    </span>
                  ) : (
                    <span className="inline-block mt-1 text-[10px] text-jade/70">Sin cambios</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Detalle de planes que finalizan en el mes seleccionado o en el mes actual */}
          <div className="rounded-2xl border border-white/10 bg-spruce-900/80 p-3.5">
            {(() => {
              const targetYM = mesDetalle || mes0?.mesYM;
              const targetMes = proyeccion.find((p) => p.mesYM === targetYM);
              if (!targetMes) return null;

              return (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-pebble">
                      Gastos que finalizan en {monthLabel(`${targetMes.mesYM}-01`, { month: 'long' })}
                    </span>
                    <span className="num text-xs font-bold text-income">
                      +{money(targetMes.liberadoMes)}
                    </span>
                  </div>

                  {targetMes.planesQueTerminan.length > 0 ? (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {targetMes.planesQueTerminan.map((p, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs"
                        >
                          <div className="min-w-0 flex-1 truncate">
                            <span className="font-medium text-pebble">{p.descripcion}</span>
                            <span className="ml-2 text-[10px] text-jade">
                              ({p.cuotas_totales > 1 ? `${p.cuotas_totales} cuotas` : 'contado'} · {p.cuenta_nombre})
                            </span>
                          </div>
                          <span className="num font-semibold text-income shrink-0">
                            +{money(p.montoCuota)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-jade/80 py-2">
                      En este mes no finalizan planes en cuotas.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </article>
  );
}
