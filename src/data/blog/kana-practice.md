---
author: Tommy CardeLo
pubDatetime: 2026-10-15T14:00:00Z
title: "Kana Practice — Learning to read hiragana by phonetically adapting Spanish"
featured: false
draft: false
tags:
  - javascript
  - playwright
  - vercel
  - japanese
  - personal
lang: en
description: "A static web app where Spanish words become kana by sound, you transcribe them back to romaji, and an edit-distance alignment grades every kana — no framework, no build step."
---

> A static web app to practice reading hiragana and katakana: it turns random Spanish words (or your own text) into kana by sound, you transcribe them back to romaji, and it grades them kana by kana. Plain HTML, CSS and ES modules, no build step.

Repo: [github.com/TomCardeLo/kana-practice](https://github.com/TomCardeLo/kana-practice) · Live: [kana-practice-green.vercel.app](https://kana-practice-green.vercel.app)

---

## The problem

I'm learning Japanese, still at a basic level, and the part that stalls me is reading kana quickly. Flashcards of isolated characters only go so far. What I wanted was *words*: things I can sound out, with immediate feedback on exactly which syllable I got wrong.

The catch is the source material. I don't have a graded corpus of Japanese words at my level, but I have an unlimited supply of Spanish. Spanish and Japanese share five clean vowels and mostly consonant-vowel syllables, so a Spanish word can be *adapted* to Japanese phonetics: `casa` becomes かさ, `luna` becomes るな. It doesn't mean anything in Japanese. It's a reading exercise, not a translation, and the app says so.

## What it does

- **Two modes.** A round of 5 random Spanish words, or any text you type or paste.
- **Hiragana or katakana**, with an optional filter to practice only certain rows (say, あ/か/さ while you're learning the first ones).
- **You hide the Spanish, read the kana, type the romaji.** The app marks each kana green or red, and you can reveal the solution, which doesn't count in the stats.
- **Accepted variants.** shi/si, tsu/tu, fu/hu, ji/zi, `n`/`nn` and so on aren't penalized, since people romanize differently.
- **Per-kana stats** in `localStorage`, sorted by error rate, so I can see which syllables cost me the most.
- **A flashcards page** for single kana: 3 lives per round, time per card, personal bests per configuration.

## Architecture

```
Spanish text / random word
        │
        ▼
translit.js   normalize → rewrite spelling → parse into romaji syllables
        │
        ▼
kana.js       syllables → hiragana / katakana (wanakana + row metadata)
        │
        ▼
user types romaji
        │
        ▼
check.js      romaji → kana → tokenize → align (edit distance) → per-kana verdict
        │
        ▼
stats.js      per-kana hits/misses in localStorage
```

Seven small modules and no framework. `app.js` is the UI glue; `cards.js` drives the flashcards page and reuses the same deck, checker and stats code.

## Key design decisions

### 1. Spanish to kana is a rewrite pipeline, not a lookup table

The conversion lives in `translit.js` and runs in three stages. First, normalization: lowercase, strip accents, but protect `ñ` and `ü` so they survive. Second, an ordered list of spelling rewrites where order is the whole point, digraphs before single letters:

```js
const REWRITES = [
  [/qu/g, 'k'],
  [/gu([ei])/g, 'G$1'],   // hard g, silent u
  [/ch/g, 'C'],
  [/ll/g, 'y'],
  [/rr/g, 'r'],
  [/l/g, 'r'],
  [/g([ei])/g, 'j$1'],    // soft g sounds like Spanish "j"
  [/c([ei])/g, 's$1'],
  [/c/g, 'k'],
  [/h/g, ''],             // silent
  // ...
];
```

`G` is a temporary marker so the hard `g` in `guitarra` isn't mistaken for the soft `g` in `gente` by a later rule. Third, a small parser walks the result and emits syllables, with a table for irregular combinations (`ti` → `chi`, `tu` → `tsu`, `si` → `shi`).

Consonant clusters are the interesting case, because Japanese can't pronounce them. A consonant with no vowel after it, whether in a cluster or at the end of a word, gets one inserted: `u` by default, but `o` after `t`/`d`, which is how loanwords usually work. `tres` becomes `to-re-su` → とれす. A lone `n` becomes ん.

Before writing any of it I listed the ways it could fail, in a file, and only then wrote the code (`tests/e2e/failure-modes.md`, about 40 entries): digraphs applied letter by letter, `gue/gui` keeping their silent `u`, `n` before a vowel confused with ん, `ñ` lost when stripping accents, emojis and numbers breaking the output.

### 2. Grading by alignment, not position

The naive checker compares the typed kana to the expected kana at the same index. It has one fatal flaw: if you skip or add one kana, everything after it turns red. That's terrible feedback for a learner.

`check.js` converts the typed romaji to hiragana with wanakana, tokenizes it into units (a kana plus its small ゃゅょ if it has one), and aligns the expected and typed sequences with edit distance and a backtrace. A missing or extra kana stays isolated; the rest of the word still lines up. When costs tie, substitution wins over insertion/deletion, so each expected kana gets *paired* with something typed. That lets me show what I actually wrote next to what was expected, instead of a bare "missing".

Converting to kana *before* comparing is also what makes the variants free. `shi` and `si` both become し, so there's no variant table to maintain. A few normalizations handle the rest: ぢ/づ are folded into じ/ず, and `nn` is reduced to ん only when no syllable follows that would claim it (`kanna` stays か-ん-な).

### 3. Convert word by word

A small bug worth mentioning: if you convert the whole typed answer in one go, a final `n` fuses with the next word's initial vowel. `pan agua` turns into ぱなぐあ instead of ぱん + あぐあ. So the answer is split on spaces and each word is converted separately.

### 4. No framework, no build step

The app is a handful of ES modules served as-is. The only dependency, wanakana 5.3.1, is vendored in the repo instead of loaded from a CDN. Reasons: a CDN would be a runtime dependency and a point of failure for a page that otherwise needs nothing; it lets me lock the Content Security Policy down to same-origin plus Google Fonts; and "deploy" is just pushing, since Vercel serves the folder. Running locally is `python3 -m http.server`.

The trade-off is real: no bundling means a chain of module requests. Lighthouse on mobile gave Accessibility, Best Practices and SEO of 100; Performance was 73 under simulated throttling and 98 with real DevTools throttling. I suspect the unbundled module chain explains the gap. For this app I'm fine with that.

### 5. Safe by construction

User text always reaches the DOM through `textContent`, never `innerHTML`, and `localStorage` access is wrapped in `try/catch`, so private mode just means no saved progress. A pre-launch audit led to security headers in `vercel.json`: a strict CSP (`connect-src 'none'`, `object-src 'none'`, `frame-ancestors 'none'`), `X-Frame-Options`, `nosniff`, and referrer and permissions policies.

### 6. E2E tests as the only tests

No unit tests. The suite is Playwright, driving the real pages: practice flow, long texts, row filters, stats persistence, tutorial, layout at desktop and mobile, launch metadata, and the flashcards game. The flashcards tests use Playwright's fake clock, so per-card timings are exact with no real waiting. The full suite passed 242/242 against the production URL (via `BASE_URL`), and the HTML report is the artifact. Code review of the flashcards also caught two real bugs before release: a section that stayed visible despite `hidden` (a component's `display: flex` overrode it, fixed with a global `[hidden] { display: none !important; }`), and a stray `n` carrying over into the next card.

## A promo video, rendered from code

For the launch I also made a 31-second promo, landscape and vertical, rendered at 4K/60 from an HTML composition, with synthesized music and effects. The script follows one idea: a word mutates. `casa` drops in, splits into ca | sa, the `c` flips into a green `k`, and each syllable folds into its kana. Then it walks through the three modes. My first 15-second cut was rejected, fairly: it demoed the flow without explaining what the app *is*. The fix was to open with the Spanish-to-kana idea. The video lives outside the repo, so none of it is shipped with the app.

## What I learned

- **Phonetic adaptation is mostly rule ordering.** Most of the trouble in `translit.js` comes down to a rule firing before the one that should have preempted it.
- **Edit-distance alignment beats positional diffing** anywhere the user can drop or add a unit. It's also not much code.
- **Write the failure list first.** It made the E2E suite easy to write and surfaced cases I'd have forgotten.
- **Known limits.** The adaptation approximates Japanese sound; it isn't real Japanese. And in flashcards with both syllabaries, a leftover `n` after ん can answer the next ン.

## Stack

HTML · CSS · JavaScript (ES modules, no build) · wanakana 5.3.1 (vendored) · Playwright E2E · Vercel
