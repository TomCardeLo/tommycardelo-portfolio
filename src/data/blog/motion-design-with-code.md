---
author: Tommy CardeLo
pubDatetime: 2026-10-15T10:00:00Z
title: "motion-comercial — Commercial motion-design videos from code, as a Claude Code skill"
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
lang: en
description: "A Claude Code skill that turns HTML, Playwright and ffmpeg into a free, local motion-design studio: deterministic scenes, real motion blur, local voice-over, synthesized sound and an automatic QA verifier."
---

> A Claude Code skill that produces short commercial motion-design videos entirely from code on Windows: HTML scenes captured with Playwright, encoded with ffmpeg, narrated by a free local voice, scored with synthesized music, and checked by an automatic verifier. No After Effects, no Remotion, no paid services.

---

## The problem

Motion design for a brand usually means After Effects, a Remotion project, or a paid video-generation service. I wanted something different: short promo videos (launches, product demos, vertical ads, animated stats) that I could produce on my own machine, re-render in another language or aspect ratio by changing a line, and hand to a client without worrying about licenses.

The other half of the problem is that an AI agent can write the animation code, but it cannot *watch* the result the way a person does. Generated video fails in boring, repeatable ways: everything moves at the same tempo, a toast slides out of frame, text is unreadable on a phone, the music drowns the voice. So the project is as much about automated review as about rendering.

## What a "skill" is

A Claude Code skill is a packaged set of instructions plus scripts that an agent loads on demand. The `SKILL.md` file describes when to use it and the protocol to follow; the folder next to it holds the tools. Here, the instructions turn the agent into a small studio (creative direction, script, design, animation, sound, render) and the scripts do the mechanical work. I act as the client: at each approval step the agent shows its work and stops.

## What it does

- **Scenes as code.** Each film is a folder with a `comp.html`, a `score.json` (sound) and a README. Eight starter types are included: product launch, narrated demo, vertical ad, kinetic typography, animated stat, logo sting, before/after and feature announcement.
- **Multiple formats and languages.** 16:9, 9:16, 1:1 and 4:5 from the same composition, written against the stage width and height instead of cropping. Strings live per language, so the English cut is a URL parameter.
- **Free local voice-over** with Kokoro, plus word-level timings from `faster-whisper` for subtitles and an SRT file.
- **Synthesized music and sound effects**, mixed in Python with the voice and normalized to -14 LUFS.
- **Real motion blur**, rendered in parallel across several browser processes.
- **A verifier** that reads the finished video (and the composition) and fails or warns on pacing, framing, legibility and audio.
- MIT-licensed code, OFL fonts, an Apache-2.0 voice and original synthesized sound: nothing that blocks client work.

## Architecture

```
comp.html  (HTML/CSS/JS, one pure function: render(t))
   │   loads lib/motion.js  (easing, springs, camera, text, transitions)
   │         lib/stage.js   (the contract: scenes, events, languages)
   ▼
render.py ── local HTTP server ── N Playwright/Chromium workers
   │   seek(t) → screenshot, sub-frames averaged in linear light
   ▼
draft.mp4 (no audio)                       score.json + events.json
                                                │
vo.py  (Kokoro TTS + whisper timings) ─────────┤
audio.py (synth music + SFX + ducking) ────────┘
   ▼
mix.wav (-14 LUFS)  ──►  mux with ffmpeg  ──►  film.mp4
                                                  │
                                    verify.py ◄───┘
                           report.json · contact sheets · textos.txt
```

## Key design decisions

### 1. Every frame is a pure function of time

A composition does not animate; it *answers a question*: what does the screen look like at time `t`? There are no CSS transitions, no timers, no `Math.random` (a seeded RNG is provided instead), and no state carried between frames. The payoff is determinism: seeking to the same `t` twice gives the same frame, so a renderer can jump anywhere, split the timeline across workers, and re-render just seconds 6 to 9 after a fix. It also makes the preview server trivial: `?t=3.2` is a screenshot of any moment.

