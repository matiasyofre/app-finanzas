import AjustesManager from '@/components/AjustesManager';

export const metadata = { title: 'Ajustes · App Finanzas' };

export default function Ajustes() {
  return (
    <div className="space-y-5">
      <header className="animate-rise">
        <p className="label">Configuración</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Ajustes</h1>
      </header>
      <AjustesManager />
    </div>
  );
}
