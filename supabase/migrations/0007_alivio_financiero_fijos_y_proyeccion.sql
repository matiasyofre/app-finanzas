-- =====================================================================
--  0007 · Alivio Financiero Real, Gastos Fijos Continuos y Proyección
-- =====================================================================

-- 1. Actualizar v_cronograma_cuotas para proyectar gastos fijos y calcular es_ultima correctamente
drop view if exists public.v_cronograma_cuotas cascade;

create or replace view public.v_cronograma_cuotas
with (security_invoker = true) as
select
  t.id                                   as transaccion_id,
  t.usuario_id,
  t.categoria_id,
  t.cuenta_id,
  t.tipo,
  t.naturaleza,
  t.porcentaje_propio,
  t.compartido_con,
  t.pagado_por,
  t.saldado                              as tx_saldada,
  (t.saldado or coalesce(tc.saldada, false)) as cuota_saldada,
  t.es_recurrente,
  cta.tipo                               as cuenta_tipo,
  cta.nombre                             as cuenta_nombre,
  t.descripcion,
  n                                      as nro_cuota,
  t.cuotas_totales,
  (t.fecha_primera_cuota + make_interval(months => n - t.cuota_actual))::date as mes,
  coalesce(
    tc.monto_cuota,
    case
      when (t.naturaleza = 'fijo' or coalesce(t.es_recurrente, false)) then t.monto_total
      when n = t.cuotas_totales then t.monto_total - t.monto_cuota * (t.cuotas_totales - 1)
      else t.monto_cuota
    end
  )::numeric(14,2)                       as monto_nominal,
  round(
    coalesce(
      tc.monto_cuota,
      case
        when (t.naturaleza = 'fijo' or coalesce(t.es_recurrente, false)) then t.monto_total
        when n = t.cuotas_totales then t.monto_total - t.monto_cuota * (t.cuotas_totales - 1)
        else t.monto_cuota
      end
    ) * (t.porcentaje_propio / 100.0),
    2
  )::numeric(14,2)                       as monto,
  round(
    coalesce(
      tc.monto_cuota,
      case
        when (t.naturaleza = 'fijo' or coalesce(t.es_recurrente, false)) then t.monto_total
        when n = t.cuotas_totales then t.monto_total - t.monto_cuota * (t.cuotas_totales - 1)
        else t.monto_cuota
      end
    ) * ((100.0 - t.porcentaje_propio) / 100.0),
    2
  )::numeric(14,2)                       as monto_diferencial,
  (n = t.cuota_actual)                   as es_primera,
  -- Un gasto fijo NO es última cuota porque no desaparece.
  -- Los gastos variables de 1 pago o la última cuota de tarjetas/préstamos SÍ son última cuota.
  (
    not (t.naturaleza = 'fijo' or coalesce(t.es_recurrente, false))
    and (n = t.cuotas_totales)
  )                                      as es_ultima
from public.transacciones t
left join public.cuentas_tarjetas cta on cta.id = t.cuenta_id
cross join lateral generate_series(
  t.cuota_actual,
  case
    -- Si es fijo o recurrente, proyectar al menos 24 meses hacia adelante
    when (t.naturaleza = 'fijo' or coalesce(t.es_recurrente, false)) then greatest(t.cuotas_totales, 24)
    else t.cuotas_totales
  end
) as n
left join public.transacciones_cuotas tc
  on tc.transaccion_id = t.id and tc.nro_cuota = n;

-- 2. Recrear RPC get_cashflow_delta
create or replace function public.get_cashflow_delta(p_mes date default current_date)
returns table (
  mes_actual             date,
  mes_siguiente          date,
  comprometido_actual    numeric,
  comprometido_siguiente numeric,
  liberado               numeric,
  nueva_deuda            numeric,
  delta                  numeric,
  cuotas_que_terminan    integer,
  ingresos_actual        numeric
)
language sql stable security invoker set search_path = public as $$
  with m as (
    select date_trunc('month', p_mes)::date                        as m0,
           (date_trunc('month', p_mes) + interval '1 month')::date as m1
  ),
  c as (
    select v.* from public.v_cronograma_cuotas v, m
    where v.usuario_id = auth.uid()
      and v.mes in (m.m0, m.m1)
  )
  select
    m.m0, m.m1,
    coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m0), 0) as comprometido_actual,
    coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m1), 0) as comprometido_siguiente,
    -- Liberado: egresos de m0 que terminan en m0 (variables de 1 pago o última cuota de tarjeta/préstamo)
    coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m0 and c.es_ultima), 0) as liberado,
    coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m1 and c.es_primera), 0) as nueva_deuda,
    coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m1), 0)
      - coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m0), 0) as delta,
    (count(*) filter (where c.tipo = 'egreso' and c.mes = m.m0 and c.es_ultima))::int as cuotas_que_terminan,
    coalesce(sum(c.monto) filter (where c.tipo = 'ingreso' and c.mes = m.m0), 0) as ingresos_actual
  from m left join c on true
  group by m.m0, m.m1;
$$;

-- 3. Nueva RPC: get_alivio_financiero_proyeccion (proyección mes a mes del alivio financiero a 12 meses)
create or replace function public.get_alivio_financiero_proyeccion(p_meses int default 12)
returns table (
  mes              date,
  comprometido     numeric,
  liberado_mes     numeric,
  alivio_acumulado numeric,
  planes_terminan  int
)
language sql stable security invoker set search_path = public as $$
  with meses as (
    select (date_trunc('month', current_date) + make_interval(months => g))::date as mes
    from generate_series(0, p_meses - 1) g
  ),
  agg as (
    select
      mm.mes,
      coalesce(sum(v.monto) filter (where v.tipo = 'egreso'), 0) as comprometido,
      coalesce(sum(v.monto) filter (where v.tipo = 'egreso' and v.es_ultima), 0) as liberado_mes,
      count(*) filter (where v.tipo = 'egreso' and v.es_ultima)::int as planes_terminan
    from meses mm
    left join public.v_cronograma_cuotas v
      on v.mes = mm.mes and v.usuario_id = auth.uid()
    group by mm.mes
  ),
  base as (
    select comprometido as base_comp from agg where mes = (select min(mes) from agg)
  )
  select
    a.mes,
    a.comprometido,
    a.liberado_mes,
    greatest(0, (select base_comp from base) - a.comprometido) as alivio_acumulado,
    a.planes_terminan
  from agg a
  order by a.mes;
$$;

-- 4. Recrear permisos
grant select on public.v_cronograma_cuotas to authenticated;
grant execute on function public.get_cashflow_delta(date) to authenticated;
grant execute on function public.get_alivio_financiero_proyeccion(int) to authenticated;
