-- =====================================================================
--  App de Gastos · Esquema inicial (Supabase / PostgreSQL 15+)
--  Tablas, RLS, lógica de cuotas, cronograma proyectado y Cashflow Delta
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type tipo_movimiento as enum ('ingreso', 'egreso');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_cuenta as enum ('efectivo', 'debito', 'credito', 'prestamo', 'billetera');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- usuarios (perfil 1:1 con auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique,
  nombre      text,
  moneda      char(3)  not null default 'ARS',
  locale      text     not null default 'es-AR',
  created_at  timestamptz not null default now()
);

-- Alta automática del perfil al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  -- Categorías por defecto
  insert into public.categorias (usuario_id, nombre, icono, color, tipo) values
    (new.id, 'Supermercado', '🛒', '#22D3EE', 'egreso'),
    (new.id, 'Transporte',   '⛽', '#0F766E', 'egreso'),
    (new.id, 'Hogar',        '🏠', '#C98B6D', 'egreso'),
    (new.id, 'Ocio',         '🎉', '#A78BFA', 'egreso'),
    (new.id, 'Ropa',         '👟', '#F472B6', 'egreso'),
    (new.id, 'Otros',        '📦', '#7A8B8F', 'egreso'),
    (new.id, 'Sueldo',       '💼', '#25D366', 'ingreso');
  return new;
end $$;

-- ---------------------------------------------------------------------
-- categorias
-- ---------------------------------------------------------------------
create table if not exists public.categorias (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null default auth.uid() references public.usuarios(id) on delete cascade,
  nombre      text not null,
  icono       text,
  color       text not null default '#7A8B8F',
  tipo        tipo_movimiento not null default 'egreso',
  created_at  timestamptz not null default now(),
  unique (usuario_id, nombre)
);

-- ---------------------------------------------------------------------
-- cuentas_tarjetas
-- ---------------------------------------------------------------------
create table if not exists public.cuentas_tarjetas (
  id               uuid primary key default gen_random_uuid(),
  usuario_id       uuid not null default auth.uid() references public.usuarios(id) on delete cascade,
  nombre           text not null,                 -- "Visa Galicia", "Efectivo"
  tipo             tipo_cuenta not null default 'efectivo',
  dia_cierre       smallint check (dia_cierre between 1 and 31),
  dia_vencimiento  smallint check (dia_vencimiento between 1 and 31),
  limite           numeric(14,2),
  activa           boolean not null default true,
  created_at       timestamptz not null default now()
);

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- transacciones (una fila por compra "madre"; el cronograma se deriva)
-- ---------------------------------------------------------------------
create table if not exists public.transacciones (
  id                   uuid primary key default gen_random_uuid(),
  usuario_id           uuid not null default auth.uid() references public.usuarios(id) on delete cascade,
  categoria_id         uuid references public.categorias(id) on delete set null,
  cuenta_id            uuid references public.cuentas_tarjetas(id) on delete set null,
  tipo                 tipo_movimiento not null default 'egreso',
  descripcion          text not null,
  monto_total          numeric(14,2) not null check (monto_total > 0),
  cuotas_totales       integer not null default 1 check (cuotas_totales >= 1),
  cuota_actual         integer not null default 1,  -- cuota en la que arranca el seguimiento (p.ej. 3 de 12)
  monto_cuota          numeric(14,2),               -- calculado por trigger
  fecha_compra         date not null default current_date,
  fecha_primera_cuota  date,                        -- 1er día del mes en que impacta cuota_actual (trigger)
  texto_original       text,                        -- input en lenguaje natural ("90000 zapatillas en 5")
  created_at           timestamptz not null default now(),
  constraint chk_cuota_actual check (cuota_actual between 1 and cuotas_totales)
);

create index if not exists idx_tx_usuario_mes on public.transacciones (usuario_id, fecha_primera_cuota);
create index if not exists idx_tx_usuario_tipo on public.transacciones (usuario_id, tipo);

-- Calcula monto de cuota y mes de impacto según el cierre de la tarjeta
create or replace function public.tx_before_write()
returns trigger language plpgsql as $$
declare
  v_cierre smallint;
  v_mes    date;
