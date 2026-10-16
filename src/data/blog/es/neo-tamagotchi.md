---
author: Tommy CardeLo
pubDatetime: 2026-10-15T15:00:00Z
title: "Neo Tamagotchi — Una mascota de bolsillo para mis perros, en C sobre un RP2350"
featured: false
draft: false
tags:
  - c
  - rp2350
  - embedded
  - pixel-art
  - personal
lang: es
description: "Un tamagotchi hecho a mano con los perros de mi familia en pixel art: lógica en C11 compartida entre un simulador de PC y un microcontrolador, dos relojes que sobreviven al sueño y una perrita ángel que nunca necesita cuidados."
---

> Un regalo para mi esposa: un tamagotchi de bolsillo donde viven nuestros cuatro perros en pixel art. El código del juego, en C11 puro, corre igual en un simulador de Windows y en una placa Waveshare RP2350 con pantalla AMOLED táctil, y uno de los perros es un ángel que nunca necesita nada.

---

## El problema

Quería regalarle a mi esposa algo que no fuera una pantalla llena de notificaciones. Un tamagotchi es lo contrario: un mundo pequeño, lento y paciente al que se le echa un vistazo. La condición era que las mascotas fueran las nuestras: **Maní**, **Aurelio**, **Nala** y **Kloe**.

Kloe ya no está con nosotros, así que no podía ser una mascota a la que le da hambre. Aparece como un fantasmita translúcido con aureola dorada, un ángel guardián que nunca se pone triste, nunca come y nunca se enferma. Visita a los demás y brilla. De ahí sale todo el diseño: sin castigos, sin muerte, sin estado de fracaso. Los perros se ponen un poco tristes o con sueño si los ignoras, y nada más.

## Qué hace

- Cuatro perros pasean por un parque en pixel art: caminan, trotan, se sientan, se rascan, se estiran, cavan, olfatean y ladran.
- Cuidados desde una barra de cuatro íconos: un hueso para comer, una pelota para jugar, un paseo y un baño. Tocar a un perro lo acaricia y se pone panza arriba.
- Indicadores suaves por perro (hambre, juego, sueño), como barras pequeñas sin rojo.
- De 22:00 a 07:00 los perros caminan a sus camas y duermen. Kloe les hace guardia.
- Un saludo de buenos días una vez al día, y fiestas en el cumpleaños de cada perro, en nuestro aniversario y en el cumpleaños de mi esposa.

## Hardware y stack

Una Waveshare RP2350-Touch-AMOLED-2.41: pantalla AMOLED de 2,41" y 600x450, RP2350B a 150 MHz, 520 KB de SRAM, y en la misma placa un RTC, una IMU, el controlador táctil y un cargador de LiPo.

El firmware es **C con el Pico SDK**. Primero miré MicroPython y lo descarté porque no estaba claro que el controlador de la pantalla tuviera soporte nativo. Del lado del PC hay una ventana Win32 mínima más un modo headless, compilados con `zig cc` (instalado con pip), para no depender de una toolchain completa en Windows.

## Arquitectura

```
          game.c (lógica)      draw.c (dibujo)
          sprites_data.c       parque_data.c
              C11 puro, sin hardware, sin malloc
                     |
                  hal.h (15 líneas)
            /                      \
   sim.c (Win32 + headless)     placa/hal_placa.c
   PC, velocidad x1 .. x3600    RP2350: pantalla QSPI, táctil,
                                RTC, IMU, guardado en flash, dormant
```

Toda la superficie de hardware es `hal.h`: `hal_epoch`, `hal_ms`, `hal_touch`, `hal_shake`, `hal_present`, `hal_load`/`hal_save`, `hal_idle`. El juego nunca toca un registro. Esa decisión hizo posible todo lo demás: construí, probé y mostré el juego completo antes de que llegara la placa, y portarlo fue implementar esas funciones. El código del juego no cambió.

## Decisiones de diseño

### 1. Dos relojes, a propósito

La pregunta más difícil de un tamagotchi es qué pasa mientras está apagado. Dividí el tiempo en dos:

- El **epoch del RTC** mueve todo lo ligado al mundo real: los indicadores, el día y la noche, el saludo diario y las fiestas.
- El **reloj de juego** (`t_ms`) se congela con la pantalla apagada y mueve las animaciones, los cuidados y el calendario de Kloe.

Con un solo reloj, el temporizador de Kloe podría vencerse dentro de mi bolsillo y ella aparecería en el instante en que enciendo la pantalla.

### 2. Los indicadores se integran, no se simulan

Los indicadores van de 10 a 100 con un piso estricto, y los perros se ven tristes por debajo de 30. Al encender tras una pausa, el aparato no reproduce el hueco tick por tick: lo integra en tramos de máximo 60 segundos, cada uno con la tasa de día o de noche de su propia hora, con un tope de siete días:

```c
const float *r = (h >= NOCHE_INI || h < NOCHE_FIN) ? TASA_NOCHE : TASA_DIA;
for (int i = 0; i < NDOGS; i++)
  for (int k = 0; k < NNEED; k++)
    s->need[i][k] = cl(s->need[i][k] + r[k] * c / 3600.f);
```

