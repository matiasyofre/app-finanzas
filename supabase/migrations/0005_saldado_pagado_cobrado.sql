-- =====================================================================
--  0005 · Marcar movimientos y cuotas como Pagado / Cobrado (Saldado)
-- =====================================================================

-- 1. Agregar saldado y fecha_saldado a transacciones
alter table public.transacciones
  add column if not exists saldado boolean not null default false,
  add column if not exists fecha_saldado date;

-- 2. Agregar saldada a transacciones_cuotas para control cuota a cuota
alter table public.transacciones_cuotas
  add column if not exists saldada boolean not null default false;

-- 3. Actualizar la vista v_cronograma_cuotas para reflejar el estado de saldado
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
  -- Una cuota está saldada si la transacción completa está saldada o si la cuota puntual se marcó saldada
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
      when n = t.cuotas_totales
        then t.monto_total - t.monto_cuota * (t.cuotas_totales - 1)
      else t.monto_cuota
    end
  )::numeric(14,2)                       as monto_nominal,
  round(
    coalesce(
      tc.monto_cuota,
      case
        when n = t.cuotas_totales
          then t.monto_total - t.monto_cuota * (t.cuotas_totales - 1)
        else t.monto_cuota
      end
    ) * (t.porcentaje_propio / 100.0),
    2
  )::numeric(14,2)                       as monto,
  round(
    coalesce(
      tc.monto_cuota,
      case
        when n = t.cuotas_totales
          then t.monto_total - t.monto_cuota * (t.cuotas_totales - 1)
        else t.monto_cuota
      end
    ) * ((100.0 - t.porcentaje_propio) / 100.0),
    2
  )::numeric(14,2)                       as monto_diferencial,
  (n = t.cuota_actual)                   as es_primera,
  (n = t.cuotas_totales)                 as es_ultima
from public.transacciones t
left join public.cuentas_tarjetas cta on cta.id = t.cuenta_id
cross join lateral generate_series(t.cuota_actual, t.cuotas_totales) as n
left join public.transacciones_cuotas tc
  on tc.transaccion_id = t.id and tc.nro_cuota = n;

-- 4. Recrear RPCs dependientes
create or replace function public.ajustar_cuota_transaccion(
  p_transaccion_id     uuid,
  p_desde_cuota        int,
  p_nuevo_monto        numeric,
  p_aplicar_a_futuras  boolean default true
)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_totales int;
  v_hasta   int;
begin
  select cuotas_totales into v_totales
  from public.transacciones
  where id = p_transaccion_id and usuario_id = auth.uid();

  if not found then
    raise exception 'Transacción no encontrada o no autorizada';
  end if;

  if p_aplicar_a_futuras then
    v_hasta := v_totales;
  else
    v_hasta := p_desde_cuota;
  end if;

  insert into public.transacciones_cuotas (transaccion_id, nro_cuota, monto_cuota)
  select p_transaccion_id, g, p_nuevo_monto
  from generate_series(p_desde_cuota, v_hasta) g
  on conflict (transaccion_id, nro_cuota)
  do update set monto_cuota = excluded.monto_cuota;
end $$;

create or replace function public.get_cashflow_delta(p_mes date default current_date)
returns table (
  mes_actual            date,
  mes_siguiente         date,
  comprometido_actual   numeric,
  comprometido_siguiente numeric,
  liberado              numeric,
  nueva_deuda           numeric,
  delta                 numeric,
  cuotas_que_terminan   integer,
  ingresos_actual       numeric
)
language sql stable security invoker set search_path = public as $$
  with m as (
    select date_trunc('month', p_mes)::date                       as m0,
           (date_trunc('month', p_mes) + interval '1 month')::date as m1
  ),
  c as (
    select v.* from public.v_cronograma_cuotas v, m
    where v.usuario_id = auth.uid()
      and v.mes in (m.m0, m.m1)
  )
  select
    m.m0, m.m1,
    coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m0), 0),
    coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m1), 0),
    coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m0 and c.es_ultima), 0),
    coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m1 and c.es_primera), 0),
    coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m1), 0)
      - coalesce(sum(c.monto) filter (where c.tipo = 'egreso' and c.mes = m.m0), 0),
    (count(*) filter (where c.tipo = 'egreso' and c.mes = m.m0 and c.es_ultima and c.cuotas_totales > 1))::int,
    coalesce(sum(c.monto) filter (where c.tipo = 'ingreso' and c.mes = m.m0), 0)
  from m left join c on true
  group by m.m0, m.m1;
