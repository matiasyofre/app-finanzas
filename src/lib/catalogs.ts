'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from './supabase/client';

export type Categoria = {
  id: string;
  nombre: string;
  icono: string | null;
  color: string;
  tipo: 'ingreso' | 'egreso';
};

export type TipoCuenta = 'efectivo' | 'debito' | 'banco' | 'credito' | 'prestamo' | 'billetera' | 'otro';

export type Cuenta = {
  id: string;
  nombre: string;
  tipo: TipoCuenta;
  dia_cierre: number | null;
  dia_vencimiento: number | null;
  activa: boolean;
  saldo_inicial?: number | null;
};

export const TIPOS_CUENTA: { value: TipoCuenta; label: string; icon: string }[] = [
  { value: 'billetera', label: 'Billetera virtual (MP, Ualá, etc.)', icon: '📱' },
  { value: 'banco', label: 'Cuenta bancaria (Caja de ahorro)', icon: '🏛️' },
  { value: 'debito', label: 'Tarjeta de débito', icon: '🏦' },
  { value: 'credito', label: 'Tarjeta de crédito', icon: '💳' },
  { value: 'efectivo', label: 'Efectivo', icon: '💵' },
  { value: 'prestamo', label: 'Préstamo', icon: '📄' },
];

export const cuentaIcon = (t: TipoCuenta) => TIPOS_CUENTA.find((x) => x.value === t)?.icon ?? '💳';

/** Evento para refrescar categorías/tarjetas en toda la app tras un alta o edición. */
export const CATALOG_EVENT = 'gastos:catalogs';
export const notifyCatalogs = () => window.dispatchEvent(new Event(CATALOG_EVENT));

export function useCatalogs() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const sb = getSupabase();
    const [c, t] = await Promise.all([
      sb.from('categorias').select('id,nombre,icono,color,tipo').order('nombre'),
      sb.from('cuentas_tarjetas').select('*').order('nombre'),
    ]);
    setCategorias((c.data ?? []) as Categoria[]);
    setCuentas(
      ((t.data ?? []) as Cuenta[]).map((row) => ({
        ...row,
        saldo_inicial: Number(row.saldo_inicial ?? 0),
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener(CATALOG_EVENT, reload);
    return () => window.removeEventListener(CATALOG_EVENT, reload);
  }, [reload]);

  return { categorias, cuentas, loading, reload };
}
