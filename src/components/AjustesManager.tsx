'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { notifyChange } from '@/lib/offlineQueue';
import { notifyCatalogs, TIPOS_CUENTA, cuentaIcon, useCatalogs, type Categoria, type Cuenta } from '@/lib/catalogs';
import Modal from './Modal';

const input =
  'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-pebble outline-none focus:border-cyan/60 [color-scheme:dark]';

const COLORES = ['#22D3EE', '#0F766E', '#25D366', '#C98B6D', '#A78BFA', '#F472B6', '#FBBF24', '#60A5FA', '#F87171', '#7A8B8F'];
const EMOJIS = ['🛒', '⛽', '🏠', '🎉', '👟', '📦', '💼', '🍔', '💊', '🎓', '✈️', '🐶', '📱', '💡', '🚗', '🎁', '💰', '🏋️'];

type Tab = 'categorias' | 'tarjetas';

export default function AjustesManager() {
  const [tab, setTab] = useState<Tab>('categorias');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const { categorias, cuentas } = useCatalogs();

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'tarjetas' || t === 'categorias') setTab(t);
    getSupabase().auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  return (
    <>
      <div className="glass flex p-1">
        {(['categorias', 'tarjetas'] as Tab[]).map((t) => (
          <button
            key={t}
            id={`tab-${t}`}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-[1.25rem] py-2.5 text-sm font-medium transition ${tab === t ? 'bg-teal text-pebble' : 'text-jade hover:text-pebble'}`}
          >
            {t === 'categorias' ? '🏷️ Categorías' : '💳 Tarjetas y cuentas'}
          </button>
        ))}
      </div>
      {tab === 'categorias' ? <Categorias items={categorias} /> : <Tarjetas items={cuentas} />}

      <section className="glass animate-rise p-4">
        <h2 className="label mb-2">Cuenta</h2>
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm">
            <span className="block text-xs text-jade">Sesión iniciada como</span>
            <span className="font-medium text-pebble">{userEmail ?? 'Cargando...'}</span>
          </div>
          <button
            onClick={async () => {
              await getSupabase().auth.signOut();
              window.location.reload();
            }}
            className="rounded-xl border border-debt/40 bg-debt/10 px-3.5 py-2 text-xs font-medium text-debt transition hover:bg-debt/20"
          >
            Cerrar sesión
          </button>
        </div>
      </section>
    </>
  );
}

/* ----------------------------- Categorías ----------------------------- */

type CatDraft = Omit<Categoria, 'id'> & { id?: string };
const emptyCat: CatDraft = { nombre: '', icono: '📦', color: '#22D3EE', tipo: 'egreso' };

function Categorias({ items }: { items: Categoria[] }) {
  const [draft, setDraft] = useState<CatDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!draft?.nombre.trim()) return setErr('Poné un nombre.');
    const payload = { nombre: draft.nombre.trim(), icono: draft.icono, color: draft.color, tipo: draft.tipo };
    const sb = getSupabase();
    const { error } = draft.id
      ? await sb.from('categorias').update(payload).eq('id', draft.id)
      : await sb.from('categorias').insert(payload);
    if (error) return setErr(error.code === '23505' ? 'Ya existe una categoría con ese nombre.' : error.message);
    notifyCatalogs(); notifyChange(); setDraft(null);
  };

  const remove = async () => {
    if (!draft?.id || !confirm(`¿Eliminar "${draft.nombre}"? Los movimientos quedan sin categoría.`)) return;
    const { error } = await getSupabase().from('categorias').delete().eq('id', draft.id);
    if (error) return setErr(error.message);
    notifyCatalogs(); notifyChange(); setDraft(null);
  };

  const grupos: ['egreso' | 'ingreso', string][] = [['egreso', 'Egresos'], ['ingreso', 'Ingresos']];

  return (
    <>
      {grupos.map(([tipo, titulo]) => (
        <section key={tipo} className="glass animate-rise p-4">
          <h2 className="label mb-3">{titulo}</h2>
          <div className="grid grid-cols-2 gap-2">
            {items.filter((c) => c.tipo === tipo).map((c) => (
              <button
                key={c.id}
                id={`cat-edit-${c.id}`}
                onClick={() => { setErr(null); setDraft(c); }}
                className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm transition hover:bg-white/10"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl text-base" style={{ background: `${c.color}33` }}>{c.icono}</span>
                <span className="flex-1 truncate">{c.nombre}</span>
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              </button>
            ))}
          </div>
        </section>
      ))}

      <button id="btn-nueva-categoria" onClick={() => { setErr(null); setDraft({ ...emptyCat }); }} className="btn-primary w-full">
        ＋ Nueva categoría
      </button>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar categoría' : 'Nueva categoría'}>
        {draft && (
          <div className="space-y-4">
            <div className="flex rounded-full bg-white/5 p-1 text-sm">
              {(['egreso', 'ingreso'] as const).map((t) => (
                <button key={t} onClick={() => setDraft({ ...draft, tipo: t })}
                  className={`flex-1 rounded-full py-1.5 capitalize ${draft.tipo === t ? (t === 'ingreso' ? 'bg-income/20 text-income' : 'bg-debt/20 text-debt') : 'text-jade'}`}>
                  {t}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="label">Nombre</span>
              <input id="cat-nombre" autoFocus className={input} value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} placeholder="Ej: Farmacia" />
            </label>
            <div>
              <span className="label">Ícono</span>
              <div className="mt-2 grid grid-cols-9 gap-1">
                {EMOJIS.map((e) => (
                  <button key={e} onClick={() => setDraft({ ...draft, icono: e })}
                    className={`rounded-xl py-1.5 text-lg transition ${draft.icono === e ? 'bg-cyan/20 ring-1 ring-cyan' : 'hover:bg-white/10'}`}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Color</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {COLORES.map((c) => (
                  <button key={c} aria-label={c} onClick={() => setDraft({ ...draft, color: c })}
                    className={`h-8 w-8 rounded-full transition ${draft.color === c ? 'ring-2 ring-pebble ring-offset-2 ring-offset-spruce-800' : ''}`}
                    style={{ background: c }} />
                ))}
              </div>
            </div>
            {err && <p className="text-sm text-debt">{err}</p>}
            <div className="flex gap-3">
              {draft.id && <button onClick={remove} className="rounded-2xl border border-debt/40 px-4 py-3 text-debt hover:bg-debt/10">Eliminar</button>}
              <button id="cat-guardar" onClick={save} className="btn-primary flex-1">Guardar</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ------------------------------ Tarjetas ------------------------------ */

type CtaDraft = Omit<Cuenta, 'id'> & { id?: string };
const emptyCta: CtaDraft = { nombre: '', tipo: 'credito', dia_cierre: null, dia_vencimiento: null, activa: true };

function Tarjetas({ items }: { items: Cuenta[] }) {
  const [draft, setDraft] = useState<CtaDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const day = (v: string) => (v === '' ? null : Math.min(31, Math.max(1, Number(v) || 1)));

  const save = async () => {
    if (!draft?.nombre.trim()) return setErr('Poné un nombre.');
    const esCredito = draft.tipo === 'credito';
    const payload = {
      nombre: draft.nombre.trim(),
      tipo: draft.tipo,
      dia_cierre: esCredito ? draft.dia_cierre : null,
      dia_vencimiento: esCredito ? draft.dia_vencimiento : null,
      activa: draft.activa,
    };
    const sb = getSupabase();
    const { error } = draft.id
      ? await sb.from('cuentas_tarjetas').update(payload).eq('id', draft.id)
      : await sb.from('cuentas_tarjetas').insert(payload);
    if (error) return setErr(error.message);
    notifyCatalogs(); notifyChange(); setDraft(null);
  };

  const remove = async () => {
    if (!draft?.id || !confirm(`¿Eliminar "${draft.nombre}"? Los movimientos quedan sin tarjeta.`)) return;
    const { error } = await getSupabase().from('cuentas_tarjetas').delete().eq('id', draft.id);
    if (error) return setErr(error.message);
    notifyCatalogs(); notifyChange(); setDraft(null);
  };

  return (
    <>
      <section className="glass animate-rise divide-y divide-white/5 overflow-hidden">
        {items.map((c) => (
          <button key={c.id} id={`cta-edit-${c.id}`} onClick={() => { setErr(null); setDraft(c); }}
            className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/5 ${c.activa ? '' : 'opacity-50'}`}>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-xl">{cuentaIcon(c.tipo)}</span>
            <span className="flex-1">
              <span className="block font-medium">{c.nombre}</span>
              <span className="block text-xs text-jade">
                {TIPOS_CUENTA.find((t) => t.value === c.tipo)?.label}
                {c.tipo === 'credito' && c.dia_cierre ? ` · cierra el ${c.dia_cierre}` : ''}
                {c.tipo === 'credito' && c.dia_vencimiento ? ` · vence el ${c.dia_vencimiento}` : ''}
                {!c.activa && ' · inactiva'}
              </span>
            </span>
            <span className="text-jade">›</span>
          </button>
        ))}
        {!items.length && <p className="p-6 text-center text-sm text-jade">Todavía no cargaste tarjetas ni cuentas.</p>}
      </section>

      <button id="btn-nueva-tarjeta" onClick={() => { setErr(null); setDraft({ ...emptyCta }); }} className="btn-primary w-full">
        ＋ Nueva tarjeta / cuenta
      </button>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Editar tarjeta' : 'Nueva tarjeta / cuenta'}>
        {draft && (
          <div className="space-y-4">
            <label className="block">
              <span className="label">Nombre</span>
              <input id="cta-nombre" autoFocus className={input} value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} placeholder="Ej: Visa Galicia" />
            </label>
            <div>
              <span className="label">Tipo</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {TIPOS_CUENTA.map((t) => (
                  <button key={t.value} onClick={() => setDraft({ ...draft, tipo: t.value })}
                    className={`rounded-2xl border px-3 py-2.5 text-left text-sm transition ${draft.tipo === t.value ? 'border-cyan bg-cyan/15 text-cyan' : 'border-white/10 bg-white/5 text-pebble/80 hover:bg-white/10'}`}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>
            {draft.tipo === 'credito' && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label">Día de cierre</span>
                  <input id="cta-cierre" type="number" min={1} max={31} inputMode="numeric" className={`${input} num`}
                    value={draft.dia_cierre ?? ''} onChange={(e) => setDraft({ ...draft, dia_cierre: day(e.target.value) })} placeholder="Ej: 25" />
                </label>
                <label className="block">
                  <span className="label">Día de vencimiento</span>
                  <input id="cta-vto" type="number" min={1} max={31} inputMode="numeric" className={`${input} num`}
                    value={draft.dia_vencimiento ?? ''} onChange={(e) => setDraft({ ...draft, dia_vencimiento: day(e.target.value) })} placeholder="Ej: 5" />
                </label>
                <p className="col-span-2 text-xs text-jade">Si comprás después del día de cierre, la 1ª cuota se sugiere para el mes siguiente.</p>
              </div>
            )}
            <label className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm">
              Activa (aparece al cargar gastos)
              <input type="checkbox" checked={draft.activa} onChange={(e) => setDraft({ ...draft, activa: e.target.checked })} className="h-5 w-5 accent-cyan" />
            </label>
            {err && <p className="text-sm text-debt">{err}</p>}
            <div className="flex gap-3">
              {draft.id && <button onClick={remove} className="rounded-2xl border border-debt/40 px-4 py-3 text-debt hover:bg-debt/10">Eliminar</button>}
              <button id="cta-guardar" onClick={save} className="btn-primary flex-1">Guardar</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