begin
  -- Cuota base redondeada; la diferencia de centavos se absorbe en la última (ver vista)
  new.monto_cuota := round(new.monto_total / new.cuotas_totales, 2);

  v_mes := date_trunc('month', new.fecha_compra)::date;

  if new.cuenta_id is not null then
    select dia_cierre into v_cierre
    from public.cuentas_tarjetas
    where id = new.cuenta_id and tipo = 'credito';

    -- Compra posterior al cierre => impacta en el resumen del mes siguiente
    if v_cierre is not null and extract(day from new.fecha_compra) > v_cierre then
      v_mes := (v_mes + interval '1 month')::date;
    end if;
  end if;

  if tg_op = 'INSERT' or new.fecha_primera_cuota is null
     or new.fecha_compra is distinct from old.fecha_compra
     or new.cuenta_id   is distinct from old.cuenta_id then
    new.fecha_primera_cuota := v_mes;
  else
    new.fecha_primera_cuota := date_trunc('month', new.fecha_primera_cuota)::date;
  end if;

  return new;
end $$;

drop trigger if exists trg_tx_before_write on public.transacciones;
create trigger trg_tx_before_write
  before insert or update on public.transacciones
  for each row execute function public.tx_before_write();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.usuarios          enable row level security;
alter table public.categorias        enable row level security;
alter table public.cuentas_tarjetas  enable row level security;
alter table public.transacciones     enable row level security;

drop policy if exists "usuarios_self" on public.usuarios;
create policy "usuarios_self" on public.usuarios
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "categorias_owner" on public.categorias;
create policy "categorias_owner" on public.categorias
  for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "cuentas_owner" on public.cuentas_tarjetas;
create policy "cuentas_owner" on public.cuentas_tarjetas
  for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "tx_owner" on public.transacciones;
create policy "tx_owner" on public.transacciones
  for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- ---------------------------------------------------------------------
-- VISTA: cronograma de cuotas calculado al vuelo (sin duplicar filas)
--   Una fila por cada cuota pendiente: cuota_actual .. cuotas_totales
-- ---------------------------------------------------------------------
create or replace view public.v_cronograma_cuotas
with (security_invoker = true) as
select
  t.id                                   as transaccion_id,
  t.usuario_id,
  t.categoria_id,
  t.cuenta_id,
  t.tipo,
  t.descripcion,
  n                                      as nro_cuota,
  t.cuotas_totales,
  (t.fecha_primera_cuota + make_interval(months => n - t.cuota_actual))::date as mes,
  case
    when n = t.cuotas_totales   -- última cuota absorbe el redondeo
      then t.monto_total - t.monto_cuota * (t.cuotas_totales - 1)
    else t.monto_cuota
  end::numeric(14,2)                     as monto,
  (n = t.cuota_actual)                   as es_primera,
  (n = t.cuotas_totales)                 as es_ultima
from public.transacciones t
cross join lateral generate_series(t.cuota_actual, t.cuotas_totales) as n;

-- ---------------------------------------------------------------------
-- RPC: Cashflow Delta (mes dado vs mes siguiente) — una sola pasada
--   delta < 0  => "Se liberan $X"   (alivio)
--   delta > 0  => "Se sumaron $Y"   (nueva deuda)
-- ---------------------------------------------------------------------
create or replace function public.get_cashflow_delta(p_mes date default current_date)
returns table (
  mes_actual            date,
  mes_siguiente         date,
  comprometido_actual   numeric,
  comprometido_siguiente numeric,
  liberado              numeric,   -- cuotas que terminan este mes
  nueva_deuda           numeric,   -- cuotas que empiezan el mes siguiente
  delta                 numeric,   -- comprometido_siguiente - comprometido_actual
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

-- ---------------------------------------------------------------------
-- RPC: Proyección Waterfall a N meses
-- ---------------------------------------------------------------------
create or replace function public.get_proyeccion_waterfall(p_meses int default 12)
returns table (
  mes           date,
  comprometido  numeric,
  liberado      numeric,   -- lo que dejó de pagarse respecto al mes anterior
  nueva_deuda   numeric,   -- cuotas que arrancan este mes
  delta         numeric    -- comprometido - comprometido mes anterior
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
  fin as (   -- cuotas cuya última fue el mes anterior => se liberan este mes
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

-- ---------------------------------------------------------------------
-- RPC: Resumen del mes por categoría (Donut)
-- ---------------------------------------------------------------------
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

grant execute on function public.get_cashflow_delta(date)      to authenticated;
grant execute on function public.get_proyeccion_waterfall(int) to authenticated;
grant execute on function public.get_resumen_mes(date)         to authenticated;
grant select on public.v_cronograma_cuotas                     to authenticated;
