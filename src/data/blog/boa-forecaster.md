---
author: Tommy CardeLo
pubDatetime: 2026-04-24T10:00:00Z
title: "BOA Forecaster — Multi-model time-series forecasting with Bayesian Optimisation"
featured: false
draft: false
tags:
  - python
  - time-series
  - forecasting
  - machine-learning
  - bayesian-optimisation
lang: en
description: "A pluggable Python framework for forecasting at scale: SARIMA, tree-based ML, deep learning, and weighted ensembles, all tuned with Optuna."
---

> Multi-model time-series forecasting with Bayesian Optimisation — SARIMA, Random Forest, XGBoost, LightGBM, Prophet, LSTM, QuantileML, and weighted ensembles.

Repo: [github.com/TomCardeLo/boa-sarima-forecaster](https://github.com/TomCardeLo/boa-sarima-forecaster)

---

## The problem

Demand planners managing hundreds of SKUs across multiple markets face the same headache: **every series needs different hyperparameters**. Manual tuning doesn't scale, and grid search burns CPU for diminishing returns.

BOA Forecaster solves this with **Bayesian Optimisation (Optuna TPE)** — a sample-efficient search that learns from past evaluations and focuses on promising regions of the parameter space.

## What it does

Given a time series (monthly, weekly, daily, or hourly), the library:

1. **Cleans the data** — fills calendar gaps, removes zero-demand groups, clips outliers with a weighted moving-average smoother.
2. **Picks a model** — SARIMA, Random Forest, XGBoost, LightGBM, Prophet, LSTM, or a weighted ensemble of any combination.
3. **Tunes it automatically** — Optuna explores the search space, scoring each trial with `0.7·sMAPE + 0.3·RMSLE` (configurable).
4. **Validates it** — expanding-window walk-forward CV, with baselines (Seasonal Naïve, ETS, AutoARIMA) for honest comparison.
5. **Forecasts** — point predictions, plus optional probabilistic intervals via `QuantileMLSpec`.

## How it's built

The core is a small protocol — `ModelSpec` — that any model implements in roughly 50 lines. That single abstraction is what makes the framework pluggable: SARIMA, tree boosters, and a PyTorch LSTM all share the same optimiser and validation loop.

```
data_loader → preprocessor → standardization → features
                                                  ↓
                                              ModelSpec
                                                  ↓
                                              optimizer (Optuna TPE)
                                                  ↓
                                              validation (walk-forward CV)
                                                  ↓
                                              forecast (+ optional bias correction)
```

Everything is configurable through a single `config.yaml`, and the public API is exported from one entry point so callers don't need to know which model family they're using.

## Things I'm proud of

- **Soft-failure optimiser**: when an Optuna trial crashes, the result carries a fallback flag instead of raising — production pipelines stay green.
- **Vectorised outlier clipping**: `weighted_moving_stats_series` is 18–130× faster than the row-by-row version, mathematically equivalent.
- **Bucketed metrics**: `hit_rate_weighted` and `f1_by_bucket` for tiered accuracy where landing in the right band matters more than the absolute error (think air quality indexes).
- **Preset packs**: `presets/air_quality.py` ships ICA / US EPA AQI edges out of the box.

## Stack

Python 3.9+, statsmodels, scikit-learn, XGBoost, LightGBM, Prophet, PyTorch, Optuna, Pydantic. Tested across Python 3.9–3.11 in CI.
