---
author: Tommy CardeLo
pubDatetime: 2026-10-15T15:00:00Z
title: "Neo Tamagotchi — A pocket pet for my dogs, in C on an RP2350"
featured: false
draft: false
tags:
  - c
  - rp2350
  - embedded
  - pixel-art
  - personal
lang: en
description: "A handmade tamagotchi with my family's dogs in pixel art: portable C11 game logic shared between a PC simulator and a microcontroller, two clocks that survive sleep, and an angel dog who never needs care."
---

> A gift for my wife: a pocket tamagotchi where our four dogs live in pixel art. Pure C11 game code runs both in a Windows simulator and on a Waveshare RP2350 touch-AMOLED board, and one of the dogs is an angel who never needs anything.

---

## The problem

I wanted to give my wife something that was not a screen full of notifications. A tamagotchi is the opposite of that: a tiny, slow, forgiving world you glance at. The twist was that the pets had to be ours: **Maní**, **Aurelio**, **Nala** and **Kloe**.

Kloe is no longer with us, so she could not be a pet that gets hungry. She appears as a translucent little ghost with a golden halo, a guardian angel who never gets sad, never eats and never gets sick. She visits the others and glows. Everything about the design follows from that: no punishment, no death, no failure state. The dogs get a little sad or sleepy if you ignore them, and that is all.

## What it does

- Four dogs wander a pixel-art park: walking, trotting, sitting, scratching, stretching, digging, sniffing, barking.
- Care actions from a four-icon bar: a bone to eat, a ball to play, a walk, a bath. Tapping a dog pets it and it rolls belly-up.
- Soft needs per dog (hunger, play, sleep), drawn as small bars with no red.
- Dogs walk to their beds and sleep from 22:00 to 07:00. Kloe keeps watch over them.
- A good-morning greeting once a day, and parties on each dog's birthday, our anniversary and my wife's birthday.

## Hardware and stack

A Waveshare RP2350-Touch-AMOLED-2.41: 2.41" 600x450 AMOLED, RP2350B at 150 MHz, 520 KB SRAM, plus an RTC, an IMU, a touch controller and a LiPo charger on the board.

Firmware is **C with the Pico SDK**. I looked at MicroPython first and dropped it because it was not clear the display driver was supported natively. On the PC side there is a tiny Win32 window plus a headless mode, compiled with `zig cc` (installed through pip), so I did not need a full toolchain on Windows.

## Architecture

```
          game.c (logic)       draw.c (render)
          sprites_data.c       parque_data.c
              pure C11, no hardware, no malloc
                     |
                  hal.h (15 lines)
            /                      \
   sim.c (Win32 + headless)     placa/hal_placa.c
   PC, speed x1 .. x3600        RP2350: QSPI display, touch,
                                RTC, IMU, flash save, dormant
```

The whole hardware surface is `hal.h`: `hal_epoch`, `hal_ms`, `hal_touch`, `hal_shake`, `hal_present`, `hal_load`/`hal_save`, `hal_idle`. The game never touches a register. That one decision made everything else possible: I built, tested and demoed the full game before the board arrived, and porting it was a matter of implementing those functions. The game code did not change.

## Key design decisions

### 1. Two clocks, on purpose

The hardest question in a tamagotchi is what happens while it is off. I split time in two:

- The **RTC epoch** drives anything tied to the real world: needs, day and night, the daily greeting, parties.
- The **game clock** (`t_ms`) freezes when the screen is off and drives animation, care actions and Kloe's schedule.

If a single clock did both, Kloe's timer could expire in my pocket and she would arrive the instant I woke the screen.

### 2. Needs are integrated, not simulated

Needs run from 10 to 100 with a hard floor, and dogs look sad under 30. When the device powers up after a gap, it does not replay the gap tick by tick. It integrates it in chunks of at most 60 seconds, each one using the day or night rate of its own hour, capped at seven days:

