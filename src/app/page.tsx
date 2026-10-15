import AlivioFinancieroWidget from '@/components/AlivioFinancieroWidget';
import MonthDonut from '@/components/MonthDonut';

export default function Dashboard() {
  const mes = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return (
    <div className="space-y-6">
      <header className="animate-rise">
        <p className="label">{mes}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">Tu mes</h1>
      </header>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <AlivioFinancieroWidget />
        <MonthDonut />
      </div>
    </div>
  );
}
