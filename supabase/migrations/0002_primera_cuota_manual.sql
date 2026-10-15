-- =====================================================================
--  0002 · Permite elegir manualmente el mes de la primera cuota
--  Ejecutar en Supabase → SQL Editor (es idempotente).
-- =====================================================================

create or replace function public.tx_before_write()
returns trigger language plpgsql as $$
declare
  v_cierre smallint;
  v_mes    date;
begin
  new.monto_cuota := round(new.monto_total / new.cuotas_totales, 2);

  -- Mes sugerido según fecha de compra y cierre de tarjeta
  v_mes := date_trunc('month', new.fecha_compra)::date;
  if new.cuenta_id is not null then
    select dia_cierre into v_cierre
    from public.cuentas_tarjetas
    where id = new.cuenta_id and tipo = 'credito';
    if v_cierre is not null and extract(day from new.fecha_compra) > v_cierre then
      v_mes := (v_mes + interval '1 month')::date;
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- Si el frontend envía el mes elegido, se respeta
    new.fecha_primera_cuota := coalesce(date_trunc('month', new.fecha_primera_cuota)::date, v_mes);
  elsif new.fecha_primera_cuota is distinct from old.fecha_primera_cuota then
    new.fecha_primera_cuota := date_trunc('month', new.fecha_primera_cuota)::date;   -- cambio manual
  elsif new.fecha_compra is distinct from old.fecha_compra
     or new.cuenta_id   is distinct from old.cuenta_id then
    new.fecha_primera_cuota := v_mes;                                               -- recalcular
  end if;

  return new;
end $$;
