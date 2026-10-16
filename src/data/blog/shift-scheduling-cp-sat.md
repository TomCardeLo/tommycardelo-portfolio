---
author: Tommy CardeLo
pubDatetime: 2026-10-15T12:00:00Z
title: "Weekly shift scheduling with OR-Tools CP-SAT — one hard rule, three soft ones, and Excel as the database"
featured: false
draft: false
tags:
  - python
  - optimization
  - or-tools
  - streamlit
  - excel
lang: en
description: "How I modeled weekly shift assignment for a distribution center as a constraint program: minimum staffing as the only hard constraint, fairness as weighted penalties, and an Excel workbook as the source of truth."
---

> A Streamlit app that assigns every employee of a distribution center (CEDI) one of three shifts per week with OR-Tools CP-SAT: minimum staffing is a hard constraint, rotation and fairness over recent history are weighted penalties, and the Excel workbook the planners already use is the only datastore.

Built for a distribution center of a Colombian company. The code is private, and every number below is illustrative.

---

## The problem

Each week, someone had to decide who works Shift 1, 2 or 3 in the warehouse. The rules lived in a spreadsheet as plain sentences:

1. Next week's shift should be based on the previous week's (don't repeat it if you can avoid it).
2. Staff with the same role should be spread evenly across the shifts they are allowed to work.
3. Each shift needs a minimum number of people in certain job positions.
4. Days worked per shift should even out over time (a night shift is not worth the same as a day shift).

Done by hand, this is a combinatorial puzzle that also needs memory: fairness only means something across weeks, and a spreadsheet has no memory of last week. The people running it are planners, not engineers, so whatever I built had to live where they already worked.

## What it does

- Reads the roster from the workbook: employee, job position, role, and which of the three shifts each person is eligible for.
- Reads the minimum headcount per shift and the days-per-shift table from the same sheet.
- Solves one shift per employee for the coming week.
- Shows the proposal with a KPI row (people per shift) before anything is saved.
- On confirmation, writes a new timestamped copy of the workbook with the week appended to a history sheet.

## Architecture

```
Excel workbook (roster, rules, history)
        │
        ▼
data.py ──► roster, minimums, days-per-shift  (pandas)
state.py ─► history window ► per-person state (last shift, accumulated days,
        │                                       recent counts per role)
        ▼
model.py: CP-SAT model ──► {employee: shift}  or  None (infeasible)
        │
        ▼
Streamlit UI: propose ► review ► confirm
        │
        ▼
New timestamped .xlsx (history sheet shifted by one week)
```

No database, no API. About 650 lines of Python in total, and the data and model modules each carry a runnable self-check.

## The model

One boolean variable per (employee, eligible shift), and exactly one shift per employee:

```python
x = {}
for p in personas:
    for t in elegibles[p]:
        x[p, t] = model.NewBoolVar(f"x_{p}_{t}")
    model.AddExactlyOne(x[p, t] for t in elegibles[p])
```

**Hard constraint (rule 3).** Each shift must reach its minimum headcount, counting only the job positions the rule applies to:

```python
for t in TURNOS:
    cuenta = [x[p, t] for p in personas
              if t in elegibles[p] and cargo_de[p] in CARGOS_CON_MINIMO]
    if cuenta:
        model.Add(sum(cuenta) >= int(minimos[t]))
```

**Soft constraints (rules 1, 2, 4).** Each one adds a weighted penalty to a single objective:

- **Rotation.** Penalize assigning someone the shift they had last week, but only if they have another eligible shift. Someone who can only work one shift should not distort the objective.
- **Role parity.** For each role, count how many people land on each shift, add the counts from the recent history window, and penalize `max - min` across shifts. Using the window instead of just this week is what makes the fairness cumulative.
- **Accumulated days.** Compare total days worked (weighted by each shift's days per week) but only between people with the same eligibility. Comparing someone who can work three shifts with someone who can work one would be meaningless.

The `max - min` terms use `AddMaxEquality` / `AddMinEquality` over auxiliary integer variables. The weights are plain constants (in this illustration, something like rotation 5, role parity 10, days 3), so a planner who disagrees with the priorities changes a number, not the structure.

## Key design decisions

### 1. CP-SAT instead of heuristics or a MIP library

A greedy heuristic ("give each person the shift they had least recently") is easy, but it cannot guarantee minimum staffing while also balancing three fairness criteria, and hand-tuned rules interact in ways that are hard to debug. A MIP formulation would work too, and I considered PuLP, but the problem is pure assignment plus min/max balancing over small integers: booleans, `AddExactlyOne`, `AddMaxEquality`. That is CP-SAT's natural territory, and it is not a smooth linear objective. The solve is capped at 10 seconds, which is far more than a roster of this size needs.

### 2. Exactly one hard constraint

My first instinct was to make every rule mandatory. The rules themselves said otherwise: rotation and fairness are phrased as "based on" and "even out", which are goals, not laws. When I offered the alternative of reporting infeasibility whenever rules compete, the user explicitly chose minimum staffing first, fairness second. With only rule 3 as hard, the model always produces a schedule when staffing is possible, and fairness degrades gracefully instead of the whole run failing.

### 3. Fairness needs memory, so the history lives in the workbook

The workbook had no notion of previous weeks, yet rules 1 and 2 need them. I went through three versions, each rejected by the user for a good reason:

1. A side JSON file: rejected, the shift history should live in the same Excel people open.
2. A long log growing forever: rejected after it silently reached five weeks.
3. **A rolling window of four weeks**, one row per employee, wide format (`Turno -3`, `Turno -2`, `Turno -1`, `Turno actual`). Confirming a week shifts the window left and drops the oldest column.

The bounded window is also a modeling choice: fairness is judged over the last month, not since the beginning of time, so an unlucky stretch from long ago doesn't distort today's decision.

### 4. Excel as the source of truth

The users live in Excel. Roster changes, new minimums, an employee who can now work another shift: all of it is an edit in a sheet they already know. Putting that behind a database would have meant building an admin UI for data they can already edit better than I could. The cost is fragility: the small side tables are read from fixed columns, so reordering columns breaks the loader. That is documented, and it is a trade I would make again at this scale.

The app never overwrites the base workbook. Every upload or confirmation writes a new file with a timestamp in its name, so a mistaken save is never destructive, and two saves on the same day don't collide (which did happen once during testing).

### 5. Streamlit, because the operators are not engineers

A CLI script would have been less code. But the people who run this each week are not going to open a terminal. Streamlit gave a propose / review / confirm flow in about a hundred lines of UI. Because the data could not leave the client's network, I skipped hosting and shipped a launcher script that creates a local virtual environment and starts the app on the user's own machine.

### 6. Infeasibility is a visible state, not a silent fallback

`resolver()` returns `None` when the minimums cannot be met. The UI turns that into an explicit error banner: minimum staffing cannot be satisfied with the current data. It does not quietly lower a minimum or drop a rule. If someone edits the minimums to something impossible, they find out immediately and know which rule to look at.

## What I learned

- The most valuable modeling decision was classifying the rules, not writing the constraints. Deciding which rule is a law and which is a preference took one conversation and shaped the whole model.
- State is part of the problem. A scheduler without history cannot be fair, so the "database" question was really a question about where a four-week window should live.
- The bugs came from the app around the solver, not the solver: a stale proposal stayed in `session_state` after uploading a different workbook, and the launcher trusted an exit code from the Windows Store Python stub, which reports success without doing anything.

## What's next

- **Per-day constraints.** Today the unit is one shift per person per week. The workbook already has entry and exit times per day, which the model does not use yet.
- **Explainability.** When a proposal repeats someone's shift, show which rule traded off against which, so the planner can trust or override it.
- **Manual locks.** Let a planner pin a person to a shift (a training week, coverage) and re-solve around it.
- **Version control and end-to-end checks.** The project has per-module self-checks but no repository yet; a run over several simulated weeks would catch fairness regressions.

## Stack

Python · OR-Tools CP-SAT · Streamlit · pandas · openpyxl · Excel as storage
