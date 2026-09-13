> **Archivado.** Este es el diseño para WhatsApp, que se descartó a favor de
> Telegram (ver [`01-arquitectura.md`](01-arquitectura.md) § Decisión 1). Queda
> como registro de la comparación y por si algún día el número deja de ser un
> problema. **No describe lo que está implementado.**

# Workflow 1 — `compras-ingesta` (nodo por nodo)

Trigger: webhook de WhatsApp. Corre una vez por mensaje entrante.

**Settings del workflow**: `Timezone = America/Argentina/Buenos_Aires`,
`Error Workflow = compras-errores`, `Save failed executions = true`.

---

### 1. `WhatsApp Trigger`

- Tipo: `WhatsApp Trigger` (n8n nativo).
- Credencial: *WhatsApp OAuth/App* con el **System User token permanente** y el
  `Phone Number ID`.
- Evento: `messages`.
- Copiá la Production URL al campo *Callback URL* de Meta (App → WhatsApp →
  Configuration) y suscribí el campo `messages`. El *Verify Token* lo genera n8n.

> Con Twilio: reemplazá por `Webhook` (POST, form-urlencoded). Meta manda JSON
> anidado, Twilio manda `From`/`Body` planos. El nodo 2 absorbe la diferencia.

### 2. `Code` — "Parsear entrada"

Normaliza el payload a una forma propia para que el resto del workflow no
dependa del proveedor.

```js
const out = [];
for (const item of $input.all()) {
  const entry = item.json?.entry?.[0] ?? item.json;
  const value = entry?.changes?.[0]?.value ?? entry;
  const msg   = value?.messages?.[0];
  if (!msg) continue;                       // statuses (delivered/read) → ignorar

  const perfil = value?.contacts?.[0]?.profile?.name ?? '';
  out.push({ json: {
    wamid:  msg.id,
    from:   msg.from,                        // 549XXXXXXXXXX
    nombre: perfil,
    tipo:   msg.type,                        // text | audio | image | ...
    texto:  msg.text?.body ?? '',
    audio_id: msg.audio?.id ?? null,
    ts:     new Date(Number(msg.timestamp) * 1000).toISOString(),
  }});
}
return out;
```

> Importante: el webhook de Meta también dispara con eventos de estado
> (`statuses`). Si no los filtrás acá, el bot se responde a sí mismo en loop.

### 3. `If` — "Remitente permitido"

- Condición: `{{ $json.from }}` **is in list** `{{ $env.BOT_ALLOWED_NUMBERS.split(',') }}`
  (o compará contra dos variables `BOT_NUM_1` / `BOT_NUM_2`).
- Rama **false** → `Google Sheets: append en Log` con `resultado = rechazado` →
  `NoOp`. **No respondas nada**: si contestás, un número random sabe que hay un
  bot vivo del otro lado.

### 4. `Google Sheets` — "¿wamid procesado?"

- Operación: `Get row(s) in sheet`, hoja `Log`, filtro `wamid = {{ $json.wamid }}`,
  `Return all = false`, `Limit = 1`.
- `Always Output Data = true` (si no, la rama muere cuando no encuentra nada).

### 5. `If` — "Duplicado"

- Condición: `{{ $json.wamid }}` **is not empty** (viene del nodo 4).
- **true** → `NoOp` (ya lo procesamos; Meta reintenta el webhook si tardás >20 s
  en responder 200, y sin esto te duplica cada ítem).
- **false** → sigue.

### 6. `Switch` — "Tipo de mensaje"

Sobre `{{ $('Parsear entrada').item.json.tipo }}`:

- `text` → salida 0
- `audio` → salida 1
- *fallback* → salida 2

### 6b. Rama audio (opcional, ver doc 07)

- **`HTTP Request` "Media URL"**: `GET https://graph.facebook.com/v21.0/{{ $json.audio_id }}`,
  header `Authorization: Bearer <token>`. Devuelve `{ url, mime_type }`.
- **`HTTP Request` "Descargar audio"**: `GET {{ $json.url }}`, mismo header,
  `Response Format = File`, campo binario `data`.
  (La URL de Meta expira en ~5 min y **exige** el header de auth.)