```c
const float *r = (h >= NOCHE_INI || h < NOCHE_FIN) ? TASA_NOCHE : TASA_DIA;
for (int i = 0; i < NDOGS; i++)
  for (int k = 0; k < NNEED; k++)
    s->need[i][k] = cl(s->need[i][k] + r[k] * c / 3600.f);
```

So a dog that slept through eight hours of night wakes up rested, and one left in a drawer all day is hungry but never below the floor. If the clock jumps backwards, nothing is recomputed.

### 3. Kloe is a different state machine

Dogs have moods weighted by time of day and needs. Kloe has no needs array at all, so she structurally cannot be sad. She is a small visit routine: enter from a side, shuffle the order of the dogs, visit each, glow when touched, leave. Her timer only runs while the screen is on (40 to 120 seconds), with a 35% chance of showing up within seconds when I turn it on during the day, so short check-ins still have a chance of meeting her. The screen will not turn off in the middle of a visit. At night she hovers over the sleeping dogs.

All of that is tuned from `config.h` through `KLOE_*` constants. The personal data (nickname, six dates) lives there too as plain defines, so changing a birthday never means touching logic.

### 4. Drawing in bands, because 540 KB does not fit

A full 600x450 RGB565 frame is 540 KB, more than the 520 KB of SRAM. I could have used the board's PSRAM. Instead the renderer draws **10 bands of 45 rows**, double-buffered, pushed over QSPI with DMA. It runs at a 15 fps cap, which is plenty for a pet. The static park lives in an indexed-color cache and is only recomposed when the time-of-day band, rain or the sun/moon position changes; palette changes between bands are cross-faded over the last 30 minutes of each.

### 5. Saving without trusting the flash

Saves alternate between two slots in the last flash sectors, each with a magic number, version, size and checksum. On load, the game also rejects any need value out of range, which catches NaN too. A corrupt save does not crash or half-load: it falls back to a clean start.

### 6. Sleep that only the power button can interrupt

With the screen off, the CPU kept polling touch and IMU every 50 ms, roughly 15 to 25 mA, about a day on a 600 mAh battery. I moved to the RP2350's dormant mode: clocks down to the crystal, PLLs off, wake on a GPIO edge, touch controller hibernated, IMU powered down. Touch would not wake it reliably (the interrupt pulse seemed too short), so the decision was simple: **only the power button wakes a sleeping device**. Once awake, touch and shake work normally.

## Pixel art pipeline

The sprites started as sheets generated from photos of the dogs: walk, run, sit, blink, sleep, sad, plus a sheet of extra actions each. A Python script (`assets.py`) cuts the frames, removes the background by flood-filling only from the cell border (so it never eats details inside the sprite, like Nala's pink tag), aligns every frame to a common baseline so nobody jitters, and writes 8-bit indexed palettes into `sprites_data.c`, about 1.46 MB of flash. The park is 31 layers exported from a design tool and converted the same way into `parque_data.c`. Both files are generated, never edited by hand.

## How I tested it

I do not write unit tests after the fact. I wrote the failure modes first, then one end-to-end runner (`python juego/tools/e2e.py`) that drives the real simulator in headless mode and writes artifacts: a contact sheet of screenshots and a `state.json`. It currently passes 80 of 80 checks: dogs asleep at night and awake by day, need floors, Kloe never sad, one greeting per day, recovery after a power-off, clock going backwards, corrupt saves, determinism, and all six real dates triggering their party. On the board, a diagnostic script writes a JSON report over USB. And I still had to sit in front of the actual screen to calibrate orientation, offsets and touch mirroring, which no test could do for me.

## What I learned

- A tiny HAL is the best investment in embedded work. Everything above it was testable on a PC.
- Decide what happens when time stops before drawing the first need bar.
- Emotional constraints are design constraints. "Kloe can never be sad" became an architectural fact instead of an `if`.
- It is not finished: the battery still needs its connector spliced (polarity first), the wooden case still needs to be cut, and the birthday banner covers Kloe's halo. Those are the next steps before it goes into her hands.
