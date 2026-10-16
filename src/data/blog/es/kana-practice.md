---
author: Tommy CardeLo
pubDatetime: 2026-10-15T14:00:00Z
title: "Kana Practice — Aprender a leer hiragana adaptando el español a sonidos japoneses"
featured: false
draft: false
tags:
  - javascript
  - playwright
  - vercel
  - japanese
  - personal
lang: es
description: "Una web estática donde las palabras en español se convierten en kana por su sonido, las transcribes de vuelta a romaji y una alineación por distancia de edición corrige cada kana, sin framework ni paso de build."
---

> Una web estática para practicar la lectura de hiragana y katakana: convierte palabras al azar (o un texto propio) en español a kana según su sonido, tú las transcribes de vuelta a romaji y la app las corrige kana por kana. HTML, CSS y módulos ES planos, sin paso de build.

Repo: [github.com/TomCardeLo/kana-practice](https://github.com/TomCardeLo/kana-practice) · En vivo: [kana-practice-green.vercel.app](https://kana-practice-green.vercel.app)

---

## El problema

Estoy aprendiendo japonés, todavía en nivel básico, y lo que más me frena es leer kana con fluidez. Las tarjetas de caracteres sueltos llegan hasta cierto punto. Yo quería *palabras*: algo que pueda deletrear en voz alta, con retroalimentación inmediata sobre qué sílaba exacta fallé.

El problema es el material. No tengo un corpus de palabras japonesas graduado a mi nivel, pero sí tengo un suministro infinito de español. El español y el japonés comparten cinco vocales limpias y sílabas mayormente de consonante + vocal, así que una palabra en español se puede *adaptar* a la fonética japonesa: `casa` pasa a ser かさ y `luna` a るな. No significa nada en japonés. Es un ejercicio de lectura, no una traducción, y la app lo deja claro.

## Qué hace

- **Dos modos.** Una ronda de 5 palabras al azar en español, o cualquier texto que escribas o pegues.
- **Hiragana o katakana**, con un filtro opcional para practicar solo ciertas filas (por ejemplo あ/か/さ mientras aprendes las primeras).
- **Ocultas el español, lees el kana y escribes el romaji.** La app marca cada kana en verde o rojo, y puedes revelar la solución, que no cuenta en las estadísticas.
- **Variantes aceptadas.** shi/si, tsu/tu, fu/hu, ji/zi, `n`/`nn` y similares no se penalizan, porque cada persona romaniza distinto.
- **Estadísticas por kana** en `localStorage`, ordenadas por tasa de error, para ver qué sílabas me cuestan más.
- **Una página de tarjetas** para kana sueltos: 3 vidas por ronda, tiempo por tarjeta y récords personales por configuración.

## Arquitectura

```
Texto en español / palabra al azar
        │
        ▼
translit.js   normaliza → reescribe la ortografía → separa en sílabas romaji
        │
        ▼
kana.js       sílabas → hiragana / katakana (wanakana + metadatos de fila)
        │
        ▼
el usuario escribe romaji
        │
        ▼
check.js      romaji → kana → tokeniza → alinea (distancia de edición) → veredicto por kana
        │
        ▼
stats.js      aciertos/errores por kana en localStorage
```

Siete módulos pequeños y ningún framework. `app.js` es el pegamento de la interfaz; `cards.js` maneja la página de tarjetas y reutiliza el mismo mazo, corrector y código de estadísticas.

## Decisiones de diseño clave

### 1. Del español al kana con una cadena de reescrituras, no una tabla

La conversión vive en `translit.js` y tiene tres etapas. Primero, la normalización: minúsculas y sin tildes, pero protegiendo `ñ` y `ü` para que sobrevivan. Segundo, una lista ordenada de reescrituras ortográficas donde el orden lo es todo: los dígrafos van antes que las letras sueltas.

```js
const REWRITES = [
  [/qu/g, 'k'],
  [/gu([ei])/g, 'G$1'],   // g dura, u muda
  [/ch/g, 'C'],
  [/ll/g, 'y'],
  [/rr/g, 'r'],
  [/l/g, 'r'],
  [/g([ei])/g, 'j$1'],    // g suave: suena como la "j" española
  [/c([ei])/g, 's$1'],
  [/c/g, 'k'],
  [/h/g, ''],             // muda
  // ...
];
```

`G` es un marcador temporal para que la `g` dura de `guitarra` no se confunda, en una regla posterior, con la `g` suave de `gente`. Tercero, un parser pequeño recorre el resultado y emite sílabas, con una tabla para las combinaciones irregulares (`ti` → `chi`, `tu` → `tsu`, `si` → `shi`).

Los grupos consonánticos son el caso interesante, porque el japonés no los puede pronunciar. A una consonante sin vocal detrás, sea en un grupo o al final de la palabra, se le inserta una: `u` por defecto, pero `o` después de `t`/`d`, que es como suelen funcionar los préstamos. `tres` queda `to-re-su` → とれす. Una `n` suelta se convierte en ん.

Antes de escribir nada, enumeré en un archivo las formas en que podía fallar y solo después escribí el código (`tests/e2e/failure-modes.md`, unas 40 entradas): dígrafos aplicados letra por letra, `gue/gui` conservando la `u` muda, `n` antes de vocal confundida con ん, `ñ` perdida al quitar tildes, emojis y números que rompían la salida.

### 2. Corrección por alineación, no por posición

El corrector ingenuo compara el kana escrito con el esperado en el mismo índice. Tiene un defecto fatal: si omites o añades un solo kana, todo lo que sigue sale en rojo. Es una retroalimentación pésima para quien aprende.

`check.js` convierte el romaji escrito a hiragana con wanakana, lo divide en unidades (un kana más su ゃゅょ pequeño, si lo tiene) y alinea la secuencia esperada con la escrita mediante distancia de edición y backtrace. Un kana faltante o sobrante queda aislado y el resto de la palabra sigue alineado. Ante un empate de costos gana la sustitución sobre la inserción o el borrado, de modo que cada kana esperado se *empareja* con algo de lo escrito. Así puedo mostrar lo que realmente escribí junto a lo esperado, en vez de un simple «falta».

Convertir a kana *antes* de comparar es también lo que hace que las variantes salgan gratis. `shi` y `si` se vuelven し, así que no hay tabla de variantes que mantener. Unas pocas normalizaciones cubren lo demás: ぢ/づ se funden con じ/ず, y `nn` se reduce a ん solo cuando no sigue una sílaba que la reclame (`kanna` se queda en か-ん-な).

### 3. Convertir palabra por palabra

Un error pequeño que vale la pena contar: si conviertes la respuesta completa de una vez, una `n` final se fusiona con la vocal inicial de la palabra siguiente. `pan agua` termina como ぱなぐあ en lugar de ぱん + あぐあ. Por eso la respuesta se divide por espacios y cada palabra se convierte por separado.

### 4. Sin framework y sin paso de build

La app es un puñado de módulos ES servidos tal cual. La única dependencia, wanakana 5.3.1, está vendorizada en el repo en lugar de cargarse desde un CDN. Las razones: un CDN sería una dependencia en tiempo de ejecución y un punto de falla para una página que por lo demás no necesita nada; permite ajustar la Content Security Policy a mismo origen más Google Fonts; y «desplegar» es solo hacer push, porque Vercel sirve la carpeta. En local basta con `python3 -m http.server`.

El costo es real: sin bundle hay una cadena de peticiones de módulos. Lighthouse en móvil dio 100 en Accesibilidad, Buenas prácticas y SEO; el rendimiento fue 73 con throttling simulado y 98 con el throttling real de DevTools. Sospecho que la cadena de módulos sin empaquetar explica la diferencia. Para esta app me parece aceptable.

### 5. Seguro por construcción

El texto del usuario siempre llega al DOM mediante `textContent`, nunca `innerHTML`, y el acceso a `localStorage` va dentro de `try/catch`, de modo que en modo privado simplemente no se guarda el progreso. Una auditoría previa al lanzamiento llevó a añadir cabeceras de seguridad en `vercel.json`: una CSP estricta (`connect-src 'none'`, `object-src 'none'`, `frame-ancestors 'none'`), `X-Frame-Options`, `nosniff` y políticas de referrer y permisos.

### 6. Pruebas E2E como únicas pruebas

Sin pruebas unitarias. La suite es de Playwright y recorre las páginas reales: flujo de práctica, textos largos, filtros por fila, persistencia de estadísticas, tutorial, diseño en escritorio y móvil, metadatos de lanzamiento y el juego de tarjetas. Las pruebas de tarjetas usan el reloj falso de Playwright, así que los tiempos por tarjeta son exactos y sin esperas reales. La suite completa pasó 242/242 contra la URL de producción (con `BASE_URL`), y el reporte HTML es el artefacto. La revisión de código del juego de tarjetas además detectó dos errores reales antes del lanzamiento: una sección que seguía visible a pesar de `hidden` (el `display: flex` de un componente lo anulaba; se arregló con un `[hidden] { display: none !important; }` global) y una `n` sobrante que pasaba a la tarjeta siguiente.

## Un video promocional renderizado desde código

Para el lanzamiento también hice un promo de 31 segundos, en horizontal y vertical, renderizado a 4K/60 desde una composición HTML, con música y efectos sintetizados. El guion sigue una sola idea: una palabra muta. `casa` cae, se parte en ca | sa, la `c` gira y se vuelve una `k` verde, y cada sílaba se pliega en su kana. Después recorre los tres modos. Mi primer corte de 15 segundos fue rechazado, con razón: mostraba el flujo sin explicar qué *es* la app. La solución fue abrir con la idea de pasar del español al kana. El video vive fuera del repo, así que nada de eso se publica con la app.

## Lo que aprendí

- **La adaptación fonética es sobre todo orden de reglas.** Casi todos los problemas de `translit.js` se reducen a una regla que se dispara antes que la que debía anticiparse.
- **La alineación por distancia de edición supera a la comparación posicional** siempre que el usuario pueda omitir o añadir una unidad. Y no son muchas líneas de código.
- **Escribe primero la lista de fallos.** Hizo fácil escribir la suite E2E y sacó a la luz casos que se me habrían olvidado.
- **Límites conocidos.** La adaptación aproxima el sonido del japonés; no es japonés real. Y en las tarjetas con ambos silabarios, una `n` sobrante después de ん puede contestar el ン siguiente.

## Stack

HTML · CSS · JavaScript (módulos ES, sin build) · wanakana 5.3.1 (vendorizada) · Playwright E2E · Vercel
