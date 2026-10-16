---
author: Tommy CardeLo
pubDatetime: 2026-10-15T16:00:00Z
title: "Deepy 2.0 — Reconstruir un asistente personal alrededor de un solo Postgres, un núcleo de WhatsApp y un dashboard privado"
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
lang: es
description: "Por qué descarté el pipeline de Google Sheets detrás de mi asistente de voz y reconstruí Deepy como un núcleo WhatsApp + Postgres con un dashboard Next.js de un solo usuario que comparte la misma base de datos."
---

> Deepy 2.0 reemplaza un pipeline de Sheets y markdown por un núcleo guiado por WhatsApp (FastAPI) y un dashboard web de un solo usuario (Next.js), ambos sobre el mismo Postgres con roles distintos y de mínimo privilegio.

Los repositorios son privados, porque los datos son míos: tareas, dinero, hábitos.

---

## El problema

La primera versión de Deepy fue un [asistente de voz local](/es/posts/deepy-voice-assistant). Lo que lo alimentaba era una cadena de piezas poco acopladas: una nota de WhatsApp llegaba a una hoja de Google Sheets, un script en mi PC la consultaba cada dos horas, le pedía a un LLM que clasificara cada fila y reescribía un archivo markdown que el asistente leía como contexto.

Funcionaba, pero tenía tres problemas estructurales:

- **El texto era la base de datos.** "Pendiente", "recordatorio" y "hecho" eran etiquetas dentro de un markdown. No podía preguntar "cuánto gasté este mes" o "qué hábito se me pasó" sin que un LLM releyera todo.
- **Vivía en mi PC.** Organizar las notas dependía de que mi equipo estuviera encendido y de que corriera una tarea programada.
- **Sin estructura no había interfaz posible.** No había forma de marcar una tarea, editar un gasto o ver una racha.

Así que dejé de parchearlo y reconstruí alrededor de una idea: **un solo Postgres, con la estructura en el esquema, y dos clientes encima.**

## Qué hace

**El núcleo (`deepy_core`)** recibe mis mensajes personales de WhatsApp y los convierte en filas:

- Un router clasifica cada mensaje en un módulo: tareas (con fecha límite), seguimiento (sin fecha), ideas, hábitos o finanzas. Las fotos de recibos y las notas de voz (transcritas con Whisper) siguen el mismo camino.
- Un extractor por módulo produce datos estructurados y los inserta.
- Las preguntas ("¿cuánto gasté en comida este mes?") pasan por una ruta de SQL de solo lectura.
- Un conjunto de tareas programadas me envía correos: un resumen diario que incluye mi calendario, un reporte semanal, una alerta de gastos anómalos, recordatorios de pendientes y un chequeo de salud del propio sistema.

**El dashboard (`deepy_web`)** es una app Next.js de un solo usuario con secciones de tareas (tablero de tres columnas más una vista Eisenhower), finanzas (cuentas, presupuesto por categoría, ciclo de la tarjeta de crédito), hábitos (rachas), entrenamientos y calendario. Es instalable como PWA, así que vive en la pantalla de inicio de mi celular.

## Arquitectura

```
WhatsApp ──► Evolution API ──► bot del gym (fan-out) ──► deepy_core (FastAPI)
                                                              │
                         router (modelo pequeño) ──► extractor (por módulo)
                                                              │
                                                              ▼
                                   ┌───────────── PostgreSQL ─────────────┐
                                   │ core · tareas · habitos · financiero │
                                   │ ideas · monitoreo · gymbros (RO)     │
                                   └──────────────────────────────────────┘
                                                              ▲
                                deepy_web (Next.js, sin ORM, rol propio)

Cron del host ──► jobs /internal/* ──► correo con enlaces firmados
```

El bot del gym, que tiene [su propio post](/es/posts/whatsapp-ai-agent), sigue siendo dueño del webhook de Evolution. WhatsApp solo permite un webhook por instancia, así que ese bot reenvía mis mensajes directos a Deepy y se queda con el grupo.

## Decisiones de diseño clave

### 1. Reemplazar archivos de texto por esquemas

Cada dominio tiene su propio esquema de Postgres (`tareas`, `habitos`, `financiero`, `ideas`) y las migraciones son archivos SQL numerados. Una tarea es una fila con estado, fecha límite y dominio; un gasto es una fila con monto, moneda y cuenta. Todo lo que muestra el dashboard es una consulta simple, y el LLM ya no hace de motor de base de datos.

### 2. Una base de datos, dos roles, poderes distintos

