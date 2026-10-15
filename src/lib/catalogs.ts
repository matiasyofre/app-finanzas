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

export type TipoCuenta = 'efectivo' | 'debito' | 'credito' | 'prestamo' | 'billetera';

export type Cuenta = {
  id: string;
  nombre: string;
  tipo: TipoCuenta;
  dia_cierre: number | null;
  dia_vencimiento: number | null;
  activa: boolean;
};

export const TIPOS_CUENTA: { value: TipoCuenta; label: string; icon: string }[] = [
  { value: 'credito', label: 'Tarjeta de crédito', icon: '💳' },
  { value: 'debito', label: 'Débito', icon: '🏦' },
  { value: 'efectivo', label: 'Efectivo', icon: '💵' },
  { value: 'billetera', label: 'Billetera virtual', icon: '📱' },
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
      sb.from('cuentas_tarjetas').select('id,nombre,tipo,dia_cierre,dia_vencimiento,activa').order('nombre'),
    ]);
    setCategorias((c.data ?? []) as Categoria[]);
    setCuentas((t.data ?? []) as Cuenta[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener(CATALOG_EVENT, reload);
    return () => window.removeEventListener(CATALOG_EVENT, reload);
  }, [reload]);

  return { categorias, cuentas, loading, reload };
}
