---
author: Tommy CardeLo
pubDatetime: 2026-10-15T16:00:00Z
title: "Deepy 2.0 — Rebuilding a personal assistant around one Postgres, a WhatsApp core and a private dashboard"
featured: false
draft: false
tags:
  - python
  - fastapi
  - nextjs
  - postgresql
  - whatsapp
  - docker
  - personal
lang: en
description: "Why I threw away the Google Sheets pipeline behind my voice assistant and rebuilt Deepy as a WhatsApp + Postgres core with a single-user Next.js dashboard that shares the same database."
---

> Deepy 2.0 replaces a Sheets-and-markdown pipeline with a WhatsApp-driven core (FastAPI) and a single-user web dashboard (Next.js), both talking to the same Postgres through separate, least-privilege roles.

The repos are private, since the data is mine: tasks, money, habits.

---

## The problem

The first version of Deepy was a [local voice assistant](/posts/deepy-voice-assistant). The part that fed it was a chain of loosely coupled pieces: a WhatsApp note landed in a Google Sheet, a script on my PC polled the sheet every two hours, asked an LLM to classify each row, and rewrote a markdown file that the assistant read as context.

It worked, but it had three structural problems:

- **Text was the database.** "Pending", "reminder" and "done" were labels inside a markdown file. I couldn't ask "how much did I spend this month" or "which habit did I skip" without an LLM re-reading everything.
- **It lived on my PC.** Organizing notes depended on my machine being on and on a scheduled task running.
- **Nothing was structured, so nothing could have a UI.** There was no way to tick a task, edit an expense or see a streak.

So I stopped patching it and rebuilt around one idea: **one Postgres, with the structure in the schema, and two clients on top of it.**

## What it does

**The core (`deepy_core`)** receives my personal WhatsApp messages and turns them into rows:

- A router classifies each message into a module: tasks (with a deadline), follow-ups (no deadline), ideas, habits or finances. Receipt photos and voice notes (transcribed with Whisper) go through the same path.
- A per-module extractor produces structured data and inserts it.
- Questions ("how much did I spend on food this month?") go through a read-only SQL path.
- A set of scheduled jobs sends me email: a daily summary that includes my calendar, a weekly report, a spending-anomaly alert, pending-task reminders and a health check on the system itself.

**The dashboard (`deepy_web`)** is a single-user Next.js app with sections for tasks (a three-column board plus an Eisenhower view), finances (accounts, per-category budgets, credit card cycle), habits (streaks), workouts and a calendar. It is installable as a PWA, so it lives on my home screen.

## Architecture

```
WhatsApp ──► Evolution API ──► gym bot (fan-out) ──► deepy_core (FastAPI)
                                                          │
                       router (small model) ──► extractor (per module)
                                                          │
                                                          ▼
                                   ┌───────────── PostgreSQL ─────────────┐
                                   │ core · tareas · habitos · financiero │
                                   │ ideas · monitoreo · gymbros (RO)     │
                                   └──────────────────────────────────────┘
                                                          ▲
                              deepy_web (Next.js, no ORM, own role)

Host cron ──► /internal/* jobs ──► email with signed links
```

The gym bot, which has [its own post](/posts/whatsapp-ai-agent), still owns the Evolution webhook. WhatsApp only allows one webhook per instance, so it forwards my direct messages to Deepy and keeps the group chat for itself.

## Key design decisions

### 1. Replace text files with schemas

Each domain has its own Postgres schema (`tareas`, `habitos`, `financiero`, `ideas`) and migrations are numbered SQL files. A task is a row with a status, a deadline and a domain; an expense is a row with an amount, currency and account. Everything the dashboard shows is a plain query, and the LLM is no longer the database engine.

### 2. One database, two roles, different powers

The dashboard and the core share the data, but not the privileges. `deepy_web` is its own role with explicit `GRANT`s per table: it can edit tasks and expenses, but it has no access at all to the `core` schema (raw captures and traces). The workout panel reads the gym bot's tables through a read-only grant on exactly one table.

Sharing a database is the simplest way to avoid syncing two systems. Per-table grants are what make it safe: if the web app were compromised, it still couldn't read my raw message history.

### 3. No ORM on the web side

`deepy_web` uses `pg` with hand-written queries. With a handful of tables and a single user, an ORM mostly adds a second description of the schema that can drift from the real one. A `check:db` script runs against the real database and verifies that numeric columns come back as numbers and that the role can't read what it shouldn't.

### 4. The LLM extracts; code decides

As in the gym bot, the model is a function, not an agent. The router returns a module and an operation; Python validates the result against a Pydantic schema and does the write. Models are split by cost: a small, fast one for routing and for the guardrail, a larger one for extraction and for drafting answers.

When the router isn't sure, it asks. The original message is kept in Redis for five minutes, so my follow-up answer is merged with it instead of being treated as a new message.

### 5. Questions are answered with read-only SQL, behind a guardrail

For a question, the model writes a single `SELECT` against one view, chosen by the router. Then two layers check it: a regex blocks write verbs and dangerous functions, and a second model call confirms it only touches that module's view. The query runs with a read-only role, and any failure counts as "blocked".

### 6. Cron on the host, not a scheduler inside the app

The scheduled jobs are internal HTTP endpoints triggered by the host's crontab, which is versioned in the repo. It's less elegant than an in-process scheduler, but it's easy to read and to run by hand. A health check runs twice an hour: it compares what should have run against what did, and surfaces the result both as an email (deduplicated, so a persistent problem doesn't spam me) and as a banner in the dashboard.

### 7. Signed links instead of a login for email buttons

Reminder emails have a "Done" button. Each button is an HMAC-signed link with an expiry, generated in Python and verified in TypeScript. The page shows a confirmation first and only writes when I press the button, so a link scanner opening the URL can't mark things as done. The E2E test generates a token with the Python signer and feeds it to the TypeScript verifier, so the two sides can't silently drift apart.

## What I learned

- **Structure first, intelligence second.** Once the data had a schema, most "AI features" got smaller: the model parses a message once, and after that it's just queries.
- **Currencies don't mix.** My first USD account went into the same table as the COP ones and would have silently broken every sum. The fix wasn't converting; it was excluding that account from the aggregates and giving it its own card.
- **Recreating a view drops its grants.** A `DROP VIEW` + `CREATE VIEW` in a migration quietly removed permissions the read-only role needed.
- **Fail loudly.** Missing environment variables return a 503 instead of an open site, and an email without a valid signing secret says so instead of sending buttons that don't work.
- **E2E over unit tests.** The tests that mattered ran the real app against an embedded Postgres with every migration applied, and left a report behind.

## What's next

I explored turning this into a multi-user product and paused it; the personal version is the one I use every day. For now the goal is to keep it boring: fewer features, more reliability, and the health check as the first thing I look at.

## Stack

Python · FastAPI · Redis · PostgreSQL · Anthropic API · OpenAI Whisper · Next.js 15 · React 19 · TypeScript · Tailwind · `pg` (no ORM) · Docker + Compose · GitHub Actions · Playwright
