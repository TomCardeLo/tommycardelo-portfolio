---
author: Tommy CardeLo
pubDatetime: 2026-06-29T10:00:00Z
title: "Velora — A supply-chain calculator suite with a privacy-first AI layer"
featured: true
draft: false
tags:
  - nextjs
  - typescript
  - supabase
  - openai
  - stripe
  - vercel
lang: en
description: "Architecture behind a bilingual suite of free supply-chain calculators where an AI layer explains every result like a consultant would — without ever seeing the user's raw data."
---

> A bilingual suite of free supply-chain calculators — safety stock, EOQ, reorder point, ABC/XYZ, demand forecasting — where an AI layer explains every result in plain language, without ever seeing the user's raw numbers.

Live at: [velora.tommycardelo.com](https://velora.tommycardelo.com)

---

## The problem

Demand planners need quick answers: how much safety stock, when to reorder, which SKUs deserve attention. Calculators for this exist scattered across the web, but they're static — punch in numbers, get a number back, no interpretation of what it means or what to do next.

Velora's bet is that the calculation itself is a commodity; the differentiator is an **AI layer that reads the result and explains it like a consultant would** ("your safety stock is driven mostly by lead-time variability, not demand — negotiating a tighter lead time would help more than raising the service level"). Free to use, built for SEO acquisition (one long-tail keyword per tool, one URL), with a paid tier for heavier usage.

## What it does

- **Six standalone tools**, each its own page and its own SEO metadata: safety stock, EOQ, reorder point, ABC analysis, XYZ analysis, demand forecasting.
- **Calculation runs 100% client-side.** Whatever CSV or numbers the user enters never leaves the browser.
- Only an **aggregated, anonymized summary** of the result (rounded parameters + output, no SKU names, no raw series) is sent to an API route that asks an LLM to interpret it.
- **Bilingual from launch** (`/es`, `/en`), with its own dictionary — no i18n library.
- **Magic-link auth** (Supabase) and a dashboard for saved analyses; **Stripe** checkout/webhook/portal for the pro tier.

## Architecture

```
Browser
  ├─ lib/calc/*  (safety-stock, eoq, reorder-point, abc, xyz, forecast)
  │    100% client-side — the user's data never leaves the tab
  ▼
POST /api/explain  { tool, lang, aggregated-payload }
  │
  ▼
anonymize()   — allowlist per tool, strings/free text dropped, numbers rounded
  │
  ▼
buildCacheKey()  — bucketed inputs + PROMPT_VERSION → SHA-256
  │
  ├─ HIT  (Supabase ai_cache)  → return cached text, cost = 0
  │
  └─ MISS
       ├─ rate limit (Upstash, per IP/user)
       ├─ daily quota (Upstash, per tier: free/pro)
       ├─ daily paid-call budget (Upstash, global)
       ├─ provider.complete()  → mock | openai-free | (openai-paid | anthropic, stubs)
       └─ setCached() + recordEvent()
```

## Key design decisions

### 1. Privacy is the product design, not a disclaimer

The split between calculation and AI is the actual architecture, not an afterthought. `lib/anonymize.ts` keeps a per-tool allowlist of the *only* fields that are permitted to reach the AI endpoint — anything not on the list is silently dropped, and numbers are rounded to a handful of significant digits before they're sent:

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
  // eoq, reorder_point, abc, xyz, demand_forecast — same pattern
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

No SKU name, no company name, no free text ever has a path to the prompt — the allowlist is the only gate, and it fails closed (an unrecognized field is dropped, not passed through).

### 2. Cache keys are bucketed on purpose

A raw cache key on exact floats would almost never hit — two users with lead times of 4.9 and 5.1 days deserve the same qualitative explanation but would generate different keys. `lib/ai/cache.ts` rounds each field to a bucket *before* hashing:

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

The key always includes `tool`, `lang`, and `PROMPT_VERSION`. Bumping `PROMPT_VERSION` after a prompt edit invalidates the old cache automatically — no manual cache-busting, no stale explanations from a prompt that no longer exists.

### 3. A provider interface that costs one file to extend

Every AI call goes through a single `AIProvider` interface. `mock` (tests, zero cost) and `openai-free` are implemented; `openai-paid` and `anthropic` are stubs that plug into `router.ts` with a new file and one line — no changes to any caller. The orchestrator in `lib/ai/index.ts` degrades gracefully at every external dependency instead of ever breaking the tool:

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

If any layer fails — no API key configured, rate limit hit, daily budget exhausted, provider errors out — the tool still shows the calculated number and chart (the actual 80% of the value) and just skips the AI narration, with a reason code the UI can render as a specific message instead of a generic error.

### 4. Three gates between a request and a paid API call

Cache (free) → rate limit (per identifier) → daily quota (per tier, `AI_FREE_DAILY_QUOTA`/`AI_PRO_DAILY_QUOTA`, defaults 20/500) → global daily paid-call budget. Every gate before the provider call is cheap (a Redis lookup); only a genuine cache miss that clears all three limits reaches OpenAI. Cache hits skip rate limiting and quota entirely — they're already paid for.

### 5. i18n without a dependency

Routing lives in `middleware.ts`: unprefixed paths redirect to `/{locale}/...` based on a cookie, then `Accept-Language`, then a hardcoded `es` default; `/api`, `/auth`, and `/go` are excluded from locale prefixing since they aren't rendered pages. The dictionary itself (`lib/i18n/dictionaries.ts`) is a plain `Record<Locale, ...>` co-located with each tool's copy — no `next-intl`, no ICU message format, just objects and a lookup function. SEO gets `hreflang` for `es`/`en`/`x-default` and `inLanguage` in the JSON-LD, generated once per locale via `generateStaticParams`.

### 6. Auth and payments arrived last, on purpose

The build order was calculation → AI wrapper → cache/rate-limit/budget → the remaining tools → SEO → lead magnet → **then** Supabase magic-link auth and Stripe (checkout, webhook, customer portal, `/dashboard`, `/pricing`). Free tools had to prove they could pull organic traffic before any code for monetization was written — validating the acquisition loop first is cheaper than building a paywall nobody reaches.

## Stack

Next.js 15.5 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · shadcn v4 on `@base-ui/react` (not Radix) · Recharts 3 · Zod 4 · Vitest 4 · Supabase (Postgres, Auth, PostgREST via `fetch`, no SDK) · Upstash Redis (REST, no SDK) · OpenAI (`fetch`, no SDK) · Stripe · Vercel