Así, un perro que durmió ocho horas de noche despierta descansado, y uno que pasó el día en un cajón tiene hambre pero nunca por debajo del piso. Si el reloj salta hacia atrás, no se recalcula nada.

### 3. Kloe es otra máquina de estados

Los perros tienen humores ponderados por la hora y por sus indicadores. Kloe no tiene ni siquiera un arreglo de indicadores, así que estructuralmente no puede estar triste. Es una pequeña rutina de visita: entra por un lado, baraja el orden de los perros, visita a cada uno, brilla cuando la tocan y se va. Su temporizador solo corre con la pantalla encendida (de 40 a 120 segundos), y hay un 35 % de probabilidad de que llegue a los pocos segundos si enciendo de día, para que las miradas rápidas también puedan encontrarse con ella. La pantalla no se apaga a media visita. De noche flota sobre los perros dormidos.

Todo eso se ajusta con las constantes `KLOE_*` de `config.h`. Los datos personales (el apodo y seis fechas) viven ahí también como simples defines, de modo que cambiar un cumpleaños nunca implica tocar la lógica.

### 4. Dibujar por bandas, porque 540 KB no caben

Un cuadro completo de 600x450 en RGB565 pesa 540 KB, más que los 520 KB de SRAM. Podía usar la PSRAM de la placa. En cambio, el render dibuja **10 bandas de 45 filas** con doble búfer, enviadas por QSPI con DMA. Va con un tope de 15 fps, de sobra para una mascota. El parque fijo vive en una caché de colores indexados y solo se recompone cuando cambia la franja horaria, la lluvia o la posición del sol o la luna; los cambios de paleta entre franjas se funden durante los últimos 30 minutos de cada una.

### 5. Guardar sin confiar en la flash

El guardado alterna entre dos ranuras en los últimos sectores de la flash, cada una con número mágico, versión, tamaño y checksum. Al cargar, el juego además rechaza cualquier indicador fuera de rango, lo que también atrapa los NaN. Un guardado corrupto no tumba el programa ni se carga a medias: se vuelve a un inicio limpio.

### 6. Un sueño que solo interrumpe el botón de energía

Con la pantalla apagada, la CPU seguía sondeando el táctil y la IMU cada 50 ms: entre 15 y 25 mA, alrededor de un día con una batería de 600 mAh. Pasé al modo dormant del RP2350: relojes al cristal, PLL apagados, despertar por un flanco en un GPIO, controlador táctil en hibernación e IMU apagada. El táctil no lograba despertarlo de forma fiable (el pulso de interrupción parecía demasiado corto), así que la decisión fue sencilla: **solo el botón de energía despierta al aparato dormido**. Ya despierto, el toque y la sacudida funcionan normal.

## Pipeline de pixel art

Los sprites partieron de hojas generadas a partir de fotos de los perros: caminar, correr, sentado, parpadeo, dormir, triste, más una hoja de acciones extra por perro. Un script de Python (`assets.py`) recorta los cuadros, quita el fondo con un relleno por inundación que parte solo del borde de la celda (para no comerse detalles interiores, como la placa rosada de Nala), alinea todos los cuadros a una misma línea base para que nadie tiemble, y escribe paletas indexadas de 8 bits en `sprites_data.c`, unos 1,46 MB de flash. El parque son 31 capas exportadas de una herramienta de diseño y convertidas igual a `parque_data.c`. Ambos archivos son generados, nunca se editan a mano.

## Cómo lo probé

No escribo pruebas unitarias a posteriori. Escribí primero los modos de fallo y después un único corredor E2E (`python juego/tools/e2e.py`) que maneja el simulador real en modo headless y deja artefactos: una tira de capturas y un `state.json`. Hoy pasa 80 de 80 comprobaciones: perros dormidos de noche y despiertos de día, pisos de los indicadores, Kloe nunca triste, un saludo por día, recuperación tras un apagado, reloj hacia atrás, guardados corruptos, determinismo, y que las seis fechas reales disparan su fiesta. En la placa, un script de diagnóstico deja un reporte JSON por USB. Aun así, tuve que sentarme frente a la pantalla real para calibrar la orientación, los desplazamientos y el espejo del táctil, algo que ninguna prueba podía hacer por mí.

## Lo que aprendí

- Un HAL diminuto es la mejor inversión en trabajo embebido: todo lo que queda encima se puede probar en el PC.
- Hay que decidir qué pasa cuando el tiempo se detiene antes de dibujar la primera barra de indicador.
- Las restricciones emocionales son restricciones de diseño. "Kloe nunca puede estar triste" se volvió un hecho de arquitectura en vez de un `if`.
- Aún no está terminado: falta empalmar el conector de la batería (primero la polaridad), cortar la carcasa de madera, y el letrero de cumpleaños tapa la aureola de Kloe. Son los siguientes pasos antes de que llegue a sus manos.
