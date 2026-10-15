import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Cliente singleton para el navegador (auth persistida en localStorage). */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'public-anon-key',
      { auth: { persistSession: true, autoRefreshToken: true } },
    );
  }
  return client;
}

export type CashflowDelta = {
  mes_actual: string;
  mes_siguiente: string;
  comprometido_actual: number;
  comprometido_siguiente: number;
  liberado: number;
  nueva_deuda: number;
  delta: number;
  cuotas_que_terminan: number;
  ingresos_actual: number;
};

export type WaterfallRow = {
  mes: string;
  comprometido: number;
  liberado: number;
  nueva_deuda: number;
  delta: number;
};

export type ResumenMes = { categoria: string; color: string; icono: string | null; total: number };

export type NaturalezaGasto = 'fijo' | 'variable' | 'compartido';
export type PagadoPor = 'yo' | 'otro';

export type NuevaTransaccion = {
  descripcion: string;
  monto_total: number;
  cuotas_totales: number;
  tipo: 'ingreso' | 'egreso';
  naturaleza?: NaturalezaGasto;
  porcentaje_propio?: number;
  compartido_con?: string | null;
  pagado_por?: PagadoPor;
  saldado?: boolean;
  fecha_saldado?: string | null;
  es_recurrente?: boolean;
  fecha_compra?: string;
  categoria_id?: string | null;
  cuenta_id?: string | null;
  fecha_primera_cuota?: string;
  texto_original?: string;
};

export type ProyeccionDesglosada = {
  mes: string;
  ingresos: number;
  tarjetas: number;
  prestamos: number;
  fijos: number;
  variables: number;
  total_egresos: number;
  saldo_neto: number;
};

export type ProyeccionPorCuenta = {
  mes: string;
  cuenta_id: string | null;
  cuenta_nombre: string;
  total: number;
};
