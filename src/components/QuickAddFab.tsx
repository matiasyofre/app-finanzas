'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseAmount, parseExpense, splitInstallments } from '@/lib/parser/parseExpense';
import { saveTransaction } from '@/lib/offlineQueue';
import { money } from '@/lib/format';
import { useCatalogs } from '@/lib/catalogs';
import { addMonths, firstInstallmentMonth, todayISO, ymLabel } from '@/lib/cuotas';
import type { NaturalezaGasto, PagadoPor } from '@/lib/supabase/client';
import { CardChips, CategoryChips } from './Pickers';

type Field = 'monto' | 'cuotas';

/**
 * FAB global + Bottom Sheet de carga rápida.
 * - Lenguaje natural ("90000 zapatillas en 5") con regex dinámico.
 * - Teclado de cuotas libre (1x por defecto).
 * - Clasificación: Fijo, Variable o Compartido (% propio, quién pagó y con quién).
 * - Soporte tanto para Tarjetas como para Préstamos o Cuentas.
 */
export default function QuickAddFab() {
  const { categorias, cuentas } = useCatalogs();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [monto, setMonto] = useState('');
  const [cuotas, setCuotas] = useState('1');
  const [descripcion, setDescripcion] = useState('');
  const [tipo, setTipo] = useState<'egreso' | 'ingreso'>('egreso');
  const [esFijo, setEsFijo] = useState(false);
  const [esCompartido, setEsCompartido] = useState(false);
  const [porcentajePropio, setPorcentajePropio] = useState<number>(50);
  const [pagadoPor, setPagadoPor] = useState<PagadoPor>('yo');
  const [compartidoCon, setCompartidoCon] = useState<string>('');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [cuentaId, setCuentaId] = useState<string | null>(null);
  const [mesPrimera, setMesPrimera] = useState(() => todayISO().slice(0, 7));
  const [mesManual, setMesManual] = useState(false);
  const [field, setField] = useState<Field>('monto');
  const [modoMonto, setModoMonto] = useState<'total' | 'cuota'>('total');
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'queued' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('add')) setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const cuenta = cuentas.find((c) => c.id === cuentaId) ?? null;

  useEffect(() => {
    if (!mesManual) setMesPrimera(firstInstallmentMonth(todayISO(), cuenta));
  }, [cuenta, mesManual]);

  const onTextChange = (v: string) => {
    setText(v);
    const p = parseExpense(v);
    setMonto(p.monto != null ? String(p.monto).replace('.', ',') : '');
    setCuotas(String(p.cuotas));
    setModoMonto('total');
    setDescripcion(p.descripcion);
    setTipo(p.tipo);
    if (p.tipo === 'ingreso') setEsFijo(true);
    const match = categorias.find((c) => c.tipo === p.tipo && p.descripcion && p.descripcion.toLowerCase().includes(c.nombre.toLowerCase()));
    if (match) setCategoriaId(match.id);
  };

  const rawNum = monto ? parseAmount(monto) : 0;
  const n = Math.max(1, parseInt(cuotas || '1', 10) || 1);
  const total = modoMonto === 'cuota' && n > 1 ? Math.round(rawNum * n * 100) / 100 : rawNum;
  const split = useMemo(() => (total > 0 ? splitInstallments(total, n) : null), [total, n]);
  const valid = total > 0 && descripcion.trim().length > 0;
  const enCuotas = n > 1 && tipo === 'egreso';
  const miMontoReal = esCompartido ? (total * (porcentajePropio / 100)) : total;
  const montoDiferencial = esCompartido ? (total * ((100 - porcentajePropio) / 100)) : 0;

  const cambiarModoMonto = (nuevoModo: 'total' | 'cuota') => {
    if (nuevoModo === modoMonto) return;
    if (rawNum > 0 && n > 1) {
      if (nuevoModo === 'cuota') {
        const cVal = Math.round((rawNum / n) * 100) / 100;
        setMonto(String(cVal).replace('.', ','));
      } else {
        const tVal = Math.round(rawNum * n * 100) / 100;
        setMonto(String(tVal).replace('.', ','));
      }
    }
    setModoMonto(nuevoModo);
  };

  const touchedCuotas = useRef(false);

  const press = useCallback(
    (k: string) => {
      setText('');
      if (field === 'cuotas') {
        const fresh = !touchedCuotas.current;
        touchedCuotas.current = true;
        setCuotas((prev) => {
          if (k === '⌫') return prev.slice(0, -1);
          if (k === ',') return prev;
          const base = fresh ? '' : prev;
          const next = (base === '0' ? '' : base) + k;
          return next === '0' ? '' : next;
        });
        return;
      }
      setMonto((prev) => {
        if (k === '⌫') return prev.slice(0, -1);
        if (k === ',') return prev.includes(',') ? prev : (prev || '0') + ',';
        if (/,\d{2}$/.test(prev)) return prev;
        return (prev === '0' ? '' : prev) + k;
      });
    },
    [field],
  );

  const toggleCuotas = () => {
    touchedCuotas.current = false;
    setField((f) => (f === 'cuotas' ? 'monto' : 'cuotas'));
  };

  const reset = () => {
    setText(''); setMonto(''); setCuotas('1'); setDescripcion(''); setTipo('egreso'); setField('monto');
    setModoMonto('total'); setEsFijo(false); setEsCompartido(false); setPorcentajePropio(50); setPagadoPor('yo'); setCompartidoCon('');
    setCategoriaId(null); setCuentaId(null); setMesManual(false);
  };

  const save = async () => {
    if (!valid) return;
    setStatus('saving');
    try {
      const r = await saveTransaction({
        descripcion: descripcion.trim(),
        monto_total: total,
        cuotas_totales: n,
        tipo,
        naturaleza: tipo === 'ingreso' ? (esFijo ? 'fijo' : 'variable') : (esFijo ? 'fijo' : (esCompartido ? 'compartido' : 'variable')),
        es_recurrente: tipo === 'ingreso' ? esFijo : esFijo,
        porcentaje_propio: esCompartido ? porcentajePropio : 100,
        pagado_por: esCompartido ? pagadoPor : 'yo',
        compartido_con: esCompartido ? (compartidoCon.trim() || null) : null,
        fecha_compra: todayISO(),
        categoria_id: categoriaId,
        cuenta_id: cuentaId,
        fecha_primera_cuota: `${mesPrimera}-01`,
        texto_original: text || undefined,
      });
      setStatus(r === 'queued' ? 'queued' : 'ok');
      navigator.vibrate?.(20);
      setTimeout(() => { setStatus('idle'); reset(); setOpen(false); }, 900);
    } catch {
      setStatus('error');
    }
  };

  const accent = tipo === 'ingreso' ? 'text-income' : 'text-debt';

  return (
    <>
      <button
        id="fab-quick-add"
        aria-label="Cargar gasto"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(max(1rem,env(safe-area-inset-bottom))+4rem)] right-4 z-40 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full
                   bg-gradient-to-br from-teal to-cyan text-spruce-900 shadow-glow transition hover:scale-105 active:scale-95 md:bottom-8 md:right-8"
      >
        <svg viewBox="0 0 24 24" className={`h-7 w-7 transition-transform ${open ? 'rotate-45' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
          <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

          <section className="glass-strong relative max-h-[94dvh] w-full max-w-lg animate-sheet-up overflow-y-auto rounded-b-none px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:rounded-3xl">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/20 sm:hidden" />
            
            <div className="flex items-center justify-between">
              <h2 id="sheet-title" className="label text-sm">Carga rápida</h2>
              <div className="flex rounded-full bg-white/5 p-1 text-xs">
                {(['egreso', 'ingreso'] as const).map((t) => (
                  <button
                    key={t}
                    id={`tipo-${t}`}
                    onClick={() => { setTipo(t); setCategoriaId(null); if (t === 'ingreso') setEsFijo(true); }}
                    className={`rounded-full px-3 py-1 capitalize transition ${
                      tipo === t ? (t === 'ingreso' ? 'bg-income/20 text-income font-medium' : 'bg-debt/20 text-debt font-medium') : 'text-jade'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Clasificación: Variable vs Fijo + Toggle Compartido independiente */}
            {tipo === 'egreso' && (
              <div className="mt-3 flex gap-2">
                <div className="flex flex-1 gap-1 rounded-2xl bg-white/5 p-1">
                  <button
                    key="btn-variable"
                    type="button"
                    onClick={() => setEsFijo(false)}
                    className={`flex-1 rounded-xl py-1.5 text-xs transition ${
                      !esFijo
                        ? 'bg-white/15 text-pebble font-semibold shadow-sm'
                        : 'text-jade hover:text-pebble'
                    }`}
                  >
                    ⚡ Variable
                  </button>
                  <button
                    key="btn-fijo"
                    type="button"
                    onClick={() => setEsFijo(true)}
                    className={`flex-1 rounded-xl py-1.5 text-xs transition ${
                      esFijo
                        ? 'bg-teal/40 text-cyan font-semibold shadow-sm'
                        : 'text-jade hover:text-pebble'
                    }`}
                  >
                    📌 Fijo
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setEsCompartido((c) => !c)}
                  className={`flex items-center justify-center gap-1.5 rounded-2xl px-3.5 py-1.5 text-xs font-semibold transition border ${
                    esCompartido
                      ? 'border-amber-400/50 bg-amber-500/20 text-amber-200 shadow-sm'
                      : 'border-white/10 bg-white/5 text-jade hover:text-pebble'
                  }`}
                >
                  <span>👥</span>
                  <span>Compartido</span>
                  {esCompartido && <span className="ml-0.5 text-amber-300">✓</span>}
                </button>
              </div>
            )}

            {/* Clasificación para Ingresos: Recurrente vs Puntual */}
            {tipo === 'ingreso' && (
              <div className="mt-3 flex gap-2">
                <div className="flex flex-1 gap-1 rounded-2xl bg-white/5 p-1">
                  <button
                    type="button"
                    onClick={() => setEsFijo(true)}
                    className={`flex-1 rounded-xl py-1.5 text-xs transition flex items-center justify-center gap-1.5 ${
                      esFijo
                        ? 'bg-income/20 text-income font-semibold border border-income/30 shadow-sm'
                        : 'text-jade hover:text-pebble'
                    }`}
                  >
                    <span>🔁</span>
                    <span>Recurrente mensual (para adelante)</span>
                    {esFijo && <span className="ml-0.5 text-income font-bold">✓</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEsFijo(false)}
                    className={`flex-1 rounded-xl py-1.5 text-xs transition flex items-center justify-center gap-1.5 ${
                      !esFijo
                        ? 'bg-white/15 text-pebble font-semibold shadow-sm'
                        : 'text-jade hover:text-pebble'
                    }`}
                  >
                    <span>⚡</span>
                    <span>Puntual (1 solo mes)</span>
                    {!esFijo && <span className="ml-0.5 text-pebble font-bold">✓</span>}
                  </button>
                </div>
              </div>
            )}

            {/* Configuración de Gasto Compartido */}
            {esCompartido && (
              <div className="mt-3 animate-rise space-y-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3.5">
                {/* Quién pagó */}
                <div>
                  <span className="label text-[10px] text-amber-300">¿Quién pagó el gasto?</span>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPagadoPor('yo')}
                      className={`flex-1 rounded-xl py-1.5 px-2 text-xs font-medium transition ${
                        pagadoPor === 'yo'
                          ? 'bg-amber-500/25 border border-amber-400 text-amber-200 font-bold'
                          : 'bg-white/5 border border-white/5 text-jade hover:text-pebble'
                      }`}
                    >
                      🙋‍♂️ Lo pagué yo
                    </button>
                    <button
                      type="button"
                      onClick={() => setPagadoPor('otro')}
                      className={`flex-1 rounded-xl py-1.5 px-2 text-xs font-medium transition ${
                        pagadoPor === 'otro'
                          ? 'bg-amber-500/25 border border-amber-400 text-amber-200 font-bold'
                          : 'bg-white/5 border border-white/5 text-jade hover:text-pebble'
                      }`}
                    >
                      👥 Lo pagó otra persona
                    </button>
                  </div>
                </div>

                {/* Porcentaje propio y cálculo */}
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-amber-200">Tu parte a pagar:</span>
                    <span className="num font-bold text-pebble">{porcentajePropio}% ({money(miMontoReal)})</span>
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    {[50, 33, 25, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setPorcentajePropio(pct)}
                        className={`flex-1 rounded-lg py-1 text-xs transition ${
                          porcentajePropio === pct ? 'bg-amber-400/30 text-amber-200 font-bold' : 'bg-white/5 text-jade hover:text-pebble'
                        }`}
                      >
                        {pct}%
                      </button>
                    ))}
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={porcentajePropio}
                      onChange={(e) => setPorcentajePropio(Math.min(100, Math.max(1, Number(e.target.value) || 50)))}
                      className="num w-14 rounded-lg border border-white/10 bg-white/5 px-1 py-1 text-center text-xs text-pebble outline-none"
                      placeholder="%"
                    />
                  </div>
                </div>

                {/* Balance: te deben o vos debés */}
                <div className="rounded-xl bg-black/25 px-3 py-2 text-xs">
                  {pagadoPor === 'yo' ? (
                    <p className="text-income font-medium">
                      ✓ Desembolsás {money(total)}. <span className="text-pebble font-bold">Te deben {money(montoDiferencial)}</span> ({100 - porcentajePropio}%).
                    </p>
                  ) : (
                    <p className="text-debt font-medium">
                      ⚠️ Lo pagó {compartidoCon.trim() || 'otra persona'}. <span className="text-pebble font-bold">Vos debés {money(miMontoReal)}</span> ({porcentajePropio}%).
                    </p>
                  )}
                </div>

                <input
                  value={compartidoCon}
                  onChange={(e) => setCompartidoCon(e.target.value)}
                  placeholder="¿Con quién compartís? (ej: Pareja, Amigos, Juan)"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-pebble placeholder:text-jade/60 outline-none"
                />
              </div>
            )}

            {/* Input lenguaje natural */}
            <input
              id="quick-add-text"
              ref={inputRef}
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder='Ej: "750000 en 75"'
              autoComplete="off"
              className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-pebble placeholder:text-jade/60 outline-none transition focus:border-cyan/60"
            />

            {/* Selector de Modo: Total general vs Importe por cuota */}
            <div className="mt-3.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 text-xs">
                <button
                  type="button"
                  id="modo-monto-total"
                  onClick={() => cambiarModoMonto('total')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    modoMonto === 'total'
                      ? 'bg-cyan/20 text-cyan font-bold shadow-sm'
                      : 'text-jade hover:text-pebble'
                  }`}
                >
                  Total general
                </button>
                <button
                  type="button"
                  id="modo-monto-cuota"
                  onClick={() => cambiarModoMonto('cuota')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    modoMonto === 'cuota'
                      ? 'bg-cyan/20 text-cyan font-bold shadow-sm'
                      : 'text-jade hover:text-pebble'
                  }`}
                >
                  Importe por cuota
                </button>
              </div>

              {modoMonto === 'cuota' && n > 1 && rawNum > 0 && (
                <div className="text-right text-xs">
                  <span className="text-jade text-[11px]">Total: </span>
                  <span className="num font-bold text-pebble">{money(total)}</span>
                </div>
              )}
            </div>

            {/* Display numérico */}
            <div className="mt-2 flex items-end justify-between gap-3">
              <button onClick={() => setField('monto')} className="min-w-0 text-left" id="display-monto">
                <p className="text-xs text-jade">
                  {modoMonto === 'cuota'
                    ? (n > 1 ? `Importe por cuota (${n} cuotas)` : 'Importe de la cuota')
                    : 'Total general'}
                </p>
                <p className={`num truncate text-3xl font-semibold sm:text-4xl ${field === 'monto' ? accent : 'text-pebble/70'}`}>
                  ${monto || '0'}
                  {field === 'monto' && <span className="ml-0.5 inline-block h-7 w-0.5 animate-pulse bg-cyan align-middle" />}
                </p>
              </button>

              <button
                id="btn-cuotas"
                onClick={toggleCuotas}
                className={`num shrink-0 rounded-2xl border px-3.5 py-2 text-base font-semibold transition sm:text-lg ${
                  field === 'cuotas' ? 'border-cyan bg-cyan/15 text-cyan shadow-glow' : 'border-white/10 bg-white/5 text-pebble'
                }`}
              >
                {cuotas || '–'}x
                <span className="ml-1 text-xs font-normal text-jade">cuotas</span>
              </button>
            </div>

            <input
              id="quick-add-desc"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Descripción (ej: Préstamo auto, Zapatillas)"
              className="mt-2 w-full border-b border-white/10 bg-transparent pb-1.5 text-pebble placeholder:text-jade/60 outline-none focus:border-cyan/60"
            />

            {/* Categoría */}
            <p className="label mt-3">Categoría</p>
            <CategoryChips categorias={categorias} tipo={tipo} value={categoriaId} onChange={setCategoriaId} />

            {/* Sección de Financiamiento: Tarjeta o Préstamo o Cuenta */}
            {enCuotas && (
              <div className="mt-3 animate-rise space-y-2 rounded-2xl border border-cyan/20 bg-cyan/5 p-3">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="label text-[10px]">Cuenta / Tarjeta / Préstamo asociado</p>
                    {cuenta && (
                      <span className="text-[11px] font-medium text-cyan capitalize">
                        {cuenta.tipo === 'prestamo' ? '📄 Préstamo' : cuenta.tipo === 'credito' ? '💳 Tarjeta de crédito' : cuenta.nombre}
                      </span>
                    )}
                  </div>
                  <CardChips cuentas={cuentas} value={cuentaId} onChange={setCuentaId} />
                </div>
                <div className="flex items-center justify-between gap-3 pt-1">
                  <label htmlFor="mes-primera" className="text-xs text-jade">Mes 1ª cuota</label>
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label="Mes anterior" onClick={() => { setMesManual(true); setMesPrimera((m) => addMonths(m, -1)); }} className="rounded-full px-2 py-0.5 text-jade hover:bg-white/10">‹</button>
                    <input
                      id="mes-primera"
                      type="month"
                      value={mesPrimera}
                      onChange={(e) => { if (e.target.value) { setMesManual(true); setMesPrimera(e.target.value); } }}
                      className="rounded-xl border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-pebble [color-scheme:dark]"
                    />
                    <button type="button" aria-label="Mes siguiente" onClick={() => { setMesManual(true); setMesPrimera((m) => addMonths(m, 1)); }} className="rounded-full px-2 py-0.5 text-jade hover:bg-white/10">›</button>
                  </div>
                </div>
                <p className="text-xs text-jade">
                  De <span className="text-pebble font-medium">{ymLabel(mesPrimera)}</span> a <span className="text-pebble font-medium">{ymLabel(addMonths(mesPrimera, n - 1))}</span>
                </p>
              </div>
            )}

            {/* Preview de división en vivo */}
            <p className="num mt-2 min-h-[1.25rem] text-xs text-jade">
              {split && n > 1 ? (
                <>
                  {modoMonto === 'cuota' ? (
                    <span className="text-pebble font-medium">
                      {n} cuotas de {money(rawNum, true)} → <span className="text-cyan font-bold">Total {money(total, true)}</span>
                    </span>
                  ) : (
                    <span className="text-pebble">
                      {n} cuotas de {money(split.cuota, true)}
                      {split.ultima !== split.cuota && <> · última {money(split.ultima, true)}</>}
                    </span>
                  )}
                  {esCompartido && (
                    <> · <span className="text-amber-300 font-medium">Tu cuota: {money((modoMonto === 'cuota' ? rawNum : split.cuota) * (porcentajePropio / 100), true)}</span></>
                  )}
                </>
              ) : split && esCompartido ? (
                <span className="text-amber-300 font-medium">Tu parte: {money(miMontoReal)} ({porcentajePropio}%)</span>
              ) : split ? (
                'Pago único'
              ) : null}
            </p>

            {/* Teclado numérico */}
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((k) => (
                <button
                  key={k}
                  id={`key-${k === ',' ? 'comma' : k === '⌫' ? 'del' : k}`}
                  onClick={() => press(k)}
                  disabled={k === ',' && field === 'cuotas'}
                  className="key h-12 text-xl disabled:opacity-20 sm:h-14 sm:text-2xl"
                >
                  {k}
                </button>
              ))}
            </div>

            <button id="btn-guardar" onClick={save} disabled={!valid || status === 'saving'} className="btn-primary mt-3 w-full py-2.5 text-base sm:text-lg">
              {status === 'saving'
                ? 'Guardando…'
                : status === 'ok'
                ? '✓ Guardado'
                : status === 'queued'
                ? '✓ Guardado offline'
                : status === 'error'
                ? 'Error · reintentar'
                : `Guardar ${split && n > 1 ? (modoMonto === 'cuota' ? `${n} cuotas de ${money(rawNum)}` : `en ${n} cuotas`) : ''}`}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
