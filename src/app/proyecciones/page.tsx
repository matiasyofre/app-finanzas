import ProyeccionesManager from '@/components/ProyeccionesManager';

export const metadata = { title: 'Proyecciones 12 meses · App Finanzas' };

export default function Proyecciones() {
  return (
    <div className="space-y-6">
      <header className="animate-rise">
        <p className="label">Horizonte 12 meses</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">Proyecciones</h1>
        <p className="mt-1 text-sm text-jade">
          Analizá el impacto de cuotas de tarjetas, préstamos, compromisos fijos y flujo consolidado.
        </p>
      </header>
      <ProyeccionesManager />
    </div>
  );
}
