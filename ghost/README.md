# ghost — corré contra tu propio fantasma

Motor que compara tu corrida **en vivo** contra una corrida **pasada** (el
"fantasma", tipo Mario Kart) y te dice cuántos segundos vas ganando o perdiendo,
listo para narrarse por voz por los Ray-Ban Meta (que funcionan como auriculares
Bluetooth comunes).

Este paquete es el **MVP del motor de gap**: la parte testeable sin salir a
correr. Le das dos tracks (el fantasma y la corrida a comparar) y reproduce la
carrera segundo a segundo, mostrando qué sonaría por los anteojos.

## ¿Por qué este recorte? (viabilidad)

- **El fantasma** = una actividad pasada de Garmin exportada como GPX/FIT
  (GPS + tiempo en cada punto). Dato que ya tenés.
- **Los Ray-Ban Meta clásicos no tienen pantalla ni SDK abierto**, pero son
  auriculares BT: cualquier TTS del celular suena por ellos. Así que el feedback
  *"vas nueve segundos arriba"* no depende de Meta para nada.
- **El cálculo del gap** es lo central y es independiente de dónde corra
  (celular o data-field Connect IQ en el Forerunner). Por eso lo aislamos acá:
  una vez que esto anda, se le enchufa GPS en vivo + TTS.

## Cómo funciona el gap

Gap **por distancia** (lo más intuitivo para sensación de carrera): en el punto
de la ruta donde estás ahora, ¿cuánto tardó el fantasma en llegar comparado con
vos?

```
gap = tiempo_del_fantasma_en_esa_distancia − tu_tiempo_actual
gap > 0  ->  vas GANANDO   (llegaste antes que el fantasma)
gap < 0  ->  vas PERDIENDO
```

Tu posición GPS se **proyecta sobre la polilínea del fantasma** para saber qué
distancia llevás recorrida sobre *esa* ruta (y de paso, si te saliste de ella).

## Probarlo

```bash
# Demo end-to-end sin archivos (genera fantasma + corrida y narra la carrera):
python -m ghost.demo

# Replay de dos GPX reales (exportados de Garmin Connect):
python -m ghost.replay --ghost mi_corrida_buena.gpx --run corrida_de_hoy.gpx

# Tests:
python tests/test_gap.py        # o: python -m pytest -q
```

## Piezas

| archivo        | qué hace |
|----------------|----------|
| `geo.py`       | haversine + proyección punto→segmento en metros locales |
| `track.py`     | parseo de GPX y modelo `Ghost` (`time_at_distance`, `project`) |
| `gap.py`       | `GapEngine` (gap suavizado) + `Narrator` (cuándo hablar) |
| `synth.py`     | generador de tracks sintéticos para testear |
| `replay.py`    | CLI: reproduce una corrida contra un fantasma |
| `demo.py`      | demo autocontenida |

El `Narrator` no dispara un número por segundo: avisa en los **cruces**
(te pasó / lo pasaste), cuando el gap se mueve ≥ 5 s, un **resumen por km**, y
**fuera de ruta**. Tiene una banda muerta (±2 s) para no parpadear cerca del
empate.

## Próximos pasos (cuando el motor convenza)

1. **GPS en vivo del celular** + TTS → suena por los Ray-Ban (sin permisos de
   Garmin ni Meta).
2. **Versión pro:** data-field **Connect IQ** (Monkey C) en el Forerunner usando
   el GPS del reloj, mostrando el gap en la muñeca y mandándolo a una companion
   app que pone la voz.
