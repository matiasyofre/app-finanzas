import { describe, expect, it } from 'vitest';
import { parseExpense, splitInstallments, parseExcelAmount } from './parseExpense';

describe('parseExpense', () => {
  it.each([
    ['15000 nafta', 15000, 'nafta', 1],
    ['90000 zapatillas en 5', 90000, 'zapatillas', 5],
    ['14000 repuesto 2c', 14000, 'repuesto', 2],
    ['150000 viaje 18 cuotas', 150000, 'viaje', 18],
    ['60000 celu 1 cuota', 60000, 'celu', 1],
    ['1.250.000,50 tele x12', 1250000.5, 'tele', 12],
    ['$ 300000 notebook en 24 cuotas', 300000, 'notebook', 24],
    ['500000 auto 120x', 500000, 'auto', 120],
    ['20k super', 20000, 'super', 1],
    ['8000 iphone 15', 8000, 'iphone 15', 1], // número sin marcador => no son cuotas
  ])('%s', (input, monto, desc, cuotas) => {
    const r = parseExpense(input);
    expect(r.monto).toBe(monto);
    expect(r.descripcion).toBe(desc);
    expect(r.cuotas).toBe(cuotas);
  });

  it('detecta ingresos', () => {
    expect(parseExpense('+350000 freelance').tipo).toBe('ingreso');
    expect(parseExpense('900000 sueldo').tipo).toBe('ingreso');
    expect(parseExpense('15000 nafta').tipo).toBe('egreso');
  });
});

describe('splitInstallments', () => {
  it('ajusta redondeo en la última cuota', () => {
    expect(splitInstallments(100000, 3)).toEqual({ cuota: 33333.33, ultima: 33333.34 });
    expect(splitInstallments(90000, 5)).toEqual({ cuota: 18000, ultima: 18000 });
  });
});

describe('parseExcelAmount', () => {
  it('parsea números directos de Excel', () => {
    expect(parseExcelAmount(129484.32)).toBe(129484.32);
    expect(parseExcelAmount(45000)).toBe(45000);
  });

  it('parsea strings con coma decimal argentina', () => {
    expect(parseExcelAmount('129484,32')).toBe(129484.32);
    expect(parseExcelAmount('129.484,32')).toBe(129484.32);
    expect(parseExcelAmount('$ 129.484,32')).toBe(129484.32);
  });

  it('parsea strings con punto decimal anglosajón', () => {
    expect(parseExcelAmount('129484.32')).toBe(129484.32);
    expect(parseExcelAmount('129,484.32')).toBe(129484.32);
  });

  it('parsea enteros con separador de miles', () => {
    expect(parseExcelAmount('129.484')).toBe(129484);
  });
});
