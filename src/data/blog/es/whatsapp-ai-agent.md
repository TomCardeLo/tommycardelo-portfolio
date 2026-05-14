---
author: Tommy CardeLo
pubDatetime: 2026-05-14T10:00:00Z
title: "Construyendo un agente de WhatsApp con IA — FastAPI, Evolution API y un pipeline multi-modelo con OpenAI"
featured: false
draft: false
tags:
  - python
  - fastapi
  - openai
  - whatsapp
  - redis
  - postgresql
  - docker
lang: es
description: "Arquitectura y decisiones técnicas detrás de un bot para grupos de WhatsApp que usa GPT-4.1, Whisper y un buffer de mensajes en Redis para registrar entrenamientos con personalidad."
---

> Un bot de WhatsApp para un grupo de gym que registra entrenamientos, detecta duplicados, transcribe notas de voz y responde con sarcasmo de GPT-4.1 — todo corriendo en un solo contenedor Docker.

---

## El problema

Mi grupo de amigos tiene un chat de WhatsApp donde registramos sesiones de gym. Antes del bot, alguien corría un workflow de n8n que recibía los mensajes, los parseaba e insertaba filas en una tabla de PostgreSQL. Funcionaba, pero el editor visual de n8n se volvió un cuello de botella a medida que la lógica crecía: agregar un guardrail, manejar mensajes de audio o ajustar un system prompt requería pelear con la configuración de nodos en vez de escribir código.

Reescribí todo como microservicio en Python: mismo dominio, control total.

## Qué hace

El bot escucha un grupo de WhatsApp vía webhook. Cuando alguien manda un entrenamiento ("bíceps 45 min"), él:

1. **Agrupa mensajes rápidos** — espera 7 segundos después del primer mensaje para juntar ráfagas (la gente suele mandar 2 o 3 mensajes cortos seguidos).
2. **Transcribe audio** si el mensaje es una nota de voz (Whisper-1).
3. **Analiza imágenes** si el mensaje contiene una foto (GPT-4o vision, devuelve JSON estructurado).
4. **Clasifica la intención** — ¿es un registro de entrenamiento, una solicitud de resumen o simplemente ruido?
5. **Genera un INSERT** con GPT-4.1, incluyendo el esquema exacto de columnas en el system prompt.
6. **Valida el SQL** con un guardrail de dos capas (regex + GPT-4o-mini).
7. **Ejecuta el INSERT** con un pre-check para evitar duplicados.
8. **Responde** al grupo con un mensaje sarcástico de éxito o de duplicado.

## Arquitectura

```
WhatsApp
    │
    ▼
Evolution API  (Docker self-hosted, expone webhooks)
    │  POST /webhook
    ▼
FastAPI app
    ├─ dedup por message_id   → Redis SET NX (TTL 5 min)
    ├─ BackgroundTask          → process_message()
    │     ├─ Whisper-1         (audio)
    │     ├─ GPT-4o vision     (imagen)
    │     ├─ buffer en Redis   (ventana de 7 s)
    │     ├─ GPT-4.1           (clasificación de intención)
    │     ├─ GPT-4.1           (generación de SQL)
    │     ├─ regex + GPT-4o-mini (guardrail)
    │     ├─ psycopg2          (INSERT en Postgres)
    │     └─ GPT-4.1           (formateador de respuesta)
    │
    ├─ Redis 7          (buffer + dedup)
    └─ PostgreSQL 14    (entrenamientos + memoria de chat)
```

## Decisiones de diseño clave

### 1. Un solo worker de Uvicorn — no es opcional

El buffer funciona así: cada mensaje entrante se agrega a una lista de Redis y la tarea duerme N segundos antes de procesar. Solo la tarea que tiene el *último* message ID procesa todo el buffer; el resto despierta y sale sin hacer nada.

Este invariante se rompe con múltiples workers: dos mensajes podrían caer en workers distintos, ambos despertar creyendo que son el más reciente, y terminar con doble procesamiento o race conditions. Un solo worker es la solución correcta más simple para un bot de un solo grupo.

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

### 2. Python controla el flujo — sin loops agénticos

