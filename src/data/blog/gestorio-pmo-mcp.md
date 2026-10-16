---
author: Tommy CardeLo
pubDatetime: 2026-10-15T13:00:00Z
title: "Gestorio — An in-house PMO with an MCP server so Claude Code can pick up tasks"
featured: false
draft: false
tags:
  - nextjs
  - typescript
  - postgresql
  - docker
  - claude-code
  - mcp
lang: en
description: "How I built the internal PMO of 2DATO — tasks, notes, client portal and weekly updates — and exposed it through an MCP server where AI agents can move tasks but can never publish to clients without a human-approved confirmation code."
---

> Gestorio is the internal PMO of [2DATO](https://www.2dato.co): projects, tasks, notes, weekly client updates and a client portal. An MCP server lets Claude Code read tasks and move them through their states, and any write that a client will see goes through a preview plus a confirmation code that the agent can never approve by itself.

---

## The problem

2DATO is the automation and AI-agents project I run with two friends. Three people, several client projects, and the usual mess: tasks in chat messages, decisions in meeting notes, and a weekly "how is it going?" that nobody wanted to write. Jira or Linear would have been overkill (no sprints, no Scrum, no hierarchy: all three of us are admins), and none of them know about our notes vault or can talk to an AI coding agent on our terms.

So I built a small PMO that fits how we work, and then gave it an MCP interface, because most of the code for those projects is written with Claude Code, and the agent should know what is pending without me pasting it into the prompt.

## What it does

- **Projects and a light kanban.** Tasks move through TODO, IN_PROGRESS, DONE or BLOCKED, with drag and drop, assignees, due dates and archiving of finished work (nothing is deleted, just hidden).
- **AI briefs.** A background job rewrites each task description into a structured brief that an agent can use as a spec.
- **Weekly updates.** Every Monday an AI drafts one update per project from the previous week's notes, tasks and milestones. One email arrives with Approve / Edit / Complement per project.
- **Milestones and a client portal.** A hand-managed Gantt (weekly blocks, no library, plain CSS grid) that clients see after logging in, together with a client-facing summary of each weekly update and a Friday email digest.
- **Notes sync.** The team's Obsidian vault is a separate git repo; a webhook turns new notes into tasks.
- **A WhatsApp bridge and a mascot.** A small FastAPI service lets any of us drop a task or an idea into the team group by text or voice note. And yes, there is a mascot that follows the cursor.

## Architecture

```
  Claude Code / claude.ai ──(MCP over HTTP, per-person token)──┐
                                                               ▼
 Browser (admins) ──► Next.js 15 (App Router) ──► Postgres (pg, SQL migrations)
 Browser (clients) ─► /estado portal (own session) ──┘            ▲
                                                                  │
 systemd timers + webhooks (Node scripts) ── Anthropic API ───────┤
   · weekly draft  · notes → tasks  · task briefs  · health check │
 WhatsApp group ─► small FastAPI bot ─► webhook ──────────────────┘
```

It all runs on a single VPS with Docker Compose (Postgres, the app, and a reverse proxy with automatic TLS). Postgres listens only on the loopback interface. CI deploys on every push to `main`: rsync, run migrations, rebuild.

## Key design decisions

### 1. No ORM, four tables to start

`pg` directly plus numbered `.sql` migrations. The schema started with `projects`, `tasks`, `weekly_updates` and `digests` and grew from there (milestones, clients, comments, drafts). With a schema this small, an ORM is one more thing to debug and nothing I would miss.

### 2. Two kinds of users, two separate auth worlds

Admins log in with Google against an exact allowlist, re-checked in the middleware on every request. Clients never touch that system: they have their own table, their own HMAC-signed session cookie and a scrypt password hash. A session carries a `session_version` that is compared against the database on each load, so revoking access or resetting a password kills sessions that are already open. A reviewer caught that one before it shipped: my first version only checked at login.

The client portal only does a `SELECT` of explicit columns. The internal `summary` and `blockers` of a weekly update never reach it; clients only see `client_summary`, which is written or approved by a human. I took the AI out of that path on purpose, because internal blockers tend to leak into whatever a model summarizes.

### 3. MCP: few tools, one cheap write, the rest gated

The server is a stateless `/api/mcp` route. It exposes eleven tools:

- **Read:** `listar_proyectos`, `listar_tareas`, `ver_tarea` (returns the AI brief), `ver_proyecto`, `buscar_notas`, `leer_nota`.
- **Low-risk write:** `cambiar_estado_tarea`. It refuses archived tasks, and the `completed_at` rule lives in a single SQL helper shared with the kanban API, so both paths agree.
- **Client-visible writes:** `crear_avance`, `editar_resumen_cliente`, `crear_hito`, `editar_hito`.

Moving a task is reversible and internal, so it is a plain call. Anything a client will read is different.

### 4. Two-step confirmation that the agent cannot fake

Each client-visible tool, called without `confirmar`, saves nothing. It returns a preview and a `codigo_confirmacion`. That code is an HMAC over exactly the data shown, including the "before" state for edits, signed with a key generated at process start:

```ts
const CLAVE_CONFIRMACION = randomBytes(32); // lives only in this process

const codigo = createHmac("sha256", CLAVE_CONFIRMACION)
  .update(JSON.stringify({ herramienta, datos }))
  .digest("hex");
if (confirmar === codigo) return null; // proceed to write
```

To save, the agent must call again with the same data and that code. Different data gives a different code, so the agent cannot show one thing and save another, and if the record changed between preview and confirmation the code no longer matches. Restarting the app invalidates every pending code. The server instructions tell the agent to show the preview verbatim and confirm only after the user explicitly approves in that moment. Honestly, this is a protocol, not a lock: a model could still call the tool twice in a row. The HMAC guarantees consistency, the instructions and the human in the loop provide the consent. I preferred that over inventing an approval channel outside the conversation.

### 5. Tokens in the path, because connectors have no headers

Claude Code sends a Bearer header. The custom connectors in claude.ai only accept a URL. So each person has their own token, accepted either as a header or as a path segment, compared with a SHA-256 plus `timingSafeEqual`. Per-person tokens are revocable one at a time, and the log records who changed which task. OAuth would be cleaner and is the next step if distributing tokens gets annoying.

### 6. The "develop tasks" workflow lives in the repo

Each repo declares its project in its own `CLAUDE.md` with a single line (`Proyecto Gestorio: #<id>`). The MCP server's instructions describe the loop:

1. Read the project id from the repo's `CLAUDE.md`.
2. `listar_tareas` filtered to TODO; for each, `ver_tarea` and use the brief as the spec.
3. Move it to IN_PROGRESS before starting.
4. Mark it DONE only after build and tests are green. If it cannot be finished, BLOCKED, with the reason explained to me.

So "develop the tasks" is the whole prompt. The server owns the workflow, the repo only says which project it is.

### 7. Notes without copying them

Notes are read straight from the mounted vault filesystem: no copy in Postgres. That brought a real security finding: a symlink pushed into the vault could make the reader follow it outside the vault, to the process environment and its secrets. The note reader now resolves real paths and refuses symlinks while walking folders. A related decision: the notes agent only creates tasks from new notes, never edits, so a rewritten note does not duplicate work.

### 8. AI scripts, isolated and loud

Every AI job (weekly drafts, notes to tasks, briefs, WhatsApp parsing) is a small Node script with no tools, structured JSON output, and no direct database write: the script parses and inserts. They started on a Claude Code subscription and moved to the API with prepaid credits, because sharing quota with my interactive sessions meant a job could fail silently the week I used Claude Code heavily. A health-check job now probes the AI every hour and emails when it breaks, and tells apart a missing key, no credits and an overloaded API.

### 9. The WhatsApp bridge

A small FastAPI service sits behind the team group. Messages must start with a fixed phrase to be processed; everything else is ignored silently. Voice notes are transcribed with Whisper, biased with a prompt toward the trigger phrases because it kept mangling the first words. The bot only answers commands; it never starts a conversation.

## What I learned

- Agent safety is mostly about classifying writes by who sees them. Internal and reversible: let it through. Client-facing: preview, hash, human.
- Anything that can fail silently will: a per-project try/catch once made errors look like "nothing to report". Every background job now reports its own failure.
- Tests are E2E only (Playwright against a real dev server and an embedded Postgres, MCP failure modes included), each run leaving a JSON artifact.
- Docker Compose does not restart a container when only the contents of a mounted file or an `env_file` changed. I ran into it more than once.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 · shadcn/ui · next-auth · PostgreSQL (`pg`, SQL migrations) · MCP SDK + zod · Anthropic API · FastAPI (WhatsApp bridge) · Docker Compose · systemd timers · GitHub Actions · Playwright
