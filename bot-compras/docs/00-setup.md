# Setup — de cero a andando

Tiempo real: **~25 minutos**, casi todo copiar y pegar. Seguí el orden.

---

## 0. Lo que ya está hecho

- ✅ El Google Sheet **[Compras Casa](https://docs.google.com/spreadsheets/d/1Boax5fBBasvYdIy2AEmVhaNonSUGq1jB0IvMbxdEDfA/edit)**
  está creado en tu Drive, con las 5 hojas y el catálogo sembrado con 56 ítems.
- ✅ Los 3 workflows están generados en `workflows/*.json`, listos para importar.
- ✅ La lógica está testeada (`npm run check`).

Falta lo que necesita ser vos: crear el bot, pegar credenciales, importar.

---

## 1. Crear el bot en Telegram — 2 min

En Telegram, hablale a **@BotFather**:

```
/newbot
→ nombre:    Compras Casa
→ usuario:   compras_casa_lisandro_bot     (tiene que terminar en "bot")
```

Te devuelve un token tipo `8123456789:AAH...`. **Guardalo**, va en el paso 3.

Después, **en el mismo chat con BotFather**, el paso que la gente saltea y hace
que el bot parezca roto:

```
/setprivacy
→ elegí tu bot
→ Disable
```

Sin esto, **en un grupo el bot solo recibe mensajes que empiezan con `/`**.
Escribís "leche" y no pasa nada. Es el error nº 1 de los bots de Telegram.

Opcional pero lindo: `/setcommands` y pegá

```
lista - Ver lo que hay anotado
borrar - Sacar un ítem
ayuda - Cómo usarme
deshacer - Revertir mi último cambio
```

---

## 2. Armar el grupo — 1 min

1. Creá un grupo de Telegram con tu novia.
2. Agregá al bot al grupo.
3. Escribí cualquier cosa en el grupo.

Ahora necesitás **3 números**: el `chat_id` del grupo y los `user_id` de cada
uno. En vez de leer JSON a mano, corré el diagnóstico:

```bash
cd bot-compras
node tools/diagnostico.js 8123456789:AAH...
```

Te chequea el token, te dice si el **privacy mode** quedó mal, y te imprime los
ids listos para pegar en `Config`:

```
   grupo_chat_id          -1001234567890
   persona_1_user_id      111222333
   persona_1_nombre       Lisandro
   persona_2_user_id      444555666
   persona_2_nombre       Flor
```

Si dice que no vio mensajes, escriban algo en el grupo **los dos** y corrélo de
nuevo. Si dice que hay un webhook activo, desactivá `compras-ingesta` en n8n
primero (Telegram no deja usar webhook y `getUpdates` al mismo tiempo).

## 3. Completar la hoja `Config` — 3 min

En el Sheet, pestaña **Config**, completá las filas marcadas en naranja:

| clave | valor |
|---|---|
| `grupo_chat_id` | `-1001234567890` |
| `persona_1_user_id` | tu id |
| `persona_1_nombre` | Lisandro |
| `persona_2_user_id` | el id de ella |
| `persona_2_nombre` | su nombre |
| `ciclo_activo` | el mes en que van a comprar, ej `2026-10` |

Y **agregá una fila nueva**:

| clave | valor |
|---|---|
| `telegram_bot_token` | `8123456789:AAH...` |

> **Por qué el token va en el Sheet y no en una credencial de n8n:** los teclados
> inline son de largo variable, y el nodo nativo de Telegram los define como
> configuración estática — no se pueden armar en runtime. Así que los mensajes
> salen por `HTTP Request`, y la API de Telegram solo acepta el token en la URL.
> Ponerlo en `Config` lo mantiene fuera del JSON del workflow y fuera de git.
> El Sheet es privado, igual que tus credenciales de n8n. Si preferís, podés
> hardcodearlo en los 4 nodos HTTP que arman la URL.

---

## 4. Credenciales en n8n — 5 min

Tres, y solo la primera tiene vuelta:

1. **Google Sheets OAuth2** (`googleSheetsOAuth2Api`) — con tu cuenta de
   Workspace. Es la que usan todos los nodos de Sheets vía HTTP Request.
   Si nunca la creaste en este n8n: necesitás un proyecto en Google Cloud con
   la Sheets API habilitada y un OAuth Client ID (Web), con la redirect URI que
   te muestra n8n. Es el paso más largo de todo el setup.
2. **Telegram** (`telegramApi`) — el token del paso 1. La usa el Telegram Trigger.
3. **Header Auth** (`httpHeaderAuth`) × 2:
   - `Gemini API Key` → Name: `x-goog-api-key`, Value: tu key de
     [Google AI Studio](https://aistudio.google.com/apikey) (free tier).
   - `Groq API Key` → Name: `Authorization`, Value: `Bearer gsk_...` de
     [console.groq.com](https://console.groq.com) (free tier). Solo si querés audios.

---

## 5. Importar los workflows — 2 min

En n8n: **Workflows → ⋯ → Import from File**, uno por uno:

| Archivo | Qué hace |
|---|---|
| `workflows/compras-ingesta.json` | Recibe mensajes. 17 nodos. |
| `workflows/compras-mensual.json` | Cron del día 1. 9 nodos. |
| `workflows/compras-errores.json` | Te avisa si algo falla. 4 nodos. |

Después de importar, **asigná las credenciales** (n8n las marca en rojo):

- Todos los nodos HTTP que apuntan a `sheets.googleapis.com` → *Google Sheets OAuth2*
- `Telegram Trigger` → *Telegram*
- `Gemini` → *Header Auth: Gemini API Key*
- `Transcribir (Groq Whisper)` → *Header Auth: Groq API Key*

Los nodos que apuntan a `api.telegram.org` **no llevan credencial**: el token
viene de `Config`.

Por último, en `compras-ingesta` y `compras-mensual`:
**Settings → Error Workflow → `compras-errores`**.

---

## 6. Prender y probar — 3 min

1. Activá `compras-ingesta` (toggle arriba a la derecha).
2. En el grupo escribí: **`ayuda`**

Si responde el texto de ayuda, el camino completo funciona: Telegram → n8n →
Sheets → Telegram.

Después probá esta secuencia, que ejercita todo:

| Escribís | Esperás |
|---|---|
| `leche` | "✅ Anoté: Leche" y una fila nueva en la hoja |
| `papel higiénico x2` | "✅ Anoté: Papel higiénico x2" |
| `2 litros de leche` | "🔁 Ya estaban, sumé: Leche → ahora 3" (no una fila nueva) |
| `detergente y esponjas` | dos ítems de una |
| `lista` | la lista agrupada, con un ✅ por ítem |
| *(tocás un ✅)* | el ítem queda `comprado` en la hoja |
| `borrar leche` | "🗑️ Saqué Leche" |
| `jajaja` | "No pude sacar ítems de eso 🤔" |
| `hilo dental` | acá recién se llama a Gemini |

3. Activá `compras-mensual`. Para probarlo sin esperar al día 1, cambiá el cron
   a `*/5 * * * *`, mirá que llegue el mensaje, y **volvelo a `0 9 1 * *`**.

---

## 7. Cuando algo no anda

| Síntoma | Causa casi segura |
|---|---|
| El bot no reacciona en el grupo | Privacy mode. Volvé al paso 1: `/setprivacy` → Disable, y **sacá y volvé a agregar el bot al grupo**. |
| Reacciona a `/lista` pero no a `lista` | Lo mismo. |
| "Ese ítem ya estaba marcado" siempre | El `chat_id` o los `user_id` de `Config` no coinciden. Revisá `getUpdates`. |
| No responde nada, ni error | El remitente no está en la allowlist: es silencio a propósito. Mirá la ejecución en n8n. |
| `401` en los nodos de Sheets | La credencial de Google no tiene la Sheets API habilitada. |
| `400 Bad Request: chat not found` | El token de `Config` tiene un espacio o le falta un pedazo. |
| `parse_mode` error de Telegram | Un ítem tiene `<` o `&` en el nombre. Es un bug: avisame y lo escapo. |

**Antes de revisar nada a mano, corré el diagnóstico:**

```bash
node tools/diagnostico.js <TOKEN>
```

Chequea las 5 cosas que rompen un bot recién armado: token inválido, privacy
mode activado, webhook no registrado, updates encolados porque n8n no responde,
y errores de entrega (típicamente certificado vencido). Con `--enviar
--chat=<id>` además manda un mensaje de prueba al grupo.

---

## 8. Costo real

| Componente | Costo |
|---|---|
| Telegram | USD 0 — sin límite, sin ventana de 24 h, sin templates |
| Gemini Flash (free tier) | USD 0 — y solo se llama cuando el diccionario falla |
| Groq Whisper (free tier) | USD 0 |
| Google Sheets | USD 0 |
| n8n | ya lo estás pagando |
| **Total** | **USD 0.00 / mes** |

Si algún día te pasás del free tier de Gemini, poné `usar_ia = false` en `Config`
y el bot sigue andando solo con el diccionario. No se rompe nada: los mensajes
que no entienda te los devuelve para que los escribas más simple.

---

## Apéndice — qué se puede hacer desde el celular

| Paso | Celular | Por qué |
|---|---|---|
| 1. Crear el bot en BotFather | ✅ **mejor que en la compu** | BotFather es un chat de Telegram |
| 1b. `/setprivacy` → Disable | ✅ | ídem |
| 2. Crear el grupo y agregar el bot | ✅ | ídem |
| 2b. Sacar los 3 ids | ✅ | ver abajo, sin terminal |
| 3. Completar la hoja `Config` | ✅ | la app de Google Sheets edita celdas bien |
| 4. Credencial de Google en n8n | ❌ | Google Cloud Console en el celular es inusable |
| 5. Importar los workflows en n8n | ❌ | el editor de n8n es un canvas de escritorio |
| 6. Activar y probar | ✅ | es un toggle, y después escribís en el grupo |
| `tools/diagnostico.js` | ⚠️ | necesita Node. En Android anda con Termux; en iOS no |

**Resumen: los pasos 4 y 5 necesitan una compu, unos 15 minutos.** Todo el resto
lo hacés desde el teléfono, y de hecho es más cómodo ahí.

### Sacar los ids sin terminal

**Opción A — desde el navegador del celular.** Abrí:

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Te devuelve JSON crudo. Usá *Buscar en la página*:

- Buscá `"id":-` → el número negativo que sigue es el **`grupo_chat_id`**.
- Buscá `"is_bot":false` → el `"id"` que está unas palabras antes, en el mismo
  bloque `"from"`, es el **`user_id`** de esa persona.

Que escriban los dos en el grupo antes, y refrescá.

**Opción B — con un bot que te lo dice.** Agregá **@RawDataBot** al grupo: postea
un mensaje con el `chat_id` y tu `user_id` a la vista, sin JSON. Sacalo del grupo
apenas lo anotaste.

> Es un bot de terceros: mientras esté en el grupo ve lo que se escribe. Para un
> grupo recién creado y vacío no es gran cosa, pero si preferís no sumar a nadie,
> usá la opción A.

**Opción C — revisá el `getMe` también.** Abrí
`https://api.telegram.org/bot<TOKEN>/getMe` y buscá
`can_read_all_group_messages`. Si dice `false`, el privacy mode quedó activado y
el bot va a ignorar todo lo que no empiece con `/`. Es el mismo chequeo que hace
`tools/diagnostico.js`, pero desde el navegador.

### Un atajo para el paso 4

En vez de OAuth2, la credencial de Google Sheets en n8n también acepta
**Service Account**: creás una en Google Cloud, bajás el JSON de la key, lo
pegás en n8n, y **compartís el Sheet con el email de la service account** (el
que termina en `.iam.gserviceaccount.com`) con permiso de Editor.

Es más simple que OAuth porque **no hay pantalla de consentimiento ni redirect
URI**, que es justamente la parte que se rompe en el celular. Y para un bot que
corre solo es mejor: no queda atado a tu sesión personal ni se vence cuando
cambiás la contraseña.
