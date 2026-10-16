---
author: Tommy CardeLo
pubDatetime: 2026-10-15T10:00:00Z
title: "motion-comercial — Videos de motion design comercial hechos con código, como skill de Claude Code"
featured: false
draft: false
tags:
  - claude-code
  - python
  - playwright
  - ffmpeg
  - windows
  - tts
  - personal
lang: es
description: "Una skill de Claude Code que convierte HTML, Playwright y ffmpeg en un estudio de motion design gratuito y local: escenas deterministas, desenfoque de movimiento real, voz en off local, sonido sintetizado y un verificador de calidad automático."
---

> Una skill de Claude Code que produce videos cortos de motion design comercial enteramente desde código en Windows: escenas HTML capturadas con Playwright, codificadas con ffmpeg, narradas con una voz local gratuita, con música sintetizada y revisadas por un verificador automático. Sin After Effects, sin Remotion, sin servicios de pago.

---

## El problema

El motion design para una marca suele significar After Effects, un proyecto de Remotion o un servicio de generación de video de pago. Yo quería algo distinto: videos promocionales cortos (lanzamientos, demos de producto, anuncios verticales, cifras animadas) que pudiera producir en mi propia máquina, volver a renderizar en otro idioma o formato cambiando una línea, y entregar a un cliente sin preocuparme por las licencias.

La otra mitad del problema es que un agente de IA puede escribir el código de la animación, pero no puede *mirar* el resultado como lo hace una persona. El video generado falla de maneras aburridas y repetibles: todo se mueve al mismo ritmo, un aviso se sale del cuadro, el texto no se lee en un teléfono, la música tapa la voz. Por eso el proyecto trata tanto de revisión automática como de render.

## Qué es una skill

Una skill de Claude Code es un conjunto empaquetado de instrucciones y scripts que el agente carga cuando los necesita. El archivo `SKILL.md` describe cuándo usarla y el protocolo a seguir; la carpeta que lo acompaña contiene las herramientas. Aquí, las instrucciones convierten al agente en un pequeño estudio (dirección creativa, guion, diseño, animación, sonido y render) y los scripts hacen el trabajo mecánico. Yo hago de cliente: en cada paso de aprobación el agente muestra su trabajo y se detiene.

## Qué hace

- **Escenas como código.** Cada película es una carpeta con un `comp.html`, un `score.json` (sonido) y un README. Incluye ocho tipos de partida: lanzamiento de producto, demo narrada, anuncio vertical, tipografía cinética, cifra animada, logo sting, antes/después y novedad de función.
- **Varios formatos e idiomas.** 16:9, 9:16, 1:1 y 4:5 desde la misma composición, escrita contra el ancho y alto del escenario en vez de recortar. Los textos viven por idioma, así que la versión en inglés es un parámetro de la URL.
- **Voz en off local y gratuita** con Kokoro, más tiempos por palabra con `faster-whisper` para subtítulos y un archivo SRT.
- **Música y efectos sintetizados**, mezclados en Python con la voz y normalizados a -14 LUFS.
- **Desenfoque de movimiento real**, renderizado en paralelo con varios procesos de navegador.
- **Un verificador** que lee el video terminado (y la composición) y marca fallos o avisos de ritmo, encuadre, legibilidad y audio.
- Código bajo licencia MIT, fuentes OFL, voz Apache-2.0 y sonido sintetizado original: nada que bloquee el trabajo con clientes.

## Arquitectura

```
comp.html  (HTML/CSS/JS, una función pura: render(t))
   │   carga lib/motion.js  (curvas, resortes, cámara, texto, transiciones)
   │         lib/stage.js   (el contrato: escenas, eventos, idiomas)
   ▼
render.py ── servidor HTTP local ── N workers de Playwright/Chromium
   │   seek(t) → captura, subfotogramas promediados en luz lineal
   ▼
draft.mp4 (sin audio)                      score.json + events.json
                                                │
vo.py  (TTS Kokoro + tiempos con whisper) ─────┤
audio.py (música sintetizada + SFX + ducking) ─┘
   ▼
mix.wav (-14 LUFS)  ──►  mux con ffmpeg  ──►  pelicula.mp4
                                                  │
                                    verify.py ◄───┘
                           report.json · hojas de contacto · textos.txt
```

## Decisiones de diseño clave

### 1. Cada fotograma es una función pura del tiempo

Una composición no anima: *responde una pregunta*, cómo se ve la pantalla en el instante `t`. No hay transiciones CSS, ni temporizadores, ni `Math.random` (se ofrece un generador con semilla) ni estado entre fotogramas. La recompensa es el determinismo: hacer `seek` al mismo `t` dos veces da el mismo fotograma, así que el renderizador puede saltar a cualquier punto, repartir la línea de tiempo entre workers y volver a renderizar solo los segundos 6 a 9 después de un arreglo. También vuelve trivial la vista previa: `?t=3.2` es una captura de cualquier momento.

### 2. El desenfoque de movimiento lo pone el renderizador, no el CSS

