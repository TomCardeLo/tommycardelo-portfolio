---
author: Tommy CardeLo
pubDatetime: 2026-10-15T12:00:00Z
title: "Programación semanal de turnos con OR-Tools CP-SAT — una regla dura, tres blandas y Excel como base de datos"
featured: false
draft: false
tags:
  - python
  - optimization
  - or-tools
  - streamlit
  - excel
lang: es
description: "Cómo modelé la asignación semanal de turnos de un centro de distribución como un programa de restricciones: dotación mínima como única restricción dura, equidad como penalizaciones ponderadas y un libro de Excel como fuente de verdad."
---

> Una app en Streamlit que asigna a cada funcionario de un centro de distribución (CEDI) uno de tres turnos por semana con OR-Tools CP-SAT: la dotación mínima es una restricción dura, la rotación y la equidad sobre el historial reciente son penalizaciones ponderadas, y el Excel que los planificadores ya usan es el único almacén de datos.

Construida para un centro de distribución de una empresa colombiana. El código es privado y todas las cifras de abajo son ilustrativas.

---

## El problema

Cada semana alguien tenía que decidir quién trabaja en el Turno 1, 2 o 3 de la bodega. Las reglas vivían en una hoja de cálculo como frases sueltas:

1. El turno de la próxima semana debe basarse en el de la semana anterior (no repetirlo si se puede evitar).
2. El personal con el mismo rol debe repartirse parejo entre los turnos a los que puede ir.
3. Cada turno necesita un mínimo de personas en ciertos cargos.
4. Los días trabajados por turno deben equilibrarse con el tiempo (un turno nocturno no pesa igual que uno diurno).

A mano, esto es un rompecabezas combinatorio que además exige memoria: la equidad solo tiene sentido entre semanas, y una hoja de cálculo no recuerda la semana pasada. Quienes lo operan son planificadores, no ingenieros, así que lo que construyera tenía que vivir donde ya trabajan.

## Qué hace

- Lee el roster del libro: funcionario, cargo, rol y a cuáles de los tres turnos puede ir cada persona.
- Lee de la misma hoja la dotación mínima por turno y la tabla de días por turno.
- Resuelve un turno por funcionario para la semana siguiente.
- Muestra la propuesta con una fila de indicadores (personas por turno) antes de guardar nada.
- Al confirmar, escribe una copia nueva del libro con marca de tiempo, con la semana agregada a una hoja de historial.

## Arquitectura

```
Libro de Excel (roster, reglas, historial)
        │
        ▼
data.py ──► roster, mínimos, días por turno  (pandas)
state.py ─► ventana de historial ► estado por persona (último turno,
        │                           días acumulados, conteos por rol)
        ▼
model.py: modelo CP-SAT ──► {funcionario: turno}  o  None (infactible)
        │
        ▼
UI en Streamlit: proponer ► revisar ► confirmar
        │
        ▼
Nuevo .xlsx con marca de tiempo (hoja de historial corrida una semana)
```

Sin base de datos ni API. Unas 650 líneas de Python en total, y los módulos de datos y del modelo traen cada uno una autoverificación ejecutable.

## El modelo

Una variable booleana por (funcionario, turno elegible), y exactamente un turno por funcionario:

```python
x = {}
for p in personas:
    for t in elegibles[p]:
        x[p, t] = model.NewBoolVar(f"x_{p}_{t}")
    model.AddExactlyOne(x[p, t] for t in elegibles[p])
```

**Restricción dura (regla 3).** Cada turno debe alcanzar su dotación mínima, contando solo los cargos a los que aplica la regla:

```python
for t in TURNOS:
    cuenta = [x[p, t] for p in personas
              if t in elegibles[p] and cargo_de[p] in CARGOS_CON_MINIMO]
    if cuenta:
        model.Add(sum(cuenta) >= int(minimos[t]))
```

**Restricciones blandas (reglas 1, 2 y 4).** Cada una suma una penalización ponderada a un único objetivo:

- **Rotación.** Se penaliza asignar a alguien el turno que tuvo la semana pasada, pero solo si tiene otro turno elegible. Quien solo puede ir a un turno no debe distorsionar el objetivo.
- **Paridad por rol.** Para cada rol se cuenta cuántas personas caen en cada turno, se suman los conteos de la ventana de historial reciente y se penaliza `max - min` entre turnos. Usar la ventana y no solo la semana actual es lo que vuelve acumulativa la equidad.
- **Días acumulados.** Se comparan los días trabajados (ponderados por los días semanales de cada turno), pero solo entre personas con la misma elegibilidad. Comparar a quien puede ir a tres turnos con quien solo puede ir a uno no tendría sentido.

Los términos `max - min` usan `AddMaxEquality` / `AddMinEquality` sobre variables enteras auxiliares. Los pesos son constantes simples (en este ejemplo, algo como rotación 5, paridad por rol 10, días 3), así que si un planificador no está de acuerdo con las prioridades, cambia un número y no la estructura.

## Decisiones de diseño clave

### 1. CP-SAT en lugar de heurísticas o una librería MIP

