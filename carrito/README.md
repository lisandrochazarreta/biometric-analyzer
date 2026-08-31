# Agente de carrito de supermercado por WhatsApp

Le escribís por WhatsApp *"para la semana: leche, café, 2 kg de papa y algo para
el asado"*, y el agente busca los productos en el supermercado que tengas
elegido, arma el carrito y te devuelve un link para abrirlo, revisar y pagar.

**No compra ni paga nada.** Arma el carrito y te pasa el link; el pago y la
elección de envío los hacés vos en la web de la cadena. Es a propósito: no
quiero que un malentendido en un chat termine en un pedido de $80.000.

## Sobre "la API de Coto"

Coto **no tiene una API pública para terceros**, ni Coto ni ninguna otra cadena
argentina. Lo que sí existe, y es lo que usa este proyecto, son los endpoints
públicos que consume su propia tienda online, que corre sobre **VTEX**:

| Para qué | Endpoint |
|---|---|
| Buscar productos | `GET /api/catalog_system/pub/products/search?ft=leche` |
| Total real con promos y stock | `POST /api/checkout/pub/orderForms/simulation` |
| Link con el carrito cargado | `GET /checkout/cart/add?sku=..&qty=..&seller=..` |

No piden API key y son los mismos que ves en la pestaña Network del navegador.
La contra: no son un contrato estable. Si una cadena cambia de host o de
plataforma, esto se rompe sin aviso — por eso hay un comando `probe` para
verificar en 10 segundos qué sigue andando, y `STORES_FILE` para arreglar hosts
sin tocar código.

Como todas las cadenas de abajo están sobre VTEX, el mismo adaptador las cubre a
todas y podés cambiar de super en la misma conversación:

`coto` · `jumbo` · `disco` · `vea` · `carrefour` · `dia` · `masonline` (ChangoMás)

Cada supermercado tiene su propio carrito: si cambiás de tienda, lo que tenías
en la anterior queda guardado ahí.

> **La Anónima** no está: su tienda no es VTEX y necesitaría un adaptador propio.

## Empezar

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Antes que nada, fijate qué tiendas responden hoy desde tu conexión:

```bash
python -m carrito.cli probe
```

Para cada tienda imprime si el catálogo contesta, tres productos con precio, si
la simulación de total funciona y un link de carrito de ejemplo. Si una tienda
falla, ver *"Cuando una tienda deja de responder"* más abajo.

Después, probá el agente sin WhatsApp de por medio (necesita `ANTHROPIC_API_KEY`
en `.env`):

```bash
python -m carrito.cli chat
```

```
vos > necesito leche descremada y un kilo de café
bot > Te agregué:
      • Leche Descremada La Serenísima 1L — $1.450,50
      • Café Molido La Virginia 500g x2 — $8.900,00
      ¿Va así o cambiamos algo?
vos > dale, cerralo
bot > Listo. Total estimado $10.350,50
      Abrí el carrito acá: https://www.cotodigital.com.ar/checkout/cart/add?sku=...
```

## Conectarlo a WhatsApp

Hay dos caminos. **Twilio** es el más rápido para probar hoy; **Meta** es el que
conviene si lo vas a dejar andando.

### Opción A — Twilio (sandbox, 10 minutos)

1. Creá una cuenta en Twilio y entrá a *Messaging → Try it out → WhatsApp sandbox*.
2. Mandá desde tu celular el código que te muestran (`join <dos-palabras>`) al
   número del sandbox (`+1 415 523 8886`). Eso te habilita 72 horas de ida y
   vuelta, renovables.
3. Completá en `.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_WHATSAPP_FROM=+14155238886`, y tu número en `ALLOWED_NUMBERS`
   (formato `+5491133334444`).
4. Levantá el server y exponelo:

   ```bash
   uvicorn carrito.server:app --port 8000
   ngrok http 8000        # en otra terminal
   ```

5. Poné esa URL de ngrok en `PUBLIC_URL` (sin barra final) y reiniciá el server.
   La firma de Twilio se valida contra esa URL exacta: si no coincide, el
   webhook devuelve 403.
6. En la config del sandbox, *When a message comes in*:
   `https://<tu-ngrok>.ngrok.app/webhook/twilio`, método POST.

Escribile al número del sandbox y listo.

### Opción B — Meta WhatsApp Cloud API

1. Creá una app en developers.facebook.com, agregá el producto *WhatsApp* y
   anotá el **Phone number ID** y un **token** de acceso.
