-- =====================================================================
--  0006 · Saldos Iniciales en Cuentas y Proyecciones Robustas
-- =====================================================================

-- 1. Agregar saldo_inicial a cuentas_tarjetas (para bancos, billeteras y efectivo)
alter table public.cuentas_tarjetas
  add column if not exists saldo_inicial numeric(14,2) not null default 0;

-- 2. Mejorar get_proyeccion_desglosada para clasificar cualquier compra en cuotas (> 1) como tarjeta/cuota
create or replace function public.get_proyeccion_desglosada(p_meses int default 12)
returns table (
  mes           date,
  ingresos      numeric,
  tarjetas      numeric,
  prestamos     numeric,
  fijos         numeric,
  variables     numeric,
  total_egresos numeric,
  saldo_neto    numeric
)
language sql stable security invoker set search_path = public as $$
  with meses as (
    select (date_trunc('month', current_date) + make_interval(months => g))::date as mes
    from generate_series(0, p_meses - 1) g
  ),
  agg as (
    select
      mm.mes,
      coalesce(sum(v.monto) filter (where v.tipo = 'ingreso'), 0) as ingresos,
      -- Tarjetas / Cuotas: compras en tarjeta de crédito o cualquier compra en más de 1 cuota que no sea préstamo
      coalesce(sum(v.monto) filter (
        where v.tipo = 'egreso'
          and (v.cuenta_tipo = 'credito' or (v.cuotas_totales > 1 and coalesce(v.cuenta_tipo::text, '') <> 'prestamo'))
      ), 0) as tarjetas,
      -- Préstamos
      coalesce(sum(v.monto) filter (
        where v.tipo = 'egreso' and v.cuenta_tipo = 'prestamo'
      ), 0) as prestamos,
      -- Gastos Fijos (no cuotas de crédito ni préstamos)
      coalesce(sum(v.monto) filter (
        where v.tipo = 'egreso'
          and v.naturaleza = 'fijo'
          and v.cuotas_totales = 1
          and (v.cuenta_tipo is null or v.cuenta_tipo not in ('credito', 'prestamo'))
      ), 0) as fijos,
      -- Gastos Variables (no cuotas de crédito ni préstamos)
      coalesce(sum(v.monto) filter (
        where v.tipo = 'egreso'
          and v.naturaleza in ('variable', 'compartido')
          and v.cuotas_totales = 1
          and (v.cuenta_tipo is null or v.cuenta_tipo not in ('credito', 'prestamo'))
      ), 0) as variables
    from meses mm
    left join public.v_cronograma_cuotas v
      on v.mes = mm.mes and v.usuario_id = auth.uid()
    group by mm.mes
  )
  select
    a.mes,
    a.ingresos,
    a.tarjetas,
    a.prestamos,
    a.fijos,
    a.variables,
    (a.tarjetas + a.prestamos + a.fijos + a.variables) as total_egresos,
    (a.ingresos - (a.tarjetas + a.prestamos + a.fijos + a.variables)) as saldo_neto
  from agg a
  order by a.mes;
$$;

grant execute on function public.get_proyeccion_desglosada(int) to authenticated;
