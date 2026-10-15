# Cuotas · PWA de finanzas personales

Next.js (App Router) · Tailwind 3 · Supabase · Recharts · PWA (`@ducanh2912/next-pwa`) · Cloudflare Pages.

## Estructura

```
supabase/migrations/0001_init.sql   Tablas, RLS, trigger de cuotas, vista cronograma, RPCs
src/
  app/
    layout.tsx                      Layout raíz (FAB global, nav, auth)
    page.tsx                        Dashboard: Alivio Financiero + Donut
    proyecciones/page.tsx           Waterfall 12 meses
    offline/page.tsx                Fallback offline del service worker
    manifest.ts                     Web App Manifest
    globals.css                     Sistema glass (.glass, .btn-primary, .key)
  components/
    QuickAddFab.tsx                 FAB + Bottom Sheet + teclado + cuotas
    AlivioFinancieroWidget.tsx      RPC get_cashflow_delta
    MonthDonut.tsx                  RPC get_resumen_mes
    WaterfallChart.tsx              RPC get_proyeccion_waterfall
    AuthGate.tsx · BottomNav.tsx
  lib/
    parser/parseExpense.ts (+test)  Regex de lenguaje natural y división en centavos
    supabase/client.ts              Cliente + tipos
    offlineQueue.ts                 Cola offline (localStorage) + evento de refresco
    format.ts                       Formato es-AR / ARS
tailwind.config.js · next.config.mjs · wrangler.toml
```

## Setup

1. Crear proyecto en Supabase → SQL Editor → pegar `supabase/migrations/0001_init.sql`.
2. Auth → URL Configuration → agregar tu dominio (y `http://localhost:3000`) como redirect.
3. `cp .env.example .env.local` y completar URL + anon key.
4. `npm install` · `npm run dev` · `npm test`.

## Deploy en Cloudflare Pages

- Build command: `npx @cloudflare/next-on-pages` · Output: `.vercel/output/static`
- Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Compatibility flag: `nodejs_compat`

## Modelo de cuotas

Cada compra es **una fila** en `transacciones`. La vista `v_cronograma_cuotas` la expande con
`generate_series(cuota_actual, cuotas_totales)` → una fila por mes. Si la tarjeta es de crédito y
la compra es posterior a `dia_cierre`, la primera cuota cae el mes siguiente. El redondeo se
ajusta en la última cuota (igual que `splitInstallments` en el frontend).
