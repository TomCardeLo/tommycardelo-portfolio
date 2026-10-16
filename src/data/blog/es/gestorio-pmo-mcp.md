---
author: Tommy CardeLo
pubDatetime: 2026-10-15T13:00:00Z
title: "Gestorio — Un PMO propio con servidor MCP para que Claude Code tome tareas"
featured: false
draft: false
tags:
  - nextjs
  - typescript
  - postgresql
  - docker
  - claude-code
  - mcp
lang: es
description: "Cómo construí el PMO interno de 2DATO (tareas, notas, portal de clientes y avances semanales) y lo expuse por MCP: los agentes de IA pueden mover tareas, pero nunca publicar para el cliente sin un código de confirmación aprobado por una persona."
---

> Gestorio es el PMO interno de [2DATO](https://www.2dato.co): proyectos, tareas, notas, avances semanales para clientes y un portal. Un servidor MCP permite que Claude Code lea tareas y las mueva entre estados, y toda escritura que verá un cliente pasa por una vista previa y un código de confirmación que el agente nunca puede aprobar por su cuenta.

---

## El problema

2DATO es el proyecto de automatización y agentes de IA que llevo con dos amigos. Somos tres, con varios proyectos de clientes y el desorden de siempre: tareas perdidas en mensajes de chat, decisiones en notas de reuniones y un "¿cómo va?" semanal que a nadie le gustaba escribir. Jira o Linear eran demasiado (sin sprints, sin Scrum, sin jerarquías: los tres somos admins), y ninguno conoce nuestro vault de notas ni habla con un agente de código en nuestros términos.

Así que armé un PMO pequeño a la medida y luego le di una interfaz MCP, porque casi todo el código de esos proyectos lo escribo con Claude Code, y el agente debería saber qué hay pendiente sin que yo lo pegue en el prompt.

## Qué hace

- **Proyectos y un kanban ligero.** Las tareas pasan por TODO, IN_PROGRESS, DONE o BLOCKED, con drag and drop, responsables, fechas y archivado de lo terminado (no se borra nada, solo se oculta).
- **Briefs para IA.** Un job en segundo plano reescribe la descripción de cada tarea como un brief estructurado que un agente puede usar como especificación.
- **Avances semanales.** Cada lunes una IA redacta un borrador por proyecto a partir de las notas, tareas e hitos de la semana anterior. Llega un solo correo con Aprobar / Editar / Complementar por proyecto.
- **Hitos y portal de clientes.** Un Gantt manual (bloques semanales, sin librería, solo CSS grid) que los clientes ven tras iniciar sesión, con un resumen pensado para ellos por cada avance y un correo resumen los viernes.
- **Sincronización de notas.** El vault de Obsidian del equipo es un repo git aparte; un webhook convierte las notas nuevas en tareas.
- **Un puente de WhatsApp y una mascota.** Un pequeño servicio FastAPI permite que cualquiera del equipo deje una tarea o una idea en el grupo, por texto o nota de voz. Y sí, hay una mascota que sigue el cursor.

## Arquitectura

```
  Claude Code / claude.ai ──(MCP sobre HTTP, token por persona)──┐
                                                                 ▼
 Navegador (admins) ──► Next.js 15 (App Router) ──► Postgres (pg, migraciones SQL)
 Navegador (clientes) ─► portal /estado (sesión propia) ──┘          ▲
                                                                     │
 timers de systemd + webhooks (scripts Node) ── API de Anthropic ────┤
   · borrador semanal  · notas → tareas  · briefs  · chequeo de salud│
 Grupo de WhatsApp ─► bot FastAPI ─► webhook ────────────────────────┘
```

Todo corre en una sola VPS con Docker Compose (Postgres, la app y un proxy inverso con TLS automático). Postgres escucha solo en la interfaz local. El CI despliega en cada push a `main`: rsync, migraciones y rebuild.

## Decisiones de diseño

### 1. Sin ORM, cuatro tablas al inicio

`pg` directo y migraciones `.sql` numeradas. El esquema nació con `projects`, `tasks`, `weekly_updates` y `digests`, y creció después (hitos, clientes, comentarios, borradores). Con un esquema tan pequeño, un ORM es una cosa más que depurar y nada que vaya a extrañar.

### 2. Dos tipos de usuario, dos mundos de autenticación

Los admins entran con Google contra una lista exacta de correos, revalidada en el middleware en cada request. Los clientes nunca tocan ese sistema: tienen su propia tabla, su cookie de sesión firmada con HMAC y un hash de contraseña con scrypt. La sesión lleva un `session_version` que se compara con la base de datos en cada carga, así que revocar un acceso o resetear una contraseña mata las sesiones que ya estaban abiertas. Una revisión de seguridad lo detectó antes de salir: mi primera versión solo comprobaba al iniciar sesión.

El portal solo hace `SELECT` de columnas explícitas. El `summary` y los `blockers` internos de un avance nunca llegan ahí; el cliente solo ve `client_summary`, escrito o aprobado por una persona. Saqué la IA de ese camino a propósito, porque los bloqueos internos tienden a colarse en lo que resume un modelo.

### 3. MCP: pocas herramientas, una escritura barata y el resto con compuerta

El servidor es una ruta `/api/mcp` sin estado. Expone once herramientas:

- **Lectura:** `listar_proyectos`, `listar_tareas`, `ver_tarea` (devuelve el brief de IA), `ver_proyecto`, `buscar_notas`, `leer_nota`.
- **Escritura de bajo riesgo:** `cambiar_estado_tarea`. Rechaza tareas archivadas, y la regla de `completed_at` vive en un único helper SQL compartido con la API del kanban, así que ambos caminos coinciden.
- **Escrituras visibles para el cliente:** `crear_avance`, `editar_resumen_cliente`, `crear_hito`, `editar_hito`.

Mover una tarea es reversible e interno, así que es una llamada normal. Lo que lee un cliente es distinto.

### 4. Confirmación en dos pasos que el agente no puede falsificar

Cada herramienta visible para el cliente, llamada sin `confirmar`, no guarda nada. Devuelve una vista previa y un `codigo_confirmacion`. Ese código es un HMAC de exactamente los datos mostrados (incluido el estado "antes" en las ediciones), firmado con una clave generada al arrancar el proceso:

```ts
const CLAVE_CONFIRMACION = randomBytes(32); // vive solo en este proceso

const codigo = createHmac("sha256", CLAVE_CONFIRMACION)
  .update(JSON.stringify({ herramienta, datos }))
  .digest("hex");
if (confirmar === codigo) return null; // se puede escribir
```

Para guardar, el agente debe llamar de nuevo con los mismos datos y ese código. Datos distintos dan un código distinto: no puede mostrar una cosa y guardar otra, y si el registro cambió entre la vista previa y la confirmación, el código deja de coincidir. Reiniciar la app invalida todos los códigos pendientes. Las instrucciones del servidor le piden al agente mostrar la vista previa tal cual y confirmar solo si el usuario la aprueba de forma explícita en ese momento. Siendo honesto, esto es un protocolo, no un candado: un modelo podría llamar dos veces seguidas. El HMAC garantiza la consistencia; el consentimiento lo ponen las instrucciones y la persona en el bucle. Lo preferí a inventar un canal de aprobación fuera de la conversación.

### 5. El token en la ruta, porque los conectores no tienen encabezados

Claude Code envía un encabezado Bearer. Los conectores personalizados de claude.ai solo aceptan una URL. Por eso cada persona tiene su propio token, aceptado como encabezado o como segmento de la ruta, comparado con SHA-256 y `timingSafeEqual`. Los tokens por persona se revocan por separado y el log registra quién cambió qué tarea. OAuth sería más limpio y es el siguiente paso si repartir tokens se vuelve molesto.

### 6. El flujo "desarrolla tareas" vive en el repo

Cada repo declara su proyecto en su propio `CLAUDE.md` con una sola línea (`Proyecto Gestorio: #<id>`). Las instrucciones del servidor MCP describen el ciclo:

1. Leer el id del proyecto en el `CLAUDE.md` del repo.
2. `listar_tareas` filtrando por TODO; por cada una, `ver_tarea` y usar el brief como especificación.
3. Pasarla a IN_PROGRESS antes de empezar.
4. Marcarla DONE solo con build y pruebas en verde. Si no se puede terminar, BLOCKED y explicarme el motivo.

Así, "desarrolla las tareas" es todo el prompt. El servidor se encarga del flujo; el repo solo dice de qué proyecto es.

### 7. Notas sin copiarlas

Las notas se leen directo del sistema de archivos del vault montado, sin copia en Postgres. Eso trajo un hallazgo de seguridad real: un symlink subido al vault podía hacer que el lector lo siguiera fuera del vault, hasta el entorno del proceso y sus secretos. El lector ahora resuelve rutas reales y rechaza symlinks al recorrer carpetas. Una decisión relacionada: el agente de notas solo crea tareas a partir de notas nuevas, nunca de ediciones, para que reescribir una nota no duplique trabajo.

### 8. Scripts de IA aislados y ruidosos

Cada job de IA (borradores semanales, notas a tareas, briefs, WhatsApp) es un script Node pequeño, sin herramientas, con salida JSON estructurada y sin escritura directa a la base de datos: el script parsea e inserta. Empezaron con una suscripción de Claude Code y pasaron a la API con créditos prepagados, porque compartir cuota con mis sesiones interactivas significaba que un job podía fallar en silencio la semana que más usaba Claude Code. Ahora un job de salud prueba la IA cada hora y avisa por correo si falla, distinguiendo clave faltante, sin créditos y API saturada.

### 9. El puente de WhatsApp

Un pequeño servicio FastAPI escucha el grupo del equipo. El mensaje debe empezar con una frase fija para procesarse; todo lo demás se ignora en silencio. Las notas de voz se transcriben con Whisper, sesgado con un prompt hacia las frases de activación porque distorsionaba las primeras palabras. El bot solo responde a comandos; nunca inicia una conversación.

## Qué aprendí

- La seguridad con agentes consiste, sobre todo, en clasificar las escrituras según quién las ve. Interno y reversible: déjalo pasar. De cara al cliente: vista previa, hash y una persona.
- Lo que puede fallar en silencio, falla en silencio: un try/catch por proyecto llegó a hacer que los errores parecieran "nada que reportar". Hoy cada job reporta su propio fallo.
- Las pruebas son solo E2E (Playwright contra un servidor de desarrollo real y un Postgres embebido, con los modos de fallo del MCP incluidos), y cada corrida deja un artefacto JSON.
- Docker Compose no reinicia un contenedor cuando solo cambió el contenido de un archivo montado o de un `env_file`. Me topé con eso más de una vez.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 · shadcn/ui · next-auth · PostgreSQL (`pg`, migraciones SQL) · SDK de MCP + zod · API de Anthropic · FastAPI (puente de WhatsApp) · Docker Compose · timers de systemd · GitHub Actions · Playwright