Un `blur()` de CSS es una falsificación que se ve como un filtro. El desenfoque real es integración en el tiempo: capturar varios subfotogramas dentro del intervalo del obturador y promediarlos. El renderizador lo hace en luz lineal y de forma adaptativa. Primero captura los dos extremos del obturador; si coinciden, el fotograma está quieto y cuesta una sola captura. Si no, el flujo óptico estima cuánto se mueve el elemento más rápido y toma solo las capturas necesarias para que las copias queden a pocos píxeles entre sí. Un desplazamiento lento usa pocas; un latigazo llega al tope. Así los borradores son rápidos sin sacrificar el render final.

### 3. Primero los modos de fallo, después el verificador

La cabecera de `verify.py` enumera cada forma en que un video generado sale mal antes de que exista el código: ritmo de metrónomo (planos de igual duración), película muerta (demasiados fotogramas quietos), gancho lento, saltos de un solo fotograma, elementos fuera del cuadro, "carries" perdidos (el objeto que debería sobrevivir a un cambio de escena), texto ilegible en un teléfono, bajo contraste, textos que se pisan, duración o códec incorrectos, recorte de audio, volumen fuera de objetivo, sonido que nunca respira y golpes sin energía detrás. Cada uno es un chequeo numerado que falla o avisa.

Valió la pena desde el primer día: el verificador encontró problemas reales en mi propia demo (ritmo de metrónomo, un aviso fuera del cuadro, ningún momento de calma, texto demasiado pequeño en teléfono) y en su propio diseño (el dígito cambiante de un contador no es un "salto", y la escena final en reposo no es una "película muerta"). Ambos se corrigieron. Reglas como "el plano más largo dura al menos 3 veces el más corto" parecen arbitrarias hasta que ves cuánto mejora el corte cuando una máquina las hace cumplir.

### 4. La continuidad se declara, no se espera

Cada escena declara un `carry`: el elemento que cruza a la siguiente escena y se transforma. El verificador comprueba que sea visible a ambos lados del límite. Un cambio de escena donde nada sobrevive es una diapositiva, y los cortes secos deben declararse de forma explícita. Es una restricción pequeña que empuja al agente hacia una película diseñada y no una secuencia de láminas.

### 5. Aprobación humana donde importa el gusto, automatización donde no

El protocolo hace que el agente se detenga para un brief, tres conceptos realmente distintos, un guion beat a beat, fotogramas de estilo, transiciones y una animática (un borrador a 720p, sin desenfoque y con todo el audio, que fija los tiempos). Lo aprobado queda fijo. Después, el render, la mezcla y la verificación corren sin pausa, y el agente aún debe revisar las hojas de contacto y calificar su propio gancho, legibilidad y sincronía. Hay algo que el verificador no puede comprobar: que cada nombre y cifra en pantalla sea correcto. Por eso vuelca todos los textos visibles en `textos.txt` para que una persona los compare con el brief.

### 6. La voz manda sobre el reloj

Con narración, el guion marca los tiempos: cada frase empieza en su propio `t` y, si no cabe antes de la siguiente, se acelera como máximo a 1.15x o la compilación falla y dice cuánto recortar. Un comando `check` estima las palabras por minuto antes de sintetizar nada, de modo que el guion se aprueba antes de generar audio. La música baja bajo la voz una cantidad objetivo de dB, que el mezclador imprime para poder ajustarla.

## Notas sobre Windows

Todo corre con `python` simple, el Chromium de Playwright y ffmpeg (con `imageio-ffmpeg` como respaldo). El renderizador levanta su propio servidor local y usa procesos tipo `spawn`, que es lo que Windows necesita para multiprocesamiento. La codificación de la consola (cp1252) es una trampa recurrente, así que los scripts reconfiguran stdout. Para comandos largos con código, la skill le indica al agente escribir un archivo `.py` y ejecutarlo, en lugar de pelear con las comillas del shell.

Medido con 8 navegadores, un borrador 1080p30 tarda aproximadamente 3.5 segundos de reloj por segundo de video; el final en 4K60 tarda cerca de siete veces eso. Esa proporción explica la regla: iterar sobre borradores y fotogramas fijos, y gastar el render final solo en un corte aprobado.

## Qué aprendí

- **El determinismo es la funcionalidad.** Cuando un fotograma es una función pura del tiempo, el render en paralelo, los re-renders parciales y el soporte multi-idioma y multi-formato llegan casi gratis.
- **Escribe el control de calidad antes que el generador.** Un verificador construido a partir de una lista de modos de fallo detecta lo que el autor (persona o agente) no ve, incluidos errores en los supuestos del propio verificador.
- **Deja a la persona el gusto, no la comprobación.** Las puertas de aprobación van donde la decisión es subjetiva; lo medible va en un script.
- **Las fuentes y licencias son parte de la entrega.** Cada recurso externo se registra con su origen y licencia, y los datos en pantalla son reales o se etiquetan como datos de ejemplo.

La skill parte de `claude-motion-design`, de Howseen AI (licencia MIT), de donde toma el modo remake y el enfoque de render y audio, adaptado a Windows y ampliado con voz en off local, el verificador y el catálogo de videos.
