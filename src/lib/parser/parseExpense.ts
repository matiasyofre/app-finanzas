/**
 * Parser de lenguaje natural para carga rápida de gastos.
 *
 * Ejemplos:
 *   "15000 nafta"               -> 15000, "nafta", 1 cuota
 *   "90000 zapatillas en 5"     -> 90000, "zapatillas", 5 cuotas
 *   "14000 repuesto 2c"         -> 14000, "repuesto", 2 cuotas
 *   "150000 viaje 18 cuotas"    -> 150000, "viaje", 18 cuotas
 *   "$ 1.250.000,50 tele x12"   -> 1250000.5, "tele", 12 cuotas
 *   "+350000 sueldo"            -> ingreso
 */

export type ParsedExpense = {
  monto: number | null;
  descripcion: string;
  cuotas: number;
  tipo: 'ingreso' | 'egreso';
};

/** Monto al inicio: signo opcional, "$" opcional, miles con "." y decimales con "," (o formato plano). */
const AMOUNT_RE = /^\s*([+-])?\s*\$?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(k)?(?=\s|$)/i;

/**
 * Cuotas al final del texto (sin límite de dígitos):
 *   "en 5" | "en 5 cuotas" | "5c" | "5 c" | "18 cuotas" | "1 cuota" | "x12" | "12x"
 */
const INSTALLMENTS_RE =
  /(?:^|\s)(?:en\s+(\d+)(?:\s*(?:c|cuotas?|x))?|(\d+)\s*(?:c|cuotas?|x)|x\s*(\d+))\s*$/i;

const INCOME_HINT_RE = /\b(sueldo|cobr[eé]|ingreso|aguinaldo|venta|reintegro)\b/i;

export function parseAmount(raw: string): number {
  let s = raw;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  return Number(s);
}

export function parseExpense(input: string): ParsedExpense {
  let rest = input.trim();
  let monto: number | null = null;
  let sign: string | undefined;

  const a = rest.match(AMOUNT_RE);
  if (a) {
    sign = a[1];
    monto = parseAmount(a[2]) * (a[3] ? 1000 : 1);
    rest = rest.slice(a[0].length).trim();
  }

  let cuotas = 1;
  const c = rest.match(INSTALLMENTS_RE);
  if (c) {
    const n = Number(c[1] ?? c[2] ?? c[3]);
    if (Number.isInteger(n) && n >= 1) {
      cuotas = n;
      rest = rest.slice(0, c.index).trim();
    }
  }

  const tipo: ParsedExpense['tipo'] =
    sign === '+' || (sign !== '-' && INCOME_HINT_RE.test(rest)) ? 'ingreso' : 'egreso';

  return { monto, descripcion: rest, cuotas, tipo };
}

/**
 * Divide un total en N cuotas trabajando en centavos.
 * La diferencia de redondeo se suma a la ÚLTIMA cuota (mismo criterio que la vista SQL).
 */
export function splitInstallments(total: number, n: number): { cuota: number; ultima: number } {
  const cents = Math.round(total * 100);
  const base = Math.round(cents / n);
  const ultima = cents - base * (n - 1);
  return { cuota: base / 100, ultima: ultima / 100 };
}