- **`HTTP Request` "Transcribir"**: `POST https://api.openai.com/v1/audio/transcriptions`,
  `Content-Type: multipart/form-data`, campos: `file` = binario `data`,
  `model` = `whisper-1`, `language` = `es`, `prompt` = `Lista de compras de
  supermercado en Argentina: leche, yerba, fideos, lavandina, papel higiénico.`
  (ese prompt mejora muchísimo el reconocimiento de marcas y productos locales).
- **`Set`**: `texto = {{ $json.text }}`.
- **`If` "Transcripción vacía"** → responder *"No pude escuchar bien el audio,
  ¿me lo escribís?"* y cortar.

### 6c. Rama otro tipo

- `WhatsApp Business Cloud` → *Send message* → *"Por ahora solo entiendo texto y
  audios 🙂 Escribime el ítem o mandame un audio cortito."* → `NoOp`.

### 7. `Merge` — "Texto unificado"

Modo `Append`. Junta la salida de texto y la de audio en una sola rama con el
campo `texto` poblado.

### 8. `Google Sheets` + `If` — "¿Hay envío mensual pendiente?"

- Lee `Config`, busca `envio_pendiente_<from>`.
- Si es `true`: `WhatsApp Send` con el texto guardado en `Config.ultimo_mensaje_mensual`
  y poné el flag en `false`. Después seguí procesando el mensaje normalmente
  (la persona respondió al ping, probablemente con un ítem real).

### 9. `Google Sheets` — "Registrar inbound"

`Update` en `Config`: `ultimo_inbound_<from> = {{ $json.ts }}`. Es lo que
alimenta la decisión de ventana de 24 h del workflow 2.

### 10. `Code` — "Router de comandos"

```js
const raw = $json.texto ?? '';
const t = raw.trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');   // saca tildes

const reglas = [
  [/^(lista|ver lista|que hay|mostrar|mostrame la lista)$/,      'lista'],
  [/^(ayuda|help|comandos|\?)$/,                                  'ayuda'],
  [/^(deshacer|undo)$/,                                           'deshacer'],
  [/^confirmar reset$/,                                           'reset_confirmado'],
  [/^reset$/,                                                     'reset'],
  [/^(borrar|sacar|quitar|eliminar|no va|cancelar)\s+(.+)$/,      'borrar'],
  [/^(ya compre|compre|ya esta|listo|compramos)(\s+(.+))?$/,      'comprado'],
];

for (const [re, nombre] of reglas) {
  const m = t.match(re);
  if (m) return [{ json: { ...$json, comando: nombre, argumento: (m[2] ?? m[3] ?? '').trim() } }];
}
return [{ json: { ...$json, comando: null, argumento: '' } }];
```

### 11. `Switch` — "Comando o ítem"

Una salida por comando + fallback a la rama IA. El detalle de cada rama está en
el doc 06.

---

## Rama IA (el corazón)

### 12. `Google Sheets` — "Leer lista actual"

- `Get row(s)`, hoja `Lista`, filtros: `estado = pendiente`.
- `Return all = true`.

### 13. `Google Sheets` — "Leer catálogo"

- `Get row(s)`, hoja `Catalogo`, `Return all = true`.
- Es la memoria de dedup a largo plazo: si el mes pasado aprendió que
  *"papel"* = *"Papel higiénico"*, este mes no falla.

### 14. `Code` — "Armar contexto"

Comprime todo a lo mínimo indispensable para no pagar tokens de más.

```js
const lista = $('Leer lista actual').all()
  .map(i => ({ id: i.json.id, item: i.json.item, cant: i.json.cantidad,
               un: i.json.unidad, cat: i.json.categoria }))
  .filter(r => r.id);

const catalogo = $('Leer catálogo').all()
  .map(i => ({ item: i.json.item_canonico, cat: i.json.categoria,
               alias: (i.json.alias || '').split(',').map(s => s.trim()).filter(Boolean) }))
  .filter(r => r.item)
  .sort((a, b) => (b.frecuencia ?? 0) - (a.frecuencia ?? 0))
  .slice(0, 120);                       // techo de tokens

return [{ json: {
  ...$('Router de comandos').item.json,
  lista_json: JSON.stringify(lista),
  catalogo_json: JSON.stringify(catalogo),
}}];
```

