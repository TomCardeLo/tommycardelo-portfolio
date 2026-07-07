---
author: Tommy CardeLo
pubDatetime: 2026-07-07T10:00:00Z
title: "Deepy — A local voice assistant for Windows, wired into the Claude Code CLI"
featured: true
draft: false
tags:
  - python
  - whisper
  - claude-code
  - ollama
  - windows
  - tts
lang: en
description: "How a hotkey-triggered voice assistant transcribes locally with Whisper, reasons through the Claude Code CLI with a local Ollama fallback, and talks back with Piper TTS — with almost nothing leaving the machine."
---

> A hotkey-triggered voice assistant that transcribes locally with Whisper, reasons via the Claude Code CLI (falling back to a local Ollama model when offline), and talks back with Piper TTS. Everything except the reasoning step runs on-device.

Repo: [github.com/TomCardeLo/deepy-voice-assistant](https://github.com/TomCardeLo/deepy-voice-assistant)

---

## The problem

I wanted a Jarvis-style assistant on my own Windows desktop — press a key, ask something, get a spoken answer — without three things I didn't want: audio going to a cloud speech-to-text API, an always-on hotword listener prone to false triggers, or a second LLM bill on top of a Claude Code subscription I already pay for. It also needed to know my actual to-dos: loose notes I forward to myself over WhatsApp, organized into a structured file it can read as context.

## What it does

- **Hotkey trigger.** Hold `F9` to record while pressed, or tap `Ctrl+Alt+D` to record until it detects silence.
- **Local transcription** with `faster-whisper` — GPU (CUDA, fp16) when available, CPU (int8) fallback otherwise.
- **Reasoning via `claude -p`** (Claude Code CLI, Haiku, no tools, no session) with the day's organized notes injected as context; falls back to a local Ollama model (`qwen3:8b`) if Claude isn't reachable.
- **Speech synthesis with Piper TTS** (local `.onnx` voice models), ducking every other app's volume while it talks and restoring it afterward.
- **A floating overlay** (always on top, hidden at rest) with a different animation per state — recording, processing, speaking — Siri-indicator style, plus a matching system-tray icon.
- **A separate script** (`organizar_notas.py`) polls a Google Sheet inbox, classifies new rows with `claude -p` into pending/reminder/done/loose-note, prunes old completed items, and rewrites the notes file the assistant reads. Runs every 2 hours via Windows Task Scheduler.
- **A morning greeting script** that reads today's pending items out loud if you log in before 9am.
- **A trainable wake word** ("hey Deepy", via `openWakeWord`) exists but ships **disabled** — false positives from always-on listening weren't worth it; the hotkey stays the primary trigger.

## Architecture

```
Hotkey (F9 held / Ctrl+Alt+D)
        │
        ▼
Recording (sounddevice) until silence (RMS-based)
        │
        ▼
Local transcription (faster-whisper — CUDA fp16, or CPU int8 fallback)
        │
        ▼
Prompt = organized notes + question  →  claude -p  (fallback: local Ollama)
        │
        ▼
Speech synthesis (Piper TTS, local .onnx model)
        │
        ▼
Playback (ducks other apps' volume, restores it after)
```

In parallel, `organizar_notas.py` runs independently (Task Scheduler), reading a Google Sheet and rewriting the notes file the loop above consults.

## Key design decisions

### 1. The Claude Code CLI as the reasoning engine, not an API key

Rather than wiring up the Anthropic API directly, the assistant shells out to the CLI it already has installed and authenticated — no separate API key, no separate bill:

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

`--tools ""` and `--no-session-persistence` keep each call a stateless, tool-less text completion — no risk of the CLI trying to read or write files on its own, no session state accumulating between questions. `CREATE_NO_WINDOW` keeps it invisible when the assistant launches hidden.

### 2. A local fallback that never leaves the user hanging

If `claude -p` fails — no internet, no quota — the assistant retries against a local Ollama model with the exact same prompt, `think: false` to skip the reasoning trace and answer faster:

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

Two providers, tried in order, with a spoken error as the last resort instead of a silent failure or a hang.

### 3. RMS-based silence detection instead of a VAD library

No `webrtcvad`, no ML-based voice activity detection — just the RMS of each 100ms audio block compared against a threshold, with the recording cut after 1.5 seconds of continuous silence and a hard 10-second cap regardless:

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

The threshold constants (`SILENCIO_RMS`, `SILENCIO_SEG`) assume an exact 100ms blocksize — a comment in the code flags that the real device delivers ~26ms blocks without it, which would trip the max-duration cap four times too early.

### 4. GPU fast-path, CPU fallback, loaded once

`faster-whisper`'s `medium` model tries CUDA with `float16` first; if that raises (no GPU, missing CUDA DLLs), it falls back to CPU with `int8` quantization. The model loads once into a module-level singleton on startup, not per-request — transcription latency is the model's inference time, not a cold load.

### 5. One state machine, two renderers

A single `_estado()` call fans out to both a floating overlay (`overlay.py`, always-on-top, hidden at rest, Siri-style animated indicator) and a system-tray icon (`bandeja.py`) for each of four states — listening, recording, processing, speaking. The three animations were exported from a design tool and drop into `animaciones/` as replaceable GIFs, so the visual identity can change without touching the state logic.

### 6. A bound socket as the single-instance guard

```python
_guard = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    _guard.bind(("127.0.0.1", PUERTO_INSTANCIA_UNICA))
except OSError:
    print("Ya hay una instancia de Deepy corriendo, saliendo.")
    return
```

Two instances fighting over the same microphone happened once; binding a local TCP port is a one-line guard against it, released automatically by the OS even if the process dies uncleanly — no lock file to clean up.

### 7. A wake word that exists, works, and ships off

`openWakeWord` is trainable via a Colab notebook (GPU T4, 1–2h) and wired into the main loop behind a threshold (`UMBRAL = 0.6`), but `USAR_WAKEWORD = False` by default — always-on listening produced enough false positives that the hotkey alone is the better default. The code path stays intact; flipping one constant re-enables it.

## Privacy and cost footprint

Audio, transcription, the notes file, and TTS output never leave the machine. The only network call is the reasoning step — and even that reuses an existing Claude Code subscription instead of billing a separate API key, with a fully local Ollama model as the fallback when there's no connection at all.

## Stack

Python 3.14 · faster-whisper (CTranslate2, CUDA fp16 / CPU int8) · sounddevice · keyboard · Claude Code CLI (`claude -p`, Haiku) · Ollama (`qwen3:8b`, local fallback) · Piper TTS (ONNX voice models) · pycaw (Windows volume control) · openWakeWord (optional, ONNX, disabled by default) · Windows Task Scheduler (note organizer + morning greeting) · pytest (hardware-free self-checks)
