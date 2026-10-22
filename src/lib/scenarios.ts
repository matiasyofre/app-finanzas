'use client';

export type SimMovimiento = {
  id: string;
  descripcion: string;
  tipo: 'ingreso' | 'egreso';
  monto_total: number;
  monto_cuota: number;
  cuotas_totales: number;
  mes_inicio: string; // 'YYYY-MM'
  es_recurrente?: boolean;
  porcentaje_propio: number; // 0..100
  categoria?: string;
  cuenta_simulada?: string;
  activo: boolean;
};

export type Escenario = {
  id: string;
  nombre: string;
  descripcion?: string;
  activo: boolean; // si impacta en las proyecciones globales
  color: string;
  movimientos: SimMovimiento[];
  created_at: string;
};

export const SCENARIOS_STORAGE_KEY = 'gastos:escenarios-v1';
export const SCENARIOS_EVENT = 'app:scenarios-updated';

const DEFAULT_ESCENARIOS: Escenario[] = [
  {
    id: 'esc-ejemplo-1',
    nombre: 'Potencial Viaje de Vacaciones',
    descripcion: 'Pasajes y estadía en 6 cuotas a partir de Diciembre',
    activo: false,
    color: '#F59E0B',
    created_at: new Date().toISOString(),
    movimientos: [
      {
        id: 'mov-sim-1',
        descripcion: 'Pasajes y Hotel',
        tipo: 'egreso',
        monto_total: 1800000,
        monto_cuota: 300000,
        cuotas_totales: 6,
        mes_inicio: '2026-12',
        es_recurrente: false,
        porcentaje_propio: 50,
        categoria: 'Viajes / Vacaciones',
        cuenta_simulada: 'Visa Galicia',
        activo: true,
      },
    ],
  },
];

export function getEscenarios(): Escenario[] {
  if (typeof window === 'undefined') return DEFAULT_ESCENARIOS;
  try {
    const raw = localStorage.getItem(SCENARIOS_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(DEFAULT_ESCENARIOS));
      return DEFAULT_ESCENARIOS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_ESCENARIOS;
  } catch {
    return DEFAULT_ESCENARIOS;
  }
}

export function saveEscenarios(escenarios: Escenario[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(escenarios));
    window.dispatchEvent(new CustomEvent(SCENARIOS_EVENT));
  } catch (err) {
    console.error('Error guardando escenarios:', err);
  }
}

export function saveEscenario(esc: Escenario): void {
  const list = getEscenarios();
  const idx = list.findIndex((e) => e.id === esc.id);
  if (idx >= 0) {
    list[idx] = esc;
  } else {
    list.unshift(esc);
  }
  saveEscenarios(list);
}

export function deleteEscenario(id: string): void {
  const list = getEscenarios().filter((e) => e.id !== id);
  saveEscenarios(list);
}

export function toggleEscenarioActivo(id: string): void {
  const list = getEscenarios().map((e) => (e.id === id ? { ...e, activo: !e.activo } : e));
  saveEscenarios(list);
}

export function getActiveSimMovimientos(): { mov: SimMovimiento; escenarioNombre: string }[] {
  const list = getEscenarios();
  const res: { mov: SimMovimiento; escenarioNombre: string }[] = [];
  for (const esc of list) {
    if (!esc.activo) continue;
    for (const m of esc.movimientos) {
      if (m.activo) {
        res.push({ mov: m, escenarioNombre: esc.nombre });
      }
    }
  }
  return res;
}

export function getSimMontoMes(m: SimMovimiento, targetYM: string, soloPropio = true): number {
  const factor = soloPropio ? (m.porcentaje_propio ?? 100) / 100 : 1;
  const startYM = m.mes_inicio;

  if (m.es_recurrente) {
    if (startYM <= targetYM) {
      return (m.monto_cuota || m.monto_total) * factor;
    }
    return 0;
  }

  if (m.cuotas_totales > 1) {
    const [sy, sm] = startYM.split('-').map(Number);
    const [ty, tm] = targetYM.split('-').map(Number);
    const diff = (ty - sy) * 12 + (tm - sm);
    if (diff >= 0 && diff < m.cuotas_totales) {
      const cuota = m.monto_cuota || (m.monto_total / m.cuotas_totales);
      return cuota * factor;
    }
    return 0;
  }

  return startYM === targetYM ? m.monto_total * factor : 0;
}