El LLM se llama como una función sin estado, nunca como tomador de decisiones. Python dicta el pipeline:

```python
intent = await classify_intent(text)        # gpt-4.1, temperature=0
sql    = await generate_sql(text, intent)   # gpt-4.1, temperature=0
safe, reason = await guardrail_check(sql)   # regex → gpt-4o-mini
if safe:
    ok, msg = await insert_registro(sql)    # psycopg2
response = await format_reply(ok, msg)      # gpt-4.1, temperature=0.7
```

Sin `tool_use`, sin `response_format`, sin loops. El LLM devuelve texto plano; Python lo interpreta. Esto hace al pipeline predecible, barato de depurar y fácil de testear por partes.

### 3. Routing multi-modelo por rol

| Rol | Modelo | Por qué |
|-----|--------|---------|
| Clasificador de intención, generador de SQL, formateador de respuesta | `gpt-4.1` | Mejor razonamiento; `temperature=0` para determinismo |
| Guardrail | `gpt-4o-mini` | Una segunda opinión barata sobre el SQL generado |
| Análisis de imagen | `gpt-4o` | Visión multimodal |
| Transcripción de audio | `whisper-1` | Única opción de transcripción disponible en la API de OpenAI |

Usar un modelo barato como guardrail significa que la mayoría de los SQL peligrosos los detiene primero una regex (O(1), sin latencia de red), y el LLM solo entra en los edge cases. El guardrail falla de forma segura: cualquier error de parseo cuenta como "bloqueado".

### 4. Buffer en Redis — manejo de ráfagas de mensajes

Los usuarios de WhatsApp mandan pensamientos como mensajes cortos y consecutivos. Sin buffer, cada línea dispara una llamada separada al pipeline. La solución:

```python
await buffer_push(group_id, entry)
await asyncio.sleep(settings.buffer_seconds)   # default: 7 s

if not await is_latest_message(group_id, msg_id, timestamp):
    return   # un mensaje más nuevo procesará todo el buffer

messages = await buffer_get(group_id)
text = "\n".join(m["text"] for m in messages if m.get("text"))
await buffer_delete(group_id)
```

Toda la ráfaga llega como un único string al pipeline.

### 5. psycopg2 síncrono + asyncio.to_thread

psycopg2 es síncrono. En lugar de agregar psycopg3 (async nativo, pero con más partes móviles), todas las llamadas a la base de datos se envuelven en `asyncio.to_thread()` — corren en un pool de threads sin bloquear el event loop. Para un bot de un solo grupo, el overhead del cambio de contexto entre threads es insignificante.

```python
async def insert_registro(sql: str) -> tuple[bool, str]:
    def _execute() -> tuple[bool, str]:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                return True, ""
    return await asyncio.to_thread(_execute)
```

### 6. System prompts con `str.replace()`, no con `.format()`

Los system prompts incluyen ejemplos JSON con llaves `{}` literales. Usar `.format()` sobre ellos lanza `KeyError`. Usar `str.replace("{current_datetime}", value)` es explícito, seguro y evita ese error por completo.

## Observabilidad

Los logs son JSON estructurado con `structlog`. Cada request vincula `group_id` y `session_id` como context vars, así cada línea de log subsiguiente los lleva automáticamente:

```json
{"level": "info", "event": "pipeline: response sent", "group_id": "120363XXX@g.us", "elapsed_ms": 1842.3}
```

`docker logs -f bot | jq` es todo el tooling que necesitas para un prototipo.

`GET /metrics` expone contadores en memoria: mensajes por tipo, pipeline runs, insert éxito/duplicado/error, bloqueos del guardrail y latencia promedio. Reemplazar con `prometheus_client` cuando se necesiten dashboards.

## Stack

Python 3.12 · FastAPI · Uvicorn · OpenAI SDK (`gpt-4.1`, `gpt-4o`, `gpt-4o-mini`, `whisper-1`) · Evolution API v2 · Redis 7 Alpine · PostgreSQL 14 · psycopg2 · structlog · pydantic-settings · Docker + Compose · Ruff · pytest + pytest-asyncio + respx + fakeredis