Una heurística voraz ("dar a cada persona el turno que hace más tiempo no tiene") es fácil, pero no puede garantizar la dotación mínima y a la vez equilibrar tres criterios de equidad, y las reglas afinadas a mano interactúan de formas difíciles de depurar. Una formulación MIP también serviría, y consideré PuLP, pero el problema es asignación pura más balanceo min/max sobre enteros pequeños: booleanos, `AddExactlyOne`, `AddMaxEquality`. Ese es el terreno natural de CP-SAT, y no se trata de un objetivo lineal suave. La resolución tiene un tope de 10 segundos, mucho más de lo que necesita un roster de este tamaño.

### 2. Exactamente una restricción dura

Mi primer instinto fue volver obligatorias todas las reglas. Las propias reglas decían otra cosa: la rotación y la equidad están redactadas como "con base en" y "equilibrar", que son objetivos, no leyes. Cuando propuse la alternativa de reportar infactibilidad si las reglas compiten, el usuario eligió explícitamente primero la dotación mínima y después la equidad. Con solo la regla 3 como dura, el modelo siempre produce un horario cuando la dotación es posible, y la equidad se degrada con elegancia en lugar de que falle toda la corrida.

### 3. La equidad necesita memoria, así que el historial vive en el libro

El libro no tenía noción de semanas anteriores, pero las reglas 1 y 2 las necesitan. Pasé por tres versiones, y el usuario rechazó cada una con una buena razón:

1. Un JSON aparte: rechazado, el historial de turnos debía vivir en el mismo Excel que la gente abre.
2. Un registro largo que crece sin límite: rechazado después de que llegó sin querer a cinco semanas.
3. **Una ventana móvil de cuatro semanas**, una fila por funcionario, en formato ancho (`Turno -3`, `Turno -2`, `Turno -1`, `Turno actual`). Al confirmar una semana, la ventana se corre a la izquierda y se descarta la columna más vieja.

La ventana acotada también es una decisión de modelado: la equidad se juzga sobre el último mes y no desde el inicio de los tiempos, de modo que una racha injusta de hace mucho no distorsiona la decisión de hoy.

### 4. Excel como fuente de verdad

Los usuarios viven en Excel. Un cambio de roster, nuevos mínimos, alguien que ahora puede ir a otro turno: todo es editar una hoja que ya conocen. Poner eso detrás de una base de datos habría significado construir una interfaz de administración para datos que ellos ya editan mejor de lo que yo podría. El costo es la fragilidad: las tablas pequeñas se leen de columnas fijas, así que reordenar columnas rompe el cargador. Está documentado, y es un compromiso que volvería a tomar a esta escala.

La app nunca sobrescribe el libro base. Cada carga o confirmación escribe un archivo nuevo con marca de tiempo en el nombre, de modo que un guardado por error nunca es destructivo y dos guardados el mismo día no chocan (algo que sí ocurrió una vez durante las pruebas).

### 5. Streamlit, porque quienes lo operan no son ingenieros

Un script de línea de comandos habría sido menos código. Pero quienes lo ejecutan cada semana no van a abrir una terminal. Streamlit dio un flujo proponer / revisar / confirmar en unas cien líneas de interfaz. Como los datos no podían salir de la red del cliente, descarté el hosting y entregué un script de arranque que crea un entorno virtual local y levanta la app en la propia máquina del usuario.

### 6. La infactibilidad es un estado visible, no un respaldo silencioso

`resolver()` devuelve `None` cuando no se pueden cumplir los mínimos. La interfaz lo convierte en un banner de error explícito: la dotación mínima no se puede satisfacer con los datos actuales. No baja un mínimo en silencio ni descarta una regla. Si alguien edita los mínimos hasta dejarlos imposibles, se entera de inmediato y sabe qué regla revisar.

## Qué aprendí

- La decisión de modelado más valiosa fue clasificar las reglas, no escribir las restricciones. Decidir cuál regla es una ley y cuál una preferencia tomó una conversación y marcó todo el modelo.
- El estado es parte del problema. Un planificador sin historial no puede ser equitativo, así que la pregunta de la "base de datos" era en realidad dónde debe vivir una ventana de cuatro semanas.
- Los errores vinieron de la app alrededor del solver, no del solver: una propuesta vieja quedaba en `session_state` al cargar otro libro, y el script de arranque confiaba en el código de salida del stub de Python de la Microsoft Store, que reporta éxito sin hacer nada.

## Qué sigue

- **Restricciones por día.** Hoy la unidad es un turno por persona por semana. El libro ya trae horarios de entrada y salida por día, que el modelo todavía no usa.
- **Explicabilidad.** Cuando una propuesta repite el turno de alguien, mostrar qué regla cedió frente a cuál, para que el planificador pueda confiar en ella o corregirla.
- **Bloqueos manuales.** Permitir fijar a una persona en un turno (una semana de capacitación, una cobertura) y volver a resolver alrededor de eso.
- **Control de versiones y pruebas de extremo a extremo.** El proyecto tiene autoverificaciones por módulo pero aún no tiene repositorio; una corrida sobre varias semanas simuladas detectaría regresiones de equidad.

## Stack

Python · OR-Tools CP-SAT · Streamlit · pandas · openpyxl · Excel como almacenamiento
