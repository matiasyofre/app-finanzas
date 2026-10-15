import { getSupabase, type NuevaTransaccion } from './supabase/client';

const KEY = 'gastos:pending';

/** Cola offline: si no hay red, guarda en localStorage y sincroniza al volver la conexión. */
export async function saveTransaction(tx: NuevaTransaccion): Promise<'synced' | 'queued'> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueue(tx);
    return 'queued';
  }
  const { error } = await getSupabase().from('transacciones').insert(tx);
  if (error) {
    if (/fetch|network/i.test(error.message)) {
      enqueue(tx);
      return 'queued';
    }
    throw error;
  }
  notifyChange();
  return 'synced';
}

function enqueue(tx: NuevaTransaccion) {
  const q: NuevaTransaccion[] = JSON.parse(localStorage.getItem(KEY) ?? '[]');
  q.push(tx);
  localStorage.setItem(KEY, JSON.stringify(q));
}

export async function flushQueue() {
  const q: NuevaTransaccion[] = JSON.parse(localStorage.getItem(KEY) ?? '[]');
  if (!q.length) return;
  const { error } = await getSupabase().from('transacciones').insert(q);
  if (!error) {
    localStorage.removeItem(KEY);
    notifyChange();
  }
}

/** Evento global para que los widgets se refresquen tras una carga. */
export const TX_EVENT = 'gastos:changed';
export const notifyChange = () => window.dispatchEvent(new Event(TX_EVENT));
