# Fantasma — versión pro (Connect IQ + companion de voz)

Corré contra tu propio fantasma con el **GPS del Forerunner**: un **data-field
Connect IQ** calcula el gap en la muñeca (verde = ganando, rojo = perdiendo) y le
manda las frases a una **companion app Android** que las dice por voz, sonando
por los Ray-Ban Meta (auriculares Bluetooth).

```
   ┌─────────────────────────── Forerunner ───────────────────────────┐
   │  GPS del reloj ─► GapEngine (proyección + gap) ─► pantalla (gap)   │
   │                              │                                     │
   │                          Narrator ─► Communications.transmit ──────┼──┐
   └───────────────────────────────────────────────────────────────────┘  │
                                                                  BLE / Garmin Connect
   ┌──────────────────────────── Celular ─────────────────────────────┐  │
   │  Companion (Connect IQ Mobile SDK) ◄──────────────────────────────┼──┘
   │        onMessage {"say": "..."} ─► TextToSpeech ─► 🔊 Ray-Ban       │
   └───────────────────────────────────────────────────────────────────┘
```

**La lógica del gap es el mismo algoritmo que el motor Python testeado**
(`ghost/`). `source/GhostModel.mc` es un port fiel de `geo.py` + `track.py` +
`gap.py`, así que los tests de Python (`tests/`) validan el comportamiento.

## Flujo de uso

1. **Exportá el fantasma** desde un GPX de Garmin Connect al recurso del reloj:
   ```bash
   python -m ghost.export_ciq --gpx mi_mejor_10k.gpx \
       --out connectiq/resources/data/ghost.json --name "10k del parque"
   ```
2. **Compilá e instalá el data-field** (necesitás el Connect IQ SDK + una
   developer key — ver abajo).
3. En el reloj, agregá el data-field "Fantasma" a una pantalla de tu perfil de
   *running*.
4. **Instalá la companion app Android** y dejala abierta (ver
   `companion-android/`).
5. Emparejá los Ray-Ban como auriculares BT del celular y salí a correr.

## Compilar el data-field

Requiere el [Connect IQ SDK](https://developer.garmin.com/connect-iq/sdk/) y una
developer key (`Connect IQ: Generate a Developer Key` en VS Code, o `openssl`).

```bash
cd connectiq
# Generá un id propio para el manifest (VS Code: "Monkey C: Generate UUID").
monkeyc -f monkey.jungle -o bin/GhostGap.prg -y /ruta/developer_key -d fr265
# Simulador:
connectiq            # abre el simulador
monkeydo bin/GhostGap.prg fr265
```

En el simulador, en *Simulation ▸ Activity Data* podés cargar un FIT con GPS
para ver el gap actualizándose.

## Protocolo reloj → celular

El reloj manda un único tipo de mensaje, una frase ya armada en español:

```json
{ "say": "Vas 9 segundos arriba" }
```

Mantener la decisión de *qué* y *cuándo* hablar en el reloj (el `Narrator`) deja
la companion app trivial (solo TTS), que es la parte que no se puede testear sin
hardware. Eventos que disparan voz: cruces (te pasó / lo pasaste), el gap se
mueve ≥ 5 s, resumen por km, fuera de ruta, y la llegada.

## Estructura

```
connectiq/
├── manifest.xml            # tipo datafield, productos FR, permiso Communications
├── monkey.jungle           # build config
├── source/
│   ├── GhostGapApp.mc       # entry point
│   ├── GhostGapView.mc      # data-field: GPS -> gap -> dibujo + voz
│   ├── GhostModel.mc        # port del motor (Ghost, GapEngine, Narrator)
│   └── PhoneLink.mc         # transmit de frases al celular
├── resources/
│   ├── data/ghost.json      # el fantasma exportado (generado)
│   ├── resources.xml        # mapea ghost.json -> Rez.JsonData.GhostData
│   ├── strings/strings.xml
│   └── drawables/           # ícono del launcher
└── companion-android/       # app de voz (ver su README)
```

## Limitaciones / no testeado

- **No se compiló acá** (este entorno no tiene el Connect IQ SDK ni el Android
  SDK). El algoritmo está validado por los tests de Python; el port Monkey C y la
  companion necesitan su primer build en tu máquina como smoke test real.
- `Communications.transmit` desde un *data-field* funciona en los Forerunner
  modernos; si algún modelo lo restringe, la alternativa es mover la lógica a un
  *watch-app* (widget) en vez de data-field.
- El fantasma va embebido como recurso (recompilás para cambiarlo). El próximo
  paso natural es que la companion le mande el fantasma elegido al reloj por BLE.
- TTS agrega ~300–800 ms de latencia; por eso el reloj muestra el número exacto
  en la muñeca y la voz es para no tener que mirar.
