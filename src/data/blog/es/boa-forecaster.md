---
author: Tommy CardeLo
pubDatetime: 2026-04-24T10:00:00Z
title: "BOA Forecaster — Forecasting de series temporales multi-modelo con optimización bayesiana"
featured: false
draft: false
tags:
  - python
  - time-series
  - forecasting
  - machine-learning
  - bayesian-optimisation
lang: es
description: "Un framework Python enchufable para forecasting a escala: SARIMA, ML basado en árboles, deep learning y ensembles ponderados, todo tuneado con Optuna."
---

> Forecasting de series temporales multi-modelo con optimización bayesiana — SARIMA, Random Forest, XGBoost, LightGBM, Prophet, LSTM, QuantileML y ensembles ponderados.

Repo: [github.com/TomCardeLo/boa-sarima-forecaster](https://github.com/TomCardeLo/boa-sarima-forecaster)

---

## El problema

Quien gestiona demanda de cientos de SKUs en varios mercados se topa siempre con lo mismo: **cada serie necesita hiperparámetros distintos**. Ajustar a mano no escala, y la búsqueda por rejilla quema CPU sin compensar.

BOA Forecaster resuelve esto con **optimización bayesiana (Optuna TPE)** — una búsqueda eficiente en muestras que aprende de evaluaciones anteriores y se concentra en las regiones prometedoras del espacio de parámetros.

## Qué hace

Dada una serie temporal (mensual, semanal, diaria u horaria), la librería:

1. **Limpia los datos** — rellena huecos del calendario, elimina grupos con demanda cero y recorta outliers con un suavizador de media móvil ponderada.
2. **Elige un modelo** — SARIMA, Random Forest, XGBoost, LightGBM, Prophet, LSTM o un ensemble ponderado de cualquier combinación.
3. **Lo tunea automáticamente** — Optuna explora el espacio de búsqueda y puntúa cada prueba con `0.7·sMAPE + 0.3·RMSLE` (configurable).
4. **Lo valida** — cross-validation walk-forward con ventana expansiva, con baselines (Seasonal Naïve, ETS, AutoARIMA) para una comparación honesta.
5. **Predice** — predicciones puntuales y, opcionalmente, intervalos probabilísticos vía `QuantileMLSpec`.

## Cómo está construido

El núcleo es un protocolo pequeño — `ModelSpec` — que cualquier modelo implementa en unas 50 líneas. Esa única abstracción es lo que hace al framework enchufable: SARIMA, los boosters de árboles y una LSTM en PyTorch comparten el mismo optimizador y el mismo bucle de validación.

```
data_loader → preprocessor → standardization → features
                                                  ↓
                                              ModelSpec
                                                  ↓
                                              optimizer (Optuna TPE)
                                                  ↓
                                              validation (walk-forward CV)
                                                  ↓
                                              forecast (+ corrección de sesgo opcional)
```

Todo se configura desde un único `config.yaml`, y la API pública se exporta desde un solo punto de entrada, así que quien la usa no necesita saber qué familia de modelos está corriendo por debajo.

## Detalles de los que estoy orgulloso

- **Optimizador con fallo suave**: cuando un trial de Optuna falla, el resultado viene con un flag de fallback en lugar de lanzar excepción — los pipelines en producción no se rompen.
- **Recorte de outliers vectorizado**: `weighted_moving_stats_series` es entre 18 y 130 veces más rápido que la versión fila a fila, y matemáticamente equivalente.
- **Métricas por buckets**: `hit_rate_weighted` y `f1_by_bucket` para precisión por tramos, cuando importa más caer en la banda correcta que el error absoluto (pensar en índices de calidad del aire).
- **Presets**: `presets/air_quality.py` trae los cortes de ICA / US EPA AQI listos para usar.

## Stack

Python 3.9+, statsmodels, scikit-learn, XGBoost, LightGBM, Prophet, PyTorch, Optuna, Pydantic. CI corre sobre Python 3.9–3.11.
