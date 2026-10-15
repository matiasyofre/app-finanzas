import MovimientosGrid from '@/components/MovimientosGrid';

export const metadata = { title: 'Movimientos · Cuotas' };

export default function Movimientos() {
  return (
    <div className="space-y-5">
      <header className="animate-rise">
        <p className="label">Detalle</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Movimientos</h1>
        <p className="mt-1 text-sm text-jade">Tocá una fila para editarla o eliminarla.</p>
      </header>
      <MovimientosGrid />
    </div>
  );
}
