---
author: Tommy CardeLo
pubDatetime: 2026-07-07T10:00:00Z
title: "Deepy — Un asistente de voz local para Windows, conectado a la CLI de Claude Code"
featured: true
draft: false
tags:
  - python
  - whisper
  - claude-code
  - ollama
  - windows
  - tts
lang: es
description: "Cómo un asistente de voz activado por atajo de teclado transcribe de forma local con Whisper, razona a través de la CLI de Claude Code con respaldo local en Ollama, y responde en voz con Piper TTS — casi sin que nada salga de la máquina."
---

> Un asistente de voz activado por atajo de teclado que transcribe de forma local con Whisper, razona vía la CLI de Claude Code (con respaldo en un modelo local de Ollama cuando no hay conexión) y responde en voz con Piper TTS. Todo, salvo el paso de razonamiento, corre en el propio equipo.

Repo: [github.com/TomCardeLo/deepy-voice-assistant](https://github.com/TomCardeLo/deepy-voice-assistant)

---

## El problema

Quería un asistente al estilo Jarvis en mi propio escritorio Windows — presionar una tecla, preguntar algo, obtener una respuesta hablada — sin tres cosas que no quería: audio viajando a una API de transcripción en la nube, un detector de palabra de activación siempre encendido y propenso a falsos positivos, o una segunda factura de LLM encima de una suscripción de Claude Code que ya pago. También necesitaba que conociera mis pendientes reales: notas sueltas que me reenvío por WhatsApp, organizadas en un archivo estructurado que puede leer como contexto.

## Qué hace

- **Atajo de teclado.** Mantén presionada `F9` para grabar mientras la sostienes, o presiona `Ctrl+Alt+D` para grabar hasta detectar silencio.
- **Transcripción local** con `faster-whisper` — GPU (CUDA, fp16) cuando está disponible, con respaldo en CPU (int8).
- **Razonamiento vía `claude -p`** (CLI de Claude Code, Haiku, sin herramientas, sin sesión) con las notas organizadas del día inyectadas como contexto; cae a un modelo local de Ollama (`qwen3:8b`) si Claude no responde.
- **Síntesis de voz con Piper TTS** (modelos `.onnx` locales), bajando el volumen de las demás apps mientras habla y restaurándolo después.
- **Un overlay flotante** (siempre encima, oculto en reposo) con una animación distinta por estado — grabando, procesando, hablando — al estilo del indicador de Siri, más un ícono correspondiente en la bandeja del sistema.
- **Un script aparte** (`organizar_notas.py`) revisa un Google Sheet de entrada, clasifica las filas nuevas con `claude -p` en pendiente/recordatorio/completada/nota suelta, poda las completadas viejas y reescribe el archivo de notas que lee el asistente. Corre cada 2 horas vía el Programador de Tareas de Windows.
- **Un script de saludo matutino** que lee en voz alta los pendientes del día si inicias sesión antes de las 9am.
- **Una wake word entrenable** ("oye Deepy", vía `openWakeWord`) existe pero se envía **desactivada**: los falsos positivos por escuchar todo el tiempo no valían la pena; el atajo de teclado se queda como el disparador principal.

## Cómo funciona

```
Atajo de teclado (F9 sostenida / Ctrl+Alt+D)
        │
        ▼
Grabación (sounddevice) hasta detectar silencio (basado en RMS)
        │
        ▼
Transcripción local (faster-whisper — CUDA fp16, o CPU int8 de respaldo)
        │
        ▼
Prompt = notas organizadas + pregunta  →  claude -p  (respaldo: Ollama local)
        │
        ▼
Síntesis de voz (Piper TTS, modelo .onnx local)
        │
        ▼
Reproducción (baja el volumen de otras apps y lo restaura después)
```

En paralelo, `organizar_notas.py` corre por su cuenta (Programador de Tareas), leyendo un Google Sheet y reescribiendo el archivo de notas que consulta el flujo de arriba.

## Decisiones de diseño clave

### 1. La CLI de Claude Code como motor de razonamiento, no una API key

En vez de conectar directamente la API de Anthropic, el asistente ejecuta la CLI que ya tiene instalada y autenticada — sin API key separada, sin factura aparte:

```python
def preguntar_claude(pregunta: str) -> str | None:
    prompt = construir_prompt(pregunta)
    try:
        resultado = subprocess.run(
            ["claude", "-p", prompt,
             "--model", "haiku",
             "--tools", "",
             "--no-session-persistence",
             "--setting-sources", ""],
            capture_output=True, text=True, encoding="utf-8",
            timeout=60, creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if resultado.returncode != 0:
        return None
    return resultado.stdout.strip()
```

`--tools ""` y `--no-session-persistence` mantienen cada llamada como una completación de texto sin estado y sin herramientas — cero riesgo de que la CLI intente leer o escribir archivos por su cuenta, sin estado de sesión acumulándose entre preguntas. `CREATE_NO_WINDOW` la mantiene invisible cuando el asistente se lanza oculto.

### 2. Un respaldo local que nunca deja al usuario colgado

Si `claude -p` falla — sin internet, sin cupo — el asistente reintenta contra un modelo local de Ollama con el mismo prompt exacto, con `think: false` para saltarse el rastro de razonamiento y responder más rápido:

```python
def preguntar_ollama(pregunta: str) -> str | None:
    payload = json.dumps({"model": "qwen3:8b", "prompt": construir_prompt(pregunta),
                           "stream": False, "think": False}).encode("utf-8")
    try:
        with urllib.request.urlopen(Request(OLLAMA_URL, data=payload, ...), timeout=30) as r:
            return json.loads(r.read())["response"].strip()
    except (URLError, TimeoutError, KeyError, JSONDecodeError):
        return None

def responder(pregunta: str) -> str:
    respuesta = preguntar_claude(pregunta)
    if respuesta is not None:
        return respuesta
    respuesta = preguntar_ollama(pregunta)
    if respuesta is not None:
        return respuesta
    return "Hubo un error al consultar tanto a Claude como al modelo local de respaldo."
```

Dos proveedores, probados en orden, con un error hablado como último recurso en lugar de un fallo silencioso o un cuelgue.

### 3. Detección de silencio basada en RMS, no una librería de VAD

Sin `webrtcvad`, sin detección de actividad de voz basada en ML — solo el RMS de cada bloque de audio de 100ms comparado contra un umbral, cortando la grabación tras 1.5 segundos de silencio continuo y con un tope duro de 10 segundos sin importar qué:

```python
def grabar_hasta_silencio() -> np.ndarray:
    frames = []
    silencio_frames = 0
    with sd.InputStream(samplerate=16000, channels=1, dtype="int16",
                         blocksize=1600, callback=lambda i, *_: frames.append(i.copy())):
        while len(frames) < max_bloques:
            sd.sleep(100)
            rms = np.sqrt(np.mean(frames[-1].astype(np.float64) ** 2))
            silencio_frames = silencio_frames + 1 if rms < SILENCIO_RMS else 0
            if len(frames) > 3 and silencio_frames >= frames_silencio_necesarios:
                break
    return np.concatenate(frames, axis=0).flatten()
```

Las constantes de umbral (`SILENCIO_RMS`, `SILENCIO_SEG`) asumen un blocksize exacto de 100ms — un comentario en el código señala que el dispositivo real entrega bloques de ~26ms sin eso, lo que activaría el tope máximo de duración cuatro veces antes de tiempo.

### 4. Ruta rápida por GPU, respaldo en CPU, cargado una sola vez

El modelo `medium` de `faster-whisper` primero intenta CUDA con `float16`; si eso falla (sin GPU, DLL de CUDA faltantes), cae a CPU con cuantización `int8`. El modelo se carga una sola vez en un singleton a nivel de módulo al iniciar, no por cada solicitud — la latencia de transcripción es el tiempo de inferencia del modelo, no una carga en frío.

### 5. Una sola máquina de estados, dos representaciones visuales

Una única llamada a `_estado()` se ramifica hacia un overlay flotante (`overlay.py`, siempre encima, oculto en reposo, indicador animado al estilo Siri) y un ícono de bandeja del sistema (`bandeja.py`) para cada uno de cuatro estados — escuchando, grabando, procesando, hablando. Las tres animaciones se exportaron desde una herramienta de diseño y se colocan en `animaciones/` como GIFs reemplazables, así la identidad visual puede cambiar sin tocar la lógica de estados.

### 6. Un socket vinculado como guardia de instancia única

```python
_guard = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    _guard.bind(("127.0.0.1", PUERTO_INSTANCIA_UNICA))
except OSError:
    print("Ya hay una instancia de Deepy corriendo, saliendo.")
    return
```

Dos instancias peleando por el mismo micrófono pasó una vez; vincular un puerto TCP local es una guardia de una sola línea contra eso, liberada automáticamente por el sistema operativo aunque el proceso muera mal — sin archivo de bloqueo que limpiar.

### 7. Una wake word que existe, funciona y se envía desactivada

`openWakeWord` es entrenable vía un notebook de Colab (GPU T4, 1-2h) y está conectado al loop principal detrás de un umbral (`UMBRAL = 0.6`), pero `USAR_WAKEWORD = False` por defecto: escuchar todo el tiempo produjo suficientes falsos positivos como para que el atajo de teclado solo sea la mejor opción por defecto. El camino de código queda intacto; cambiar una constante lo reactiva.

## Huella de privacidad y costo

El audio, la transcripción, el archivo de notas y la salida de voz nunca salen de la máquina. La única llamada de red es el paso de razonamiento — y ese incluso reutiliza una suscripción de Claude Code ya existente en lugar de facturar una API key aparte, con un modelo de Ollama completamente local como respaldo cuando no hay conexión en absoluto.

## Stack

Python 3.14 · faster-whisper (CTranslate2, CUDA fp16 / CPU int8) · sounddevice · keyboard · CLI de Claude Code (`claude -p`, Haiku) · Ollama (`qwen3:8b`, respaldo local) · Piper TTS (modelos de voz ONNX) · pycaw (control de volumen en Windows) · openWakeWord (opcional, ONNX, desactivado por defecto) · Programador de Tareas de Windows (organizador de notas + saludo matutino) · pytest (self-checks sin hardware real)