2. En `.env`: `WHATSAPP_PROVIDER=meta`, `META_TOKEN`, `META_PHONE_NUMBER_ID`,
   `META_APP_SECRET` (para validar la firma) y `META_VERIFY_TOKEN` (una frase
   que inventes vos).
3. Configurá el webhook apuntando a `https://tu-dominio/webhook/meta` con ese
   mismo verify token, y suscribite al campo `messages`. El handshake `GET` ya
   está implementado.

El token de prueba de Meta dura 24 horas; para algo permanente necesitás un
token de sistema.

## Seguridad

- **`ALLOWED_NUMBERS` no es opcional.** Si está vacío, el server rechaza todo y
  loguea el número que intentó escribir, para que lo copies al `.env`. Sin eso,
  cualquiera que encuentre tu webhook gasta tus créditos de API.
- Las firmas de Twilio (`X-Twilio-Signature`) y de Meta (`X-Hub-Signature-256`)
  se validan siempre que estén configuradas las credenciales.
- Los webhooks se deduplican por ID de mensaje: los dos proveedores reintentan.
- El agente no tiene ninguna herramienta que pague, confirme un pedido o toque
  datos de tarjeta. El link es el final del camino.

## Comandos

```bash
python -m carrito.cli probe                    # ¿qué tiendas responden hoy?
python -m carrito.cli buscar leche --tienda jumbo
python -m carrito.cli chat                     # REPL local contra el agente
python -m carrito.cli carrito                  # ver el carrito guardado
uvicorn carrito.server:app --port 8000         # el webhook
python -m unittest discover -s tests           # tests (no tocan la red)
```

Dentro del chat, `/reset` borra el historial de la conversación (el carrito
queda).

## Cuando una tienda deja de responder

`probe` dice "sin resultados" o "ERROR" para una tienda:

1. Abrí la web de esa cadena en Chrome, DevTools → **Network** → filtro `Fetch/XHR`,
   y buscá algo en su buscador.
2. Mirá la request del catálogo. Si sigue siendo VTEX, vas a ver
   `/api/catalog_system/pub/products/search?ft=...`. Anotá el **host** real y,
   si aparece, el parámetro `sc` (sales channel).
3. Creá un `stores.json` y apuntá `STORES_FILE` a él en `.env`:

   ```json
   {
     "coto": { "host": "www.cotodigital3.com.ar", "sales_channel": "1" },
     "nuevo_super": { "name": "Otro Super", "host": "www.otro.com.ar" }
   }
   ```

4. Volvé a correr `probe`.

Si la cadena ya no usa VTEX, ahí sí hace falta un adaptador nuevo: la interfaz a
implementar es `search`, `get_by_sku`, `simulate` y `cart_url` (mirá
`carrito/vtex.py`).

## Cómo está armado

```
carrito/
├── config.py     # .env -> Config
├── stores.py     # registro de supermercados (+ overrides por JSON)
├── vtex.py       # catálogo, simulación de total y link de carrito
├── storage.py    # SQLite: carrito, tienda activa, historial, dedupe
├── agent.py      # Claude + las 8 herramientas del agente
├── whatsapp.py   # proveedores Twilio y Meta (parseo, firma, envío)
├── server.py     # webhook FastAPI
└── cli.py        # probe / buscar / chat / carrito
```

El agente corre un loop de tool use contra `claude-opus-5` con estas
herramientas: `buscar_producto`, `agregar_al_carrito`, `ver_carrito`,
`modificar_cantidad`, `vaciar_carrito`, `finalizar_carrito`,
`listar_supermercados` y `cambiar_supermercado`.

El webhook contesta 200 enseguida y procesa en background: armar un carrito de
varios productos lleva varios segundos y los dos proveedores reintentan si el
webhook tarda.

Cada usuario se identifica por su número de WhatsApp. El historial se guarda
como texto plano (usuario/asistente) y se recorta a los últimos `HISTORY_TURNS`
turnos; los intercambios de herramientas viven solo mientras dura el turno.

## Limitaciones

- **Los endpoints de las tiendas no están verificados contra producción desde
  donde se escribió esto** (el entorno no tenía salida a `cotodigital.com.ar` ni
  al resto). La lógica de parseo, carrito, firmas y el loop del agente sí están
  cubiertos por tests. `probe` en tu máquina es el verdadero smoke test.
- Solo texto: audios e imágenes se responden con un mensaje pidiendo texto.
- Precios y stock son los del momento de la consulta; pueden cambiar cuando
  abrís el link.
- Un proceso, SQLite local. Si lo escalás a varios workers, mové el estado a
  Postgres.