$$;

create or replace function public.get_proyeccion_waterfall(p_meses int default 12)
returns table (
  mes           date,
  comprometido  numeric,
  liberado      numeric,
  nueva_deuda   numeric,
  delta         numeric
)
language sql stable security invoker set search_path = public as $$
  with meses as (
    select (date_trunc('month', current_date) + make_interval(months => g))::date as mes
    from generate_series(0, p_meses) g
  ),
  agg as (
    select mm.mes,
      coalesce(sum(v.monto) filter (where v.tipo = 'egreso'), 0)                  as comprometido,
      coalesce(sum(v.monto) filter (where v.tipo = 'egreso' and v.es_primera), 0) as nueva_deuda
    from meses mm
    left join public.v_cronograma_cuotas v
      on v.mes = mm.mes and v.usuario_id = auth.uid()
    group by mm.mes
  ),
  fin as (
    select (v.mes + interval '1 month')::date as mes, sum(v.monto) as liberado
    from public.v_cronograma_cuotas v
    where v.usuario_id = auth.uid() and v.tipo = 'egreso' and v.es_ultima
    group by 1
  )
  select a.mes, a.comprometido,
         coalesce(f.liberado, 0),
         a.nueva_deuda,
         a.comprometido - coalesce(lag(a.comprometido) over (order by a.mes), a.comprometido)
  from agg a left join fin f on f.mes = a.mes
  order by a.mes;
$$;

create or replace function public.get_resumen_mes(p_mes date default current_date)
returns table (categoria text, color text, icono text, total numeric)
language sql stable security invoker set search_path = public as $$
  select coalesce(c.nombre, 'Sin categoría'), coalesce(c.color, '#7A8B8F'), c.icono, sum(v.monto)
  from public.v_cronograma_cuotas v
  left join public.categorias c on c.id = v.categoria_id
  where v.usuario_id = auth.uid()
    and v.tipo = 'egreso'
    and v.mes = date_trunc('month', p_mes)::date
  group by 1, 2, 3
  order by 4 desc;
$$;

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
      coalesce(sum(v.monto) filter (where v.tipo = 'egreso' and v.cuenta_tipo = 'credito'), 0) as tarjetas,
      coalesce(sum(v.monto) filter (where v.tipo = 'egreso' and v.cuenta_tipo = 'prestamo'), 0) as prestamos,
      coalesce(sum(v.monto) filter (
        where v.tipo = 'egreso'
          and v.naturaleza = 'fijo'
          and (v.cuenta_tipo is null or v.cuenta_tipo not in ('credito', 'prestamo'))
      ), 0) as fijos,
      coalesce(sum(v.monto) filter (
        where v.tipo = 'egreso'
          and v.naturaleza in ('variable', 'compartido')
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

create or replace function public.get_proyeccion_por_cuenta(p_tipo_cuenta text default 'credito', p_meses int default 12)
returns table (
  mes           date,
  cuenta_id     uuid,
  cuenta_nombre text,
  total         numeric
)
language sql stable security invoker set search_path = public as $$
  with meses as (
    select (date_trunc('month', current_date) + make_interval(months => g))::date as mes
    from generate_series(0, p_meses - 1) g
  )
  select
    mm.mes,
    v.cuenta_id,
    coalesce(v.cuenta_nombre, 'Otras') as cuenta_nombre,
    coalesce(sum(v.monto), 0)::numeric as total
  from meses mm
  inner join public.v_cronograma_cuotas v
    on v.mes = mm.mes and v.usuario_id = auth.uid()
  where v.tipo = 'egreso'
    and v.cuenta_tipo::text = p_tipo_cuenta
  group by mm.mes, v.cuenta_id, v.cuenta_nombre
  order by mm.mes, cuenta_nombre;
$$;

grant select on public.v_cronograma_cuotas to authenticated;
grant execute on function public.ajustar_cuota_transaccion(uuid, int, numeric, boolean) to authenticated;
grant execute on function public.get_cashflow_delta(date)           to authenticated;
grant execute on function public.get_proyeccion_waterfall(int)      to authenticated;
grant execute on function public.get_resumen_mes(date)              to authenticated;
grant execute on function public.get_proyeccion_desglosada(int)     to authenticated;
grant execute on function public.get_proyeccion_por_cuenta(text, int) to authenticated;
