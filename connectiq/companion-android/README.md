# Companion de voz (Android)

App mínima que escucha al data-field "Fantasma" por el **Connect IQ Mobile SDK**
y dice las frases por **TextToSpeech**. El audio sale por los Ray-Ban Meta
conectados como auriculares Bluetooth.

## Agregar el Connect IQ Mobile SDK

El SDK de Garmin **no está en Maven**. Hay que descargarlo y agregarlo a mano:

1. Bajá el **Connect IQ Mobile SDK** (Android) de
   <https://developer.garmin.com/connect-iq/sdk/>.
2. Copiá `connectiq.aar` a `app/libs/`.
3. En `app/build.gradle`, descomentá:
   ```gradle
   implementation files('libs/connectiq.aar')
   ```

## Requisitos en el celular

- **Garmin Connect Mobile** instalada y con el reloj emparejado (el SDK se
  comunica a través de ella).
- El `APP_ID` en `MainActivity.java` debe coincidir con el `id` del `manifest.xml`
  del data-field.

## Compilar y correr

```bash
cd companion-android
./gradlew installDebug      # con un Android conectado por USB
```

Abrí la app, dejala en primer plano, emparejá los Ray-Ban como auriculares y
salí a correr. Cuando el reloj mande una frase, la vas a escuchar.

## Por qué la app es tan simple

Toda la decisión de *qué* y *cuándo* hablar vive en el reloj (`Narrator` en
`GhostModel.mc`), que es código portado del motor Python ya testeado. Acá solo
recibimos `{"say": "..."}` y lo pasamos a TTS. Así, la parte que no se puede
testear sin hardware queda lo más chica posible.

## No testeado

No se compiló en el entorno donde se generó (sin Android SDK ni el aar de
Garmin). El primer `gradlew installDebug` en tu máquina es el smoke test real.
