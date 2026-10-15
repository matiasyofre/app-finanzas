'use client';

import Link from 'next/link';
import { cuentaIcon, type Categoria, type Cuenta } from '@/lib/catalogs';

const chip = (active: boolean) =>
  `shrink-0 rounded-full border px-3 py-1.5 text-xs transition whitespace-nowrap ${
    active ? 'border-cyan bg-cyan/15 text-cyan font-medium shadow-sm' : 'border-white/10 bg-white/5 text-pebble/80 hover:bg-white/10'
  }`;

export function CategoryChips({
  categorias,
  tipo,
  value,
  onChange,
}: {
  categorias: Categoria[];
  tipo: 'ingreso' | 'egreso';
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const list = categorias.filter((c) => c.tipo === tipo);
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {list.map((c) => (
        <button
          key={c.id}
          type="button"
          id={`cat-${c.id}`}
          onClick={() => onChange(value === c.id ? null : c.id)}
          className={chip(value === c.id)}
          style={value === c.id ? { borderColor: c.color, color: c.color, background: `${c.color}22` } : undefined}
        >
          {c.icono} {c.nombre}
        </button>
      ))}
      <Link href="/ajustes?tab=categorias" className={`${chip(false)} border-dashed text-jade`}>
        ＋ Nueva
      </Link>
    </div>
  );
}

export function CardChips({
  cuentas,
  value,
  onChange,
}: {
  cuentas: Cuenta[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const list = cuentas.filter((c) => c.activa);
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {list.map((c) => (
        <button key={c.id} type="button" id={`card-${c.id}`} onClick={() => onChange(value === c.id ? null : c.id)} className={chip(value === c.id)}>
          {cuentaIcon(c.tipo)} {c.nombre}
          {c.tipo === 'credito' && c.dia_cierre ? (
            <span className="ml-1 text-[11px] text-jade">cierra {c.dia_cierre}</span>
          ) : c.tipo === 'prestamo' ? (
            <span className="ml-1 text-[11px] text-purple-300">préstamo</span>
          ) : null}
        </button>
      ))}
      <Link href="/ajustes?tab=tarjetas" className={`${chip(false)} border-dashed text-jade`}>
        ＋ Nueva tarjeta / préstamo
      </Link>
    </div>
  );
}
