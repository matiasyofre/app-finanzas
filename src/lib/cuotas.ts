import type { Cuenta } from './catalogs';

/** Fecha local de hoy en formato YYYY-MM-DD (sin desfase UTC). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Mes sugerido de la primera cuota ("YYYY-MM"). Misma regla que el trigger SQL:
 * tarjeta de crédito + compra posterior al día de cierre => mes siguiente.
 */
export function firstInstallmentMonth(fechaCompra: string, cuenta?: Pick<Cuenta, 'tipo' | 'dia_cierre'> | null): string {
  const [y, m, d] = fechaCompra.split('-').map(Number);
  const shift = cuenta?.tipo === 'credito' && cuenta.dia_cierre && d > cuenta.dia_cierre ? 1 : 0;
  return addMonths(`${y}-${String(m).padStart(2, '0')}`, shift);
}

/** Suma meses a "YYYY-MM". */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-11" -> "nov 2026" */
export function ymLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' }).replace('.', '');
}

/** Diferencia en meses entre dos "YYYY-MM". */
export function monthDiff(from: string, to: string): number {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