### 15. `Basic LLM Chain` (o `Message a model`) — "Normalizar"

- Modelo: `claude-haiku-4-5-20251001` (o Gemini Flash si querés free tier).
- `Temperature = 0`, `Max tokens = 800`.
- **System**: el prompt completo del doc 03.
- **User**: `{{ $json.texto }}`.
- Conectá un `Structured Output Parser` con el JSON Schema de
  `03-prompt-normalizacion.md` §Schema. Activá `Auto-fix` (reintenta con el error
  de validación si el modelo devuelve algo mal formado).
- En el nodo: `Retry on Fail = true`, `Max tries = 2`.

### 16. `Code` — "Validar salida"

```js
const r = $json.output ?? $json;
const CATS = ['almacén','lácteos','limpieza','higiene','bebidas','frescos','otros'];

if (r.tipo !== 'items' || !Array.isArray(r.items) || r.items.length === 0) {
  return [{ json: { ok: false, tipo: r.tipo ?? 'no_entendido',
                    respuesta: r.respuesta_usuario ??
                      'No pude sacar ítems de ese mensaje. Escribí "ayuda" para ver qué entiendo.' } }];
}

const items = r.items
  .filter(i => i.item && String(i.item).trim().length > 1)
  .filter(i => (i.confianza ?? 1) >= 0.4)
  .slice(0, 15)                                        // cortafuegos anti-delirio
  .map(i => ({
    ...i,
    item: String(i.item).trim(),
    cantidad: Number.isFinite(+i.cantidad) && +i.cantidad > 0 ? Math.min(+i.cantidad, 99) : 1,
    unidad: i.unidad || 'u',
    categoria: CATS.includes(i.categoria) ? i.categoria : 'otros',
    accion: i.id_existente ? 'sumar_a_existente' : 'agregar',
  }));

if (!items.length) {
  return [{ json: { ok: false, tipo: 'no_entendido',
                    respuesta: 'No pude sacar ítems de ese mensaje.' } }];
}
return items.map(i => ({ json: { ok: true, ...i, _meta: $('Armar contexto').item.json } }));
```

> Este nodo es el que te salva de que un día el modelo devuelva `cantidad: 400`
> o una categoría inventada y te ensucie la hoja. Nunca confíes en la salida del
> LLM sin pasarla por acá.

### 17. `Switch` — "Acción"

Sobre `{{ $json.accion }}`: `sumar_a_existente` / `agregar`.

### 18a. `Google Sheets` — "Sumar a existente"

- Operación `Update`, hoja `Lista`, *Column to match on*: `id`.
- Campos: `cantidad = {{ $json.cantidad_nueva }}` (calculada en el nodo 16 como
  `existente + nuevo`), `variantes` = concatenar el texto original,
  `pedido_por` = agregar el nombre si no estaba.

### 18b. `Google Sheets` — "Agregar ítem"

- Operación `Append`, hoja `Lista`. Mapeo:

| Columna | Valor |
|---|---|
| `id` | `{{ $now.toMillis() }}-{{ Math.random().toString(36).slice(2,8) }}` |
| `ciclo` | `{{ $('Leer config').item.json.ciclo_activo }}` |
| `item` | `{{ $json.item }}` |
| `variantes` | `{{ $json.texto_original }}` |
| `cantidad` | `{{ $json.cantidad }}` |
| `unidad` | `{{ $json.unidad }}` |
| `categoria` | `{{ $json.categoria }}` |
| `pedido_por` | `{{ $json._meta.nombre }}` |
| `fecha_alta` | `{{ $now.toISO() }}` |
| `estado` | `pendiente` |
| `veces_arrastrado` | `0` |
| `wamid_origen` | `{{ $json._meta.wamid }}` |

### 19. `Google Sheets` — "Actualizar catálogo" (opcional pero vale la pena)

`Append or Update` en `Catalogo` matcheando `item_canonico`: suma 1 a
`frecuencia` y agrega `texto_original` a `alias` si no estaba. Cada mes que pasa
el bot deduplica mejor y el prompt necesita menos ejemplos.

### 20. `Code` + `WhatsApp` — "Confirmar"

Agregá todos los ítems del mensaje en **una sola** respuesta (no un mensaje por
ítem):

