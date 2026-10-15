'use client';

import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { getSupabase, type NuevaTransaccion } from '@/lib/supabase/client';
import { notifyChange } from '@/lib/offlineQueue';
import { useCatalogs } from '@/lib/catalogs';
import { money } from '@/lib/format';
import Modal from './Modal';

type ParsedRow = {
  fecha_compra: string;
  descripcion: string;
  monto_total: number;
  tipo: 'egreso' | 'ingreso';
  cuotas_totales: number;
  naturaleza: 'fijo' | 'variable' | 'compartido';
  cuenta_nombre?: string;
  categoria_nombre?: string;
  porcentaje_propio: number;
  pagado_por: 'yo' | 'otro';
  compartido_con?: string;
  fecha_primera_cuota?: string;
  error?: string;
};

export default function ExcelManager() {
  const { categorias, cuentas } = useCatalogs();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openModal, setOpenModal] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // 1. Descargar Plantilla Excel
  const handleDownloadTemplate = () => {
    const headers = [
      'Fecha (AAAA-MM-DD)',
      'Descripción',
      'Monto Total',
      'Tipo (egreso/ingreso)',
      'Cuotas (1 a 48)',
      'Naturaleza (variable/fijo/compartido)',
      'Cuenta o Tarjeta',
      'Categoría',
      '% Propio (1 a 100)',
      'Pagado Por (yo/otro)',
      'Compartido Con',
      'Mes 1ra Cuota (AAAA-MM)',
    ];

    const todayStr = new Date().toISOString().slice(0, 10);
    const thisMonthStr = todayStr.slice(0, 7);

    const sampleRows = [
      [
        todayStr,
        'Compra Supermercado',
        45000,
        'egreso',
        1,
        'variable',
        'Débito Galicia',
        'Supermercado',
        100,
        'yo',
        '',
        '',
      ],
      [
        todayStr,
        'Zapatillas Deportivas en Cuotas',
        90000,
        'egreso',
        6,
        'variable',
        'Visa Galicia',
        'Ropa',
        100,
        'yo',
        '',
        thisMonthStr,
      ],
      [
        todayStr,
        'Cena Amigos Dividida',
        30000,
        'egreso',
        1,
        'compartido',
        'Mercado Pago',
        'Ocio',
        50,
        'yo',
        'Lucas',
        '',
      ],
      [
        todayStr,
        'Cobro Sueldo Mensual',
        950000,
        'ingreso',
        1,
        'fijo',
        'Banco Santander',
        'Sueldo',
        100,
        'yo',
        '',
        '',
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);

    // Ancho de columnas para buena visualización
    ws['!cols'] = [
      { wch: 18 }, // Fecha
      { wch: 32 }, // Descripción
      { wch: 14 }, // Monto
      { wch: 12 }, // Tipo
      { wch: 10 }, // Cuotas
      { wch: 16 }, // Naturaleza
      { wch: 20 }, // Tarjeta / Cuenta
      { wch: 18 }, // Categoría
      { wch: 12 }, // % Propio
      { wch: 14 }, // Pagado Por
      { wch: 18 }, // Compartido Con
      { wch: 16 }, // Mes 1ra Cuota
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');

    XLSX.writeFile(wb, 'plantilla_movimientos_app_finanzas.xlsx');
  };

  // 2. Leer archivo Excel subido
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMsg(null);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];

        const rawData: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (!rawData.length) {
          alert('El archivo no contiene filas con datos.');
          return;
        }

        const parsed: ParsedRow[] = rawData.map((row) => {
          // Búsqueda flexible de columnas sin importar mayúsculas ni espacios
          const getVal = (patterns: string[]): string => {
            const keys = Object.keys(row);
            for (const p of patterns) {
              const foundKey = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes(p));
              if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
                return String(row[foundKey]).trim();
              }
            }
            return '';
          };

          const rawFecha = getVal(['fecha']);
          let fecha_compra = new Date().toISOString().slice(0, 10);
          if (rawFecha) {
            const d = new Date(rawFecha);
            if (!isNaN(d.getTime())) {
              fecha_compra = d.toISOString().slice(0, 10);
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawFecha)) {
              fecha_compra = rawFecha;
            }
          }

          const descripcion = getVal(['descrip', 'detalle', 'concepto']) || 'Gasto importado';
          const montoRaw = getVal(['monto', 'importe', 'total', 'precio']).replace(/[$.]/g, '').replace(',', '.');
          const monto_total = Math.abs(parseFloat(montoRaw)) || 0;

          const rawTipo = getVal(['tipo']).toLowerCase();
          const tipo: 'egreso' | 'ingreso' = rawTipo.includes('ingreso') ? 'ingreso' : 'egreso';

          const cuotasRaw = parseInt(getVal(['cuota']), 10);
          const cuotas_totales = !isNaN(cuotasRaw) && cuotasRaw >= 1 ? cuotasRaw : 1;

          const rawNat = getVal(['naturaleza', 'modalidad']).toLowerCase();
          let naturaleza: 'fijo' | 'variable' | 'compartido' = 'variable';
          if (rawNat.includes('fij')) naturaleza = 'fijo';
          else if (rawNat.includes('compart')) naturaleza = 'compartido';

          const cuenta_nombre = getVal(['cuenta', 'tarjeta', 'banco', 'billetera']);
          const categoria_nombre = getVal(['categ', 'rubro']);

          const pctRaw = parseFloat(getVal(['propio', 'porcentaje', 'pct']));
          const porcentaje_propio = !isNaN(pctRaw) && pctRaw > 0 && pctRaw <= 100 ? pctRaw : 100;

          const rawPagado = getVal(['pagadopor', 'quienpago', 'pagador']).toLowerCase();
          const pagado_por: 'yo' | 'otro' = rawPagado.includes('otro') ? 'otro' : 'yo';

          const compartido_con = getVal(['compartidocon', 'conquien', 'persona']);

          const rawMes1ra = getVal(['mes1', 'primera', 'mescuota']);
          let fecha_primera_cuota: string | undefined = undefined;
          if (rawMes1ra && /^\d{4}-\d{2}/.test(rawMes1ra)) {
            fecha_primera_cuota = `${rawMes1ra.slice(0, 7)}-01`;
          }

          let error: string | undefined = undefined;
          if (monto_total <= 0) error = 'Monto inválido';
          if (!descripcion.trim()) error = 'Falta descripción';

          return {
            fecha_compra,
            descripcion,
            monto_total,
            tipo,
            cuotas_totales,
            naturaleza,
            cuenta_nombre,
            categoria_nombre,
            porcentaje_propio,
            pagado_por,
            compartido_con,
            fecha_primera_cuota,
            error,
          };
        });

        setParsedRows(parsed);
        setOpenModal(true);
      } catch (err) {
        console.error('Error leyendo archivo:', err);
        alert('Hubo un error al leer el archivo Excel. Asegurate de que sea un archivo .xlsx válido.');
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsBinaryString(file);
  };

  // 3. Confirmar importación a Supabase
  const handleConfirmImport = async () => {
    const validRows = parsedRows.filter((r) => !r.error);
    if (!validRows.length) return;

    setImporting(true);
    setStatusMsg(null);
    const sb = getSupabase();

    try {
      const payload: NuevaTransaccion[] = validRows.map((row) => {
        // Encontrar o emparejar cuenta por nombre (case-insensitive)
        let cuenta_id: string | null = null;
        if (row.cuenta_nombre) {
          const matchCuenta = cuentas.find(
            (c) => c.nombre.toLowerCase().trim() === row.cuenta_nombre?.toLowerCase().trim(),
          );
          if (matchCuenta) cuenta_id = matchCuenta.id;
        }

        // Encontrar o emparejar categoría por nombre
        let categoria_id: string | null = null;
        if (row.categoria_nombre) {
          const matchCat = categorias.find(
            (c) => c.nombre.toLowerCase().trim() === row.categoria_nombre?.toLowerCase().trim(),
          );
          if (matchCat) categoria_id = matchCat.id;
        }

        return {
          descripcion: row.descripcion,
          monto_total: row.monto_total,
          cuotas_totales: row.cuotas_totales,
          tipo: row.tipo,
          naturaleza: row.naturaleza,
          porcentaje_propio: row.porcentaje_propio,
          pagado_por: row.pagado_por,
          compartido_con: row.compartido_con || null,
          fecha_compra: row.fecha_compra,
          cuenta_id,
          categoria_id,
          fecha_primera_cuota: row.fecha_primera_cuota,
        };
      });

      const { error } = await sb.from('transacciones').insert(payload);
      if (error) throw error;

      notifyChange();
      setStatusMsg({ type: 'ok', text: `¡Se importaron ${payload.length} movimientos con éxito!` });
      setTimeout(() => {
        setOpenModal(false);
        setParsedRows([]);
        setStatusMsg(null);
      }, 1500);
    } catch (err: unknown) {
      console.error('Error insertando transacciones:', err);
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error al guardar los movimientos en la base de datos.',
      });
    } finally {
      setImporting(false);
    }
  };

  const totalImportar = parsedRows
    .filter((r) => !r.error && r.tipo === 'egreso')
    .reduce((sum, r) => sum + r.monto_total, 0);

  const totalIngresos = parsedRows
    .filter((r) => !r.error && r.tipo === 'ingreso')
    .reduce((sum, r) => sum + r.monto_total, 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Botón para descargar plantilla */}
      <button
        type="button"
        onClick={handleDownloadTemplate}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-pebble transition hover:bg-white/10"
        title="Descargar plantilla de Excel pre-formateada"
      >
        <span>📥</span>
        <span>Plantilla Excel</span>
      </button>

      {/* Botón para subir archivo */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center gap-2 rounded-xl border border-cyan/30 bg-cyan/10 px-3 py-2 text-xs font-semibold text-cyan transition hover:bg-cyan/20"
        title="Importar movimientos desde archivo Excel o CSV"
      >
        <span>📤</span>
        <span>Importar Excel</span>
      </button>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".xlsx,.xls,.csv"
        className="hidden"
      />

      {/* Modal de confirmación de filas importadas */}
      <Modal
        open={openModal}
        onClose={() => !importing && setOpenModal(false)}
        title="Vista previa de importación"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-white/5 p-3">
              <span className="text-jade block">Movimientos detectados</span>
              <span className="text-base font-bold text-pebble">
                {parsedRows.filter((r) => !r.error).length} válidos
                {parsedRows.filter((r) => r.error).length > 0 && (
                  <span className="text-debt ml-1">({parsedRows.filter((r) => r.error).length} con error)</span>
                )}
              </span>
            </div>
            <div className="rounded-xl bg-white/5 p-3">
              <span className="text-jade block">Total a registrar</span>
              <span className="text-base font-bold text-debt">-{money(totalImportar)}</span>
              {totalIngresos > 0 && (
                <span className="text-income block text-[11px]">+{money(totalIngresos)}</span>
              )}
            </div>
          </div>

          {/* Tabla resumen de filas */}
          <div className="max-h-60 overflow-y-auto rounded-xl border border-white/10 bg-spruce-900/60 divide-y divide-white/5 text-xs">
            {parsedRows.map((r, i) => (
              <div key={i} className={`p-2.5 flex items-center justify-between gap-3 ${r.error ? 'bg-debt/10' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-pebble truncate">{r.descripcion}</p>
                  <p className="text-[11px] text-jade">
                    {r.fecha_compra} · {r.tipo === 'ingreso' ? 'Ingreso' : r.cuotas_totales > 1 ? `${r.cuotas_totales} cuotas` : '1 pago'}
                    {r.cuenta_nombre ? ` · ${r.cuenta_nombre}` : ''}
                    {r.naturaleza === 'compartido' ? ` · Dividido (${r.porcentaje_propio}%)` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`font-bold ${r.tipo === 'ingreso' ? 'text-income' : 'text-debt'}`}>
                    {r.tipo === 'ingreso' ? '+' : '-'}{money(r.monto_total)}
                  </p>
                  {r.error && <span className="text-[10px] text-debt block">{r.error}</span>}
                </div>
              </div>
            ))}
          </div>

          {statusMsg && (
            <div
              className={`rounded-xl p-3 text-center text-xs font-semibold ${
                statusMsg.type === 'ok' ? 'bg-income/20 text-income' : 'bg-debt/20 text-debt'
              }`}
            >
              {statusMsg.text}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              disabled={importing}
              onClick={() => setOpenModal(false)}
              className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-medium text-jade hover:bg-white/5 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={importing || parsedRows.filter((r) => !r.error).length === 0}
              onClick={handleConfirmImport}
              className="btn-primary flex-1 py-2.5 text-xs font-semibold"
            >
              {importing ? 'Importando...' : `Confirmar (${parsedRows.filter((r) => !r.error).length})`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
