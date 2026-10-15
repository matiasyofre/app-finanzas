const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const ars2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });

export const money = (n: number, decimals = false) => (decimals ? ars2 : ars).format(n);

export const compact = (n: number) =>
  new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export const monthLabel = (iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', opts).replace('.', '');