El dashboard y el núcleo comparten los datos, pero no los privilegios. `deepy_web` es un rol propio con `GRANT` explícitos por tabla: puede editar tareas y gastos, pero no tiene ningún acceso al esquema `core` (capturas crudas y trazas). El panel de entrenamientos lee las tablas del bot del gym mediante un permiso de solo lectura sobre una única tabla.

Compartir la base es la forma más simple de no tener que sincronizar dos sistemas. Los permisos por tabla son lo que lo hace seguro: si la web se viera comprometida, igual no podría leer mi historial crudo de mensajes.

### 3. Sin ORM en el lado web

`deepy_web` usa `pg` con consultas escritas a mano. Con pocas tablas y un solo usuario, un ORM agrega sobre todo una segunda descripción del esquema que puede desincronizarse de la real. Un script `check:db` corre contra la base real y verifica que las columnas numéricas llegan como números y que el rol no puede leer lo que no debe.

### 4. El LLM extrae; el código decide

Igual que en el bot del gym, el modelo es una función, no un agente. El router devuelve un módulo y una operación; Python valida el resultado con un esquema de Pydantic y hace la escritura. Los modelos se reparten por costo: uno pequeño y rápido para el router y el guardrail, y uno más grande para extraer y redactar respuestas.

Cuando el router no está seguro, pregunta. El mensaje original se guarda en Redis cinco minutos, de modo que mi respuesta se combina con él en vez de tratarse como un mensaje nuevo.

### 5. Las preguntas se responden con SQL de solo lectura, tras un guardrail

Ante una pregunta, el modelo escribe un único `SELECT` sobre una sola vista, elegida por el router. Luego dos capas lo revisan: una regex bloquea verbos de escritura y funciones peligrosas, y una segunda llamada al modelo confirma que solo toca la vista de ese módulo. La consulta se ejecuta con un rol de solo lectura, y cualquier fallo cuenta como "bloqueado".

### 6. Cron en el host, no un scheduler dentro de la app

Las tareas programadas son endpoints HTTP internos que dispara el crontab del host, versionado en el repositorio. Es menos elegante que un scheduler dentro del proceso, pero es fácil de leer y de ejecutar a mano. Un chequeo de salud corre dos veces por hora: compara lo que debió ejecutarse con lo que se ejecutó, y muestra el resultado como correo (deduplicado, para que un problema persistente no me llene la bandeja) y como aviso en el dashboard.

### 7. Enlaces firmados en lugar de un login para los botones del correo

Los correos de recordatorio traen un botón "Cumplir". Cada botón es un enlace firmado con HMAC y con vencimiento, generado en Python y verificado en TypeScript. La página muestra primero una confirmación y solo escribe cuando se pulsa el botón, de modo que un escáner de enlaces que abra la URL no pueda marcar nada como hecho. El E2E genera un token con el firmador de Python y se lo pasa al verificador de TypeScript, así los dos lados no pueden desviarse sin que nadie se entere.

## Qué aprendí

- **Primero la estructura, después la inteligencia.** Cuando los datos tuvieron esquema, muchas "funciones de IA" se volvieron más pequeñas: el modelo interpreta un mensaje una vez y después todo son consultas.
- **Las monedas no se mezclan.** Mi primera cuenta en USD entró en la misma tabla que las de COP y habría roto todas las sumas sin avisar. La solución no fue convertir: fue excluir esa cuenta de los agregados y darle su propia tarjeta.
- **Recrear una vista elimina sus permisos.** Un `DROP VIEW` + `CREATE VIEW` en una migración quitó en silencio permisos que necesitaba el rol de solo lectura.
- **Fallar de forma visible.** Si faltan variables de entorno, la web responde 503 en vez de quedar abierta, y un correo sin un secreto de firma válido lo dice en vez de enviar botones que no funcionan.
- **E2E antes que pruebas unitarias.** Las pruebas que importaron ejecutaron la app real contra un Postgres embebido con todas las migraciones aplicadas, y dejaron un reporte.

## Qué sigue

Exploré convertir esto en un producto multiusuario y lo pausé; la versión personal es la que uso a diario. Por ahora la meta es mantenerlo aburrido: menos funciones, más confiabilidad, y el chequeo de salud como lo primero que reviso.

## Stack

Python · FastAPI · Redis · PostgreSQL · API de Anthropic · OpenAI Whisper · Next.js 15 · React 19 · TypeScript · Tailwind · `pg` (sin ORM) · Docker + Compose · GitHub Actions · Playwright
