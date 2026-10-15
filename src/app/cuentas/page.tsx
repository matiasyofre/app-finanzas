import CuentasManager from '@/components/CuentasManager';

export const metadata = { title: 'Cuentas y Billeteras · App Finanzas' };

export default function CuentasPage() {
  return (
    <div className="space-y-6">
      <header className="animate-rise">
        <p className="label">Dinero disponible y pasivos</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">Cuentas y Billeteras</h1>
        <p className="mt-1 text-sm text-jade">
          Saldos en tiempo real de tus bancos, billeteras virtuales y tarjetas.
        </p>
      </header>
      <CuentasManager />
    </div>
  );
}
