-- =====================================================================
--  0008 · Soporte para tipo de cuenta 'banco' y compatibilidad
-- =====================================================================

-- 1. Agregar 'banco' al enum tipo_cuenta si no existe
alter type public.tipo_cuenta add value if not exists 'banco';

-- 2. Asegurar columna saldo_inicial en cuentas_tarjetas si no existe
alter table public.cuentas_tarjetas
  add column if not exists saldo_inicial numeric(14,2) not null default 0;
