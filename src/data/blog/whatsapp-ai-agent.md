---
author: Tommy CardeLo
pubDatetime: 2026-05-14T10:00:00Z
title: "Building a WhatsApp AI Agent — FastAPI, Evolution API, and a multi-model OpenAI pipeline"
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
lang: en
description: "Architecture and engineering decisions behind a WhatsApp group bot that uses GPT-4.1, Whisper, and a Redis message buffer to log gym workouts with personality."
---

> A WhatsApp group bot that records gym workouts, detects duplicates, transcribes voice notes, and replies with GPT-4.1 sarcasm — all running in a single Docker container.

---

## The problem

My friend group has a WhatsApp chat where we log gym sessions. Before this bot, someone was running an n8n workflow that received messages, parsed them, and inserted rows into a PostgreSQL table. It worked, but n8n's visual editor became a bottleneck as the logic grew — adding a guardrail, handling audio messages, or tweaking a system prompt meant wrestling with node configuration instead of writing code.

I rewrote the whole thing as a Python microservice: same domain, full control.

## What it does

The bot listens to a WhatsApp group via webhook. When someone posts a workout ("biceps 45 min"), it:

1. **Buffers rapid messages** — waits 7 seconds after the first message to collect bursts (people often send 2–3 short messages in a row).
2. **Transcribes audio** if the message is a voice note (Whisper-1).
3. **Analyzes images** if the message contains a photo (GPT-4o vision, returns structured JSON).
4. **Classifies intent** — is this a workout log, a summary request, or just noise?
5. **Generates an INSERT** via GPT-4.1 with the exact column schema in the system prompt.
6. **Validates the SQL** through a two-layer guardrail (regex + GPT-4o-mini).
7. **Runs the INSERT** with a pre-check for duplicates.
8. **Replies** to the group with a sarcastic success or duplicate message.

## Architecture

```
WhatsApp
    │
    ▼
Evolution API  (self-hosted Docker, exposes webhooks)
    │  POST /webhook
    ▼
FastAPI app
    ├─ dedup by message_id   → Redis SET NX (5 min TTL)
    ├─ BackgroundTask         → process_message()
    │     ├─ Whisper-1        (audio)
    │     ├─ GPT-4o vision    (image)
    │     ├─ Redis buffer     (7 s window)
    │     ├─ GPT-4.1          (intent classification)
    │     ├─ GPT-4.1          (SQL generation)
    │     ├─ regex + GPT-4o-mini (guardrail)
    │     ├─ psycopg2         (INSERT into Postgres)
    │     └─ GPT-4.1          (response formatter)
    │
    ├─ Redis 7          (buffer + dedup)
    └─ PostgreSQL 14    (workouts + chat memory)
```

## Key design decisions

### 1. One Uvicorn worker — non-negotiable

The message buffer works by pushing each incoming message onto a Redis list, then sleeping N seconds before processing. Only the task that holds the *last* message ID processes the whole buffer — every other task wakes up and exits early.

This invariant breaks with multiple workers: two messages could land in different workers, both wake up thinking they're the latest, and you get double processing or race conditions. One worker is the simplest correct solution for a single-group bot.

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

### 2. Python controls the flow — no agentic loops

The LLM is called as a stateless function, never as a decision-maker. Python dictates the pipeline:

```python
intent = await classify_intent(text)        # gpt-4.1, temperature=0
sql    = await generate_sql(text, intent)   # gpt-4.1, temperature=0
safe, reason = await guardrail_check(sql)   # regex → gpt-4o-mini
if safe:
    ok, msg = await insert_registro(sql)    # psycopg2
response = await format_reply(ok, msg)      # gpt-4.1, temperature=0.7
```

No `tool_use`, no `response_format`, no loops. The LLM returns plain text; Python interprets it. This makes the pipeline predictable, cheap to debug, and easy to test in isolation.

### 3. Multi-model routing by role

| Role | Model | Why |
|------|-------|-----|
| Intent classifier, SQL generator, response formatter | `gpt-4.1` | Best reasoning; `temperature=0` for determinism |
| Guardrail | `gpt-4o-mini` | A cheap second opinion on the generated SQL |
| Image analysis | `gpt-4o` | Multimodal vision |
| Audio transcription | `whisper-1` | Only available transcription model in the OpenAI API |

The cheap model as guardrail means most dangerous SQL is caught by a regex first (O(1), zero network latency), and the LLM only handles edge cases. The guardrail fails safe: any parse error counts as "blocked".

### 4. Redis buffer — handling message bursts

WhatsApp users send thoughts as sequential short messages. Without a buffer, each line fires a separate pipeline call. The fix:

```python
await buffer_push(group_id, entry)
await asyncio.sleep(settings.buffer_seconds)   # default: 7 s

if not await is_latest_message(group_id, msg_id, timestamp):
    return   # a newer message will process the full buffer

messages = await buffer_get(group_id)
text = "\n".join(m["text"] for m in messages if m.get("text"))
await buffer_delete(group_id)
```

The entire burst arrives as a single string to the pipeline.

### 5. Sync psycopg2 + asyncio.to_thread

psycopg2 is synchronous. Rather than adopting psycopg3 (async-native but more moving parts), all database calls are wrapped in `asyncio.to_thread()` — they run in a thread pool without blocking the event loop. For a single-group bot the thread-switching overhead is negligible.

```python
async def insert_registro(sql: str) -> tuple[bool, str]:
    def _execute() -> tuple[bool, str]:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                return True, ""
    return await asyncio.to_thread(_execute)
```

### 6. System prompts use `str.replace()`, not `.format()`

System prompts include JSON examples with literal `{}` braces. Using `.format()` raises `KeyError`. Using `str.replace("{current_datetime}", value)` is explicit, safe, and sidesteps the footgun entirely.

## Observability

Logs are structured JSON via `structlog`. Every request binds `group_id` and `session_id` as context vars so every downstream log line carries them automatically:

```json
{"level": "info", "event": "pipeline: response sent", "group_id": "120363XXX@g.us", "elapsed_ms": 1842.3}
```

`docker logs -f bot | jq` is all the tooling you need for a prototype.

`GET /metrics` exposes in-memory counters: messages by type, pipeline runs, insert success/duplicate/error, guardrail blocks, and average latency. Swap in `prometheus_client` when dashboards become necessary.

## Stack

Python 3.12 · FastAPI · Uvicorn · OpenAI SDK (`gpt-4.1`, `gpt-4o`, `gpt-4o-mini`, `whisper-1`) · Evolution API v2 · Redis 7 Alpine · PostgreSQL 14 · psycopg2 · structlog · pydantic-settings · Docker + Compose · Ruff · pytest + pytest-asyncio + respx + fakeredis