### 2. Motion blur comes from the renderer, not from CSS

A CSS `blur()` is a fake that looks like a filter. Real blur is time integration: capture several sub-frames inside the shutter interval and average them. The renderer does this in linear light, and it is adaptive. It captures the two extremes of the shutter first; if they match, the frame is still and costs one capture. Otherwise optical flow estimates how far the fastest element moves, and it takes only as many captures as needed to keep the copies within a few pixels of each other. A slow drift uses a few; a whip-pan hits the cap. That keeps drafts fast without sacrificing the final.

### 3. Failure modes first, then the verifier

The header of `verify.py` lists every way a generated video goes wrong before any code exists: metronome pacing (shots all the same length), a dead film (too many still frames), a slow hook, single-frame jumps, elements outside the frame, lost "carries" (the object that should survive a scene change), unreadable text at phone width, low contrast, overlapping text, wrong duration, wrong codec, clipping, wrong loudness, sound that never breathes, and hits that land with no energy behind them. Each one is a numbered check that is either a hard fail or a warning.

Building it paid off immediately: the verifier flagged real problems in my own demo (metronome pacing, a toast out of frame, no moment of calm, text too small on a phone) and in its own design (a changing counter digit is not a "jump", and the final resting scene is not a "dead film"). Both got fixed. Rules of the form "the longest shot is at least 3x the shortest" sound arbitrary until you see how much better the cut feels once a machine enforces them.

### 4. Continuity is declared, not hoped for

Each scene declares a `carry`: the element that crosses into the next scene and transforms. The verifier checks that it is actually visible on both sides of the boundary. A scene change where nothing survives is a slideshow, and hard cuts must be declared explicitly. It is a small constraint that pushes the agent towards a designed film instead of a sequence of slides.

### 5. Human approval where taste matters, automation where it does not

The protocol has the agent stop for a brief, three distinct concepts, a beat-by-beat script, style frames, transitions and an animatic (a 720p, no-blur, full-audio draft that fixes the timing). Approved items are frozen. After that, rendering, mixing and verification run without pause, and the agent still has to look at the contact sheets and grade its own hook, legibility and sync. The verifier cannot check one thing: whether every name and number on screen is correct, so it dumps every visible string into `textos.txt` for a human to compare against the brief.

### 6. Voice drives the clock

With narration, the script sets the timing: each line starts at its own `t`, and if it does not fit before the next one it is sped up to 1.15x at most, or the build fails and says how much to trim. A `check` command estimates words per minute before any synthesis, so the script gets approved before audio is generated. Music ducks under the voice by a target number of dB, which the mixer prints so it can be tuned.

## Windows notes

Everything runs on plain `python`, Playwright's Chromium and ffmpeg (with `imageio-ffmpeg` as a fallback). The renderer starts its own local server and uses `spawn`-style processes, which is what Windows needs for multiprocessing. Console encoding (cp1252) is a recurring trap, so scripts reconfigure stdout. For long commands with code, the skill tells the agent to write a `.py` file and run it instead of fighting shell quoting.

Measured with 8 browsers, a 1080p30 draft takes roughly 3.5 seconds of wall-clock per second of video; the 4K60 final is about seven times that. That ratio is why the rule is: iterate on drafts and stills, and spend the final render only on an approved cut.

## What I learned

- **Determinism is the feature.** Once a frame is a pure function of time, parallel rendering, partial re-renders, multi-language and multi-format all come almost for free.
- **Write the QA before the generator.** A verifier written from a list of failure modes catches things the author (human or agent) is blind to, including bugs in the verifier's own assumptions.
- **Keep the human on taste, not on checking.** Approval gates belong where a decision is subjective; measurable things belong in a script.
- **Sources and licenses are part of the deliverable.** Every external asset is logged with its source and license, and on-screen data is real or explicitly labeled as example data.

The skill builds on the MIT-licensed `claude-motion-design` (remake mode and the render/audio approach) by Howseen AI, adapted for Windows and extended with local voice-over, the verifier and the video catalogue.
