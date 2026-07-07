---
author: Tommy CardeLo
pubDatetime: 2026-06-29T10:00:00Z
title: "Velora — Una suite de calculadoras de supply chain con una capa de IA que protege la privacidad"
featured: true
draft: false
tags:
  - nextjs
  - typescript
  - supabase
  - openai
  - stripe
  - vercel
lang: es
description: "Arquitectura detrás de una suite bilingüe de calculadoras gratuitas de supply chain donde una capa de IA explica cada resultado como lo haría un consultor, sin ver nunca los datos crudos del usuario."
---

> Una suite bilingüe de calculadoras gratuitas de supply chain — safety stock, EOQ, punto de reorden, ABC/XYZ, pronóstico de demanda — donde una capa de IA explica cada resultado en lenguaje claro, sin ver nunca los números crudos del usuario.

En vivo en: [velora.tommycardelo.com](https://velora.tommycardelo.com)

---

## El problema

Los planeadores de demanda necesitan respuestas rápidas: cuánto safety stock mantener, cuándo reordenar, qué SKU merecen atención. Existen calculadoras para esto dispersas por internet, pero son estáticas: ingresas números, obtienes un número de vuelta, sin ninguna interpretación de qué significa o qué hacer al respecto.

La apuesta de Velora es que el cálculo en sí es un commodity; el diferenciador es una **capa de IA que lee el resultado y lo explica como lo haría un consultor** ("tu safety stock está impulsado principalmente por la variabilidad del lead time, no por la demanda — negociar un lead time más corto ayudaría más que subir el nivel de servicio"). Gratis de usar, construido para captación por SEO (una palabra clave de cola larga por herramienta, una URL), con un tier pago para uso más intensivo.

## Qué hace

- **Seis herramientas independientes**, cada una con su propia página y metadata SEO: safety stock, EOQ, punto de reorden, análisis ABC, análisis XYZ, pronóstico de demanda.
- **El cálculo corre 100% en el cliente.** Cualquier CSV o número que ingrese el usuario nunca sale del navegador.
- Solo un **resumen agregado y anónimo** del resultado (parámetros redondeados + salida, sin nombres de SKU, sin series crudas) se envía a una ruta de API que le pide a un LLM que lo interprete.
- **Bilingüe desde el lanzamiento** (`/es`, `/en`), con diccionario propio — sin librería de i18n.
- **Autenticación con magic link** (Supabase) y un dashboard para análisis guardados; **Stripe** para checkout/webhook/portal del tier pro.

## Arquitectura

```
Navegador
  ├─ lib/calc/*  (safety-stock, eoq, reorder-point, abc, xyz, forecast)
  │    100% en el cliente — los datos del usuario nunca salen de la pestaña
  ▼
POST /api/explain  { tool, lang, payload-agregado }
  │
  ▼
anonymize()   — allowlist por herramienta, strings libres descartados, números redondeados
  │
  ▼
buildCacheKey()  — inputs por buckets + PROMPT_VERSION → SHA-256
  │
  ├─ HIT  (Supabase ai_cache)  → devuelve el texto cacheado, costo = 0
  │
  └─ MISS
       ├─ rate limit (Upstash, por IP/usuario)
       ├─ cuota diaria (Upstash, por tier: free/pro)
       ├─ presupuesto diario de llamadas pagas (Upstash, global)
       ├─ provider.complete()  → mock | openai-free | (openai-paid | anthropic, stubs)
       └─ setCached() + recordEvent()
```

## Decisiones de diseño clave

### 1. La privacidad es diseño de producto, no una nota al pie

La separación entre cálculo e IA es la arquitectura real, no un añadido posterior. `lib/anonymize.ts` mantiene una allowlist por herramienta con los *únicos* campos permitidos para llegar al endpoint de IA — cualquier cosa que no esté en la lista se descarta en silencio, y los números se redondean a pocas cifras significativas antes de enviarse:

```ts
export const ALLOWLIST: Record<string, Record<string, FieldSpec>> = {
  safety_stock: {
    avgDemand: { type: "number" },
    demandStdDev: { type: "number" },
    avgLeadTime: { type: "number" },
    serviceLevel: { type: "number" },
    dominantDriver: { type: "enum", values: ["demand", "leadTime", "balanced"] },
    // ...
  },
  // eoq, reorder_point, abc, xyz, demand_forecast — mismo patrón
};

export function anonymize(tool: string, payload: Record<string, unknown>): AIPayload {
  const allowed = ALLOWLIST[tool];
  if (!allowed) return {};
  const out: AIPayload = {};
  for (const [key, spec] of Object.entries(allowed)) {
    const value = payload[key];
    if (spec.type === "number" && typeof value === "number" && Number.isFinite(value)) {
      out[key] = roundSig(value);
    } else if (spec.type === "enum" && typeof value === "string" && spec.values.includes(value)) {
      out[key] = value;
    }
  }
  return out;
}
```

Ningún nombre de SKU, nombre de empresa o texto libre tiene camino hacia el prompt — la allowlist es la única puerta, y falla cerrada (un campo no reconocido se descarta, no se pasa).

### 2. Las claves de caché usan buckets a propósito

Una clave de caché sobre floats exactos casi nunca haría hit: dos usuarios con lead time de 4.9 y 5.1 días merecen la misma explicación cualitativa pero generarían claves distintas. `lib/ai/cache.ts` redondea cada campo a un bucket *antes* de hashear:

```ts
const BUCKET_SPEC: Record<string, Record<string, BucketRule>> = {
  safety_stock: {
    avgDemand: "sig2",
    avgLeadTime: "whole",
    serviceLevel: { decimals: 2 },
    dominantDriver: "keep",
  },
  // ...
};

export function buildCacheKey({ tool, lang, payload }): string {
  const bucketed = bucketPayload(tool, payload);
  const canonical = JSON.stringify(bucketed, Object.keys(bucketed).sort());
  return createHash("sha256")
    .update(`v${PROMPT_VERSION}|${tool}|${lang}|${canonical}`)
    .digest("hex");
}
```

La clave siempre incluye `tool`, `lang` y `PROMPT_VERSION`. Subir `PROMPT_VERSION` tras editar un prompt invalida la caché vieja automáticamente — sin invalidación manual, sin explicaciones obsoletas de un prompt que ya no existe.

### 3. Una interfaz de provider que cuesta un solo archivo extender

Toda llamada de IA pasa por una única interfaz `AIProvider`. `mock` (tests, costo cero) y `openai-free` están implementados; `openai-paid` y `anthropic` son stubs que se conectan a `router.ts` con un archivo nuevo y una línea — sin tocar ningún llamador. El orquestador en `lib/ai/index.ts` degrada con gracia en cada dependencia externa en vez de romper la herramienta:

```ts
export async function explain(request, opts): Promise<AIResult> {
  const payload = anonymize(request.tool, request.payload);
  const cacheKey = buildCacheKey({ tool: request.tool, lang: request.lang, payload });

  const hit = await getCached(cacheKey);
  if (hit) return { available: true, text: hit.response, provider: hit.provider, cached: true };

  const provider = pickProvider({ tier: opts.tier ?? "free" });
  if (!provider) return { available: false, text: "", reason: "no_provider", ... };

  if (!(await checkRateLimit(opts.identifier)).ok)
    return { available: false, reason: "rate_limited", ... };
  if (!(await checkRateLimit(opts.identifier, { scope: `quota:${tier}`, ... })).ok)
    return { available: false, reason: "quota_exceeded", ... };
  if (provider.name !== "mock" && (await isPaidBudgetExceeded()))
    return { available: false, reason: "budget_exceeded", ... };

  try {
    const text = await provider.complete(system, user);
    await setCached({ key: cacheKey, tool: request.tool, lang: request.lang, response: text, provider: provider.name });
    return { available: true, text, provider: provider.name, cached: false };
  } catch (error) {
    return { available: false, reason: "provider_error", ... };
  }
}
```

Si cualquier capa falla — sin API key configurada, rate limit alcanzado, presupuesto diario agotado, error del provider — la herramienta igual muestra el número y la gráfica calculados (el 80% real del valor) y simplemente omite la narración de IA, con un código de razón que la interfaz puede mostrar como un mensaje específico en vez de un error genérico.

### 4. Tres filtros entre una solicitud y una llamada paga a la API

Caché (gratis) → rate limit (por identificador) → cuota diaria (por tier, `AI_FREE_DAILY_QUOTA`/`AI_PRO_DAILY_QUOTA`, por defecto 20/500) → presupuesto diario global de llamadas pagas. Cada filtro antes de la llamada al provider es barato (una consulta a Redis); solo un miss de caché genuino que supera los tres límites llega a OpenAI. Los hits de caché se saltan el rate limit y la cuota por completo: ya están pagados.

### 5. i18n sin dependencias

El routing vive en `middleware.ts`: las rutas sin prefijo redirigen a `/{locale}/...` según una cookie, luego `Accept-Language`, luego un default fijo en `es`; `/api`, `/auth` y `/go` quedan excluidos del prefijo de locale porque no son páginas renderizadas. El diccionario mismo (`lib/i18n/dictionaries.ts`) es un simple `Record<Locale, ...>` co-localizado con los textos de cada herramienta — sin `next-intl`, sin formato ICU de mensajes, solo objetos y una función de búsqueda. El SEO obtiene `hreflang` para `es`/`en`/`x-default` e `inLanguage` en el JSON-LD, generado una vez por locale vía `generateStaticParams`.

### 6. Autenticación y pagos llegaron al final, a propósito

El orden de construcción fue cálculo → wrapper de IA → caché/rate-limit/presupuesto → el resto de herramientas → SEO → lead magnet → **luego** autenticación con magic link de Supabase y Stripe (checkout, webhook, portal de cliente, `/dashboard`, `/pricing`). Las herramientas gratuitas tenían que demostrar que podían atraer tráfico orgánico antes de escribir cualquier código de monetización: validar el ciclo de captación primero es más barato que construir un muro de pago al que nadie llega.

## Stack

Next.js 15.5 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · shadcn v4 sobre `@base-ui/react` (no Radix) · Recharts 3 · Zod 4 · Vitest 4 · Supabase (Postgres, Auth, PostgREST vía `fetch`, sin SDK) · Upstash Redis (REST, sin SDK) · OpenAI (`fetch`, sin SDK) · Stripe · Vercel