```js
const items = $input.all().map(i => i.json);
const nuevos  = items.filter(i => i.accion === 'agregar')
                     .map(i => `• ${i.item}${i.cantidad > 1 ? ` x${i.cantidad}` : ''}`);
const sumados = items.filter(i => i.accion === 'sumar_a_existente')
                     .map(i => `• ${i.item} → ahora ${i.cantidad_nueva}`);

let txt = '';
if (nuevos.length)  txt += `✅ Anoté:\n${nuevos.join('\n')}`;
if (sumados.length) txt += `${txt ? '\n\n' : ''}🔁 Ya estaban, sumé:\n${sumados.join('\n')}`;
return [{ json: { respuesta: txt } }];
```

### 21. `Google Sheets` — "Log"

`Append` en `Log`: `ts`, `wamid`, `from`, `tipo`, `texto`, `comando`,
`items_json` (lo que se escribió), `resultado`, `error`. Es lo que hace posible
`deshacer` y lo que vas a mirar cuando algo salga raro.

---

# Workflow 2 — `compras-mensual` (cron)

### 1. `Schedule Trigger`

- Modo `Custom (Cron)`: `0 9 1 * *`.
- **Timezone del workflow en `America/Argentina/Buenos_Aires`** (Settings del
  workflow, no del nodo). Si lo dejás en UTC te llega a las 6 AM.

### 2–4. `Google Sheets` — leer

- `Config` → `ciclo_activo`, números, nombres.
- `Lista` → todo con `estado = pendiente`.
- `Historial` → filas del ciclo anterior.

### 5. `Code` — "Consolidar y comparar"

Ver el script completo en `05-mensaje-mensual.md`. Produce:
`{ texto, ciclo_cerrado, ciclo_nuevo, filas_a_archivar[], filas_a_arrastrar[] }`.

### 6. `Google Sheets` — "Archivar ciclo vencido"

Solo si existe un ciclo anterior sin cerrar: `Append` de esas filas a `Historial`
con `estado = no_comprado` y `cerrado_el = {{ $now.toISO() }}`, después `Delete
rows` de `Lista`.

> Ojo con `Delete rows` de Google Sheets en n8n: borra **por número de fila**, y
> los índices se corren con cada borrado. Ordená descendente por fila antes de
> borrar, o —más simple y lo que recomiendo— no borres: marcá `estado =
> archivado` y filtrá siempre por estado. La hoja aguanta miles de filas sin
> despeinarse.

### 7. `Google Sheets` — "Arrastrar pendientes"

`Append` en `Lista` de los pendientes que siguen vivos, con
`ciclo = <nuevo>`, `veces_arrastrado + 1`, `origen = arrastre`.
Los que llegan a `veces_arrastrado = 3` no se arrastran (van al mensaje como
"los saqué, avisame si los seguís necesitando").

### 8. `Google Sheets` — "Abrir ciclo nuevo"

`Update` en `Config`: `ciclo_activo = {{ $json.ciclo_nuevo }}`.

### 9. `Code` — "Destinatarios"

Devuelve 2 items, uno por persona, con su `ultimo_inbound`.

### 10. `If` — "¿Ventana de 24 h abierta?"

`{{ $now.diff($json.ultimo_inbound, 'hours').hours }}` **< 23**
(margen de 1 h para no arriesgar el borde).

- **true** → `WhatsApp Send message` (texto libre, gratis).
- **false** → `WhatsApp Send template` `lista_mensual_v1` con
  `{{1}} = octubre` + `Google Sheets Update` de
  `envio_pendiente_<persona> = true` y `ultimo_mensaje_mensual = <texto>`.

### 11. `Code` — "Partir si supera 4096"

WhatsApp corta en 4096 caracteres. Si el texto es más largo, partilo por
categoría y mandá 2 mensajes.

---

# Workflow 3 — `compras-errores`

- `Error Trigger` → `WhatsApp Send` a **tu** número:
  `⚠️ Falló "{{ $json.workflow.name }}" en el nodo {{ $json.execution.lastNodeExecuted }}: {{ $json.execution.error.message }}`
- Seteá este workflow como *Error Workflow* en los settings de los otros dos.
  Sin esto, un token vencido te deja el bot muerto y te enterás dos semanas
  después cuando falte el café.
