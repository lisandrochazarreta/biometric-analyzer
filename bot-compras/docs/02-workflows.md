# Los tres workflows

**No se arman a mano.** Se generan con `npm run build` desde `lib/compras.js`,
que es la única fuente de verdad de la lógica. Si querés cambiar cómo el bot
entiende un mensaje, tocás la librería y regenerás — no editás el JSON ni el
Code node dentro de n8n, porque el próximo build te lo pisa.

```bash
npm run check     # tests + e2e + build + validación del JSON
```

---

## `compras-ingesta` — 17 nodos

Corre una vez por mensaje o por toque de botón.

| # | Nodo | Tipo | Qué hace |
|---|---|---|---|
| 1 | `Telegram Trigger` | telegramTrigger | Escucha `message` y `callback_query`. |
| 2 | `Leer hojas` | HTTP GET | Un `values:batchGet` trae `Lista!A:O`, `Catalogo!A:E` y `Config!A:C`. |
| 3 | `Preparar` | Code | **Todo el cerebro.** Ver abajo. |
| 4 | `Gate: responder` | Code | Pasa solo si hay algo que contestar. |
| 5 | `Responder` | HTTP POST | `sendMessage` con `parse_mode: HTML` y el teclado si corresponde. |
| 6 | `Gate: hay filas nuevas` | Code | Pasa solo si hay `appends`. |
| 7 | `Agregar filas` | HTTP POST | `values/Lista!A:O:append` con todas las filas juntas. |
| 8 | `Gate: hay celdas a actualizar` | Code | Pasa solo si hay `updates`. |
| 9 | `Actualizar celdas` | HTTP POST | `values:batchUpdate` con todas las celdas juntas. |
| 10 | `Gate: necesita IA` | Code | Pasa solo si el diccionario no alcanzó. |
| 11 | `Gemini` | HTTP POST | `gemini-2.5-flash`, `temperature: 0`, respuesta JSON. |
| 12 | `Aplicar IA` | Code | Valida la salida, la fusiona con lo que resolvió el diccionario, recalcula las escrituras. |
| 13 | `Gate: audio` | Code | Pasa solo si el mensaje es una nota de voz. |
| 14 | `Telegram getFile` | HTTP GET | Pide el `file_path`. |
| 15 | `Bajar audio` | HTTP GET | Descarga el `.ogg` como binario. |
| 16 | `Transcribir (Groq Whisper)` | HTTP POST | `whisper-large-v3-turbo`, español, con vocabulario de súper argentino. |
| 17 | `Audio → texto` | Code | Devuelve lo que entendió para que lo confirmes. |

### El nodo `Preparar`

Es el único que decide. En orden:

1. Normaliza el update: un mensaje y un toque de botón salen con la misma forma.
2. **Allowlist.** Si el `user_id` no está en `Config`, devuelve `[]` y **no
   responde nada**. El silencio es a propósito: contestarle a un número
   equivocado confirma que hay un bot activo.
3. Si es un `callback_query` (botón ✅ o 🛒), marca ese ítem o cierra la compra.
4. Si es audio, deriva a la rama de transcripción.
5. Router de comandos por regex.
6. Texto libre → `normalizarLocal()` contra el catálogo.
7. Si resolvió todo → `planificarEscrituras()` decide qué fila es nueva y cuál
   suma a una existente, y arma los rangos `Lista!E7`, `Lista!D7`, etc.
8. Si no → arma el prompt **solo con los fragmentos que no entendió** y marca
   `necesita_ia`.

Sale un único item con todo resuelto: `respuesta`, `teclado`, `appends`,
`updates`, `prompt_ia`. Los nodos que siguen no piensan, solo ejecutan.

### El truco de los "Gate"

Son Code nodes de una línea:

```js
return $input.all().filter(i => (i.json.appends || []).length);
```

Un Code node que devuelve `[]` corta la rama sin ejecutar lo que viene después.
Se usan en lugar de nodos `IF`/`Switch` porque el shape de parámetros de esos
nodos cambia entre `typeVersion`s, y estos workflows se generan sin poder
probarlos contra tu instancia. Un Code node es JS crudo: no tiene ese problema.

---

## `compras-mensual` — 9 nodos

Cron `0 9 1 * *` en `America/Argentina/Buenos_Aires` (está en los settings del
workflow, no del nodo — si lo dejás en UTC te llega a las 6 AM).

```
Día 1, 09:00 → Leer hojas → Leer historial → Consolidar
   ├→ Mandar lista al grupo        (texto + un ✅ por ítem)
   └→ Archivar en Historial → Arrastrar pendientes → Cerrar ciclo
```

`Consolidar` hace todo el cálculo con `consolidar()` de la librería y devuelve,
en un solo item: el texto ya formateado, el teclado, las filas a archivar, las
filas a arrastrar al ciclo nuevo, y las celdas a marcar como `archivado`
(incluyendo el avance de `Config.ciclo_activo`).

> **Nota sobre borrar filas:** el workflow nunca borra. El nodo `Delete rows` de
> Sheets borra por número de fila y los índices se corren con cada borrado, lo
> que es una fuente clásica de corrupción silenciosa. En vez de eso las filas se
> marcan `archivado` y se filtran. La hoja aguanta 10 millones de celdas.

---

## `compras-errores` — 4 nodos

`Error Trigger` → lee `Config` para sacar el token → te manda un mensaje por
Telegram con el workflow, el nodo y el error.

Acordate de asignarlo como **Error Workflow** en los settings de los otros dos.
Sin esto, una credencial vencida deja el bot mudo y te enterás dos semanas
después, cuando falte el café.

---

## Regenerar después de un cambio

```bash
vim lib/compras.js
npm run check
# n8n → el workflow → ⋯ → Import from File → workflows/compras-ingesta.json
```

Importar sobre un workflow existente conserva las credenciales asignadas.
