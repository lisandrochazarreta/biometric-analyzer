> **Creado.** El Sheet ya existe en tu Drive:
> [Compras Casa](https://docs.google.com/spreadsheets/d/1Boax5fBBasvYdIy2AEmVhaNonSUGq1jB0IvMbxdEDfA/edit).
> Se generó con `tools/build_sheet.py`. Este documento explica por qué cada
> columna está donde está.
>
> **Los nombres y el orden de las columnas de `Lista` son contrato**: el código
> escribe por rango (`Lista!E7`), así que mover una columna rompe las
> escrituras. Si necesitás agregar una, agregala **al final** y actualizá
> `ORDEN_COLS` en `tools/build_workflows.js`.

# Estructura del Google Sheet

Un solo spreadsheet: **"Compras Casa"**. Cinco hojas.

Compartilo con la service account de n8n con permiso de **Editor** (si usás
OAuth con tu cuenta de Workspace, alcanza con que el archivo sea tuyo).

---

## Hoja `Lista` — el estado vivo

Fila 1 = headers exactos (n8n mapea por nombre de columna).

| Columna | Tipo | Ejemplo | Para qué |
|---|---|---|---|
| `id` | texto | `1757740800000-k3x9fa` | Clave única. Es lo que usa el LLM en `id_existente` y n8n en *Update by matching column*. |
| `ciclo` | texto | `2026-10` | Mes en el que se compra. |
| `item` | texto | `Papel higiénico` | Nombre canónico. Lo que se lee en el súper. |
| `variantes` | texto | `papel h \| rollos \| papel` | Todo lo que escribieron para referirse a esto. Alimenta el catálogo. |
| `cantidad` | número | `2` | |
| `unidad` | texto | `u` | `u, kg, g, l, ml, paq, docena` |
| `categoria` | texto | `higiene` | Lista desplegable (validación de datos). |
| `pedido_por` | texto | `Lisandro` | Quién lo pidió. Si lo pidieron los dos: `Lisandro, Flor`. |
| `nota` | texto | `descremada` | Variante/marca/preferencia. |
| `fecha_alta` | fecha ISO | `2026-09-13T14:22:10Z` | |
| `estado` | texto | `pendiente` | `pendiente \| comprado \| descartado \| archivado` |
| `fecha_compra` | fecha ISO | | Se llena con "ya compré". |
| `veces_arrastrado` | número | `0` | Cuántos ciclos viene sin comprarse. |
| `origen` | texto | `mensaje` | `mensaje \| arrastre` |
| `msg_origen` | texto | `4821` | `update_id` de Telegram, para trazar el mensaje original. |

**Cómo marcar comprado — tres caminos, los tres funcionan:**

1. **Desde WhatsApp**: `ya compré` marca todo el ciclo; `ya compré leche y café`
   marca solo esos.
2. **Desde el celular en el súper**: abrís la app de Sheets y cambiás la
   columna `estado` con el desplegable. Es cómodo porque ves la lista y tachás
   en el mismo lugar.
3. **Checkbox** (opcional): si preferís tildar, agregá una columna `ok` de tipo
   checkbox y poné una fórmula/Apps Script que escriba `comprado` en `estado`.
   Yo lo dejaría en el desplegable: una fuente de verdad, menos sincronización.

**Formato condicional recomendado** (Formato → Formato condicional):
- `$K2="comprado"` → texto gris + tachado.
- `$K2="pendiente"` y `$M2>0` (arrastrado) → fondo amarillo suave.
- `$K2="descartado"` → ocultar con filtro.

**Vista filtrada** "Compra del mes": filtro `estado = pendiente`, ordenado por
`categoria`. Es la que abrís en el súper.

---

## Hoja `Historial` — append-only

Mismas columnas que `Lista`, más:

| Columna | Ejemplo | Para qué |
|---|---|---|
| `cerrado_el` | `2026-10-01T12:00:03Z` | Cuándo se cerró el ciclo. |
| `cerrado_por` | `cron` | `cron \| Lisandro \| Flor` |

Nunca se edita a mano. De acá salen la comparación mes a mes y, si algún día te
pinta, un gráfico de gasto por categoría.

**Tabla dinámica útil** (hoja aparte, 2 minutos de setup): filas = `item`,
columnas = `ciclo`, valores = `COUNTA(id)`. Te dice de un vistazo qué comprás
todos los meses y qué pediste una sola vez en tu vida.

---

## Hoja `Catalogo` — la memoria de deduplicación

| Columna | Ejemplo |
|---|---|
| `item_canonico` | `Papel higiénico` |
| `categoria` | `higiene` |
| `alias` | `papel, papel h, rollos, papel higienico` |
| `frecuencia` | `14` |
| `ultima_vez` | `2026-09-02` |

Hoy se siembra con `tools/build_sheet.py` (56 ítems) y se mantiene a mano.
Es lo que hace que el bot deduplique cada vez mejor sin tocar el prompt.
Auto-alimentarla está en "Lo que falta" del README. Podés sembrarla a mano con 30 ítems que sabés que
compran siempre y el bot arranca afinado desde el día 1.

---

## Hoja `Config` — parámetros y estado del bot

Dos columnas: `clave` | `valor`.

| clave | valor |
|---|---|
| `ciclo_activo` | `2026-10` |
| `telegram_bot_token` | `8123456789:AAH...` |
| `grupo_chat_id` | `-1001234567890` |
| `persona_1_user_id` | `111222333` |
| `persona_1_nombre` | `Lisandro` |
| `persona_2_user_id` | `444555666` |
| `persona_2_nombre` | `Flor` |
| `max_arrastres` | `3` |
| `categorias` | `almacén,lácteos,limpieza,higiene,bebidas,frescos,otros` |
| `usar_ia` | `true` |
| `umbral_confianza` | `0.4` |

Tener esto en la hoja y no hardcodeado en n8n significa que cambiás un número de
teléfono sin abrir el editor de workflows.

> Los números de teléfono acá son datos personales: el spreadsheet no se comparte
> con nadie más y las credenciales de la service account viven solo en n8n.

---

## Hoja `Log` — auditoría e idempotencia

| Columna | Para qué |
|---|---|
| `ts` | Timestamp del procesamiento. |
| `update_id` | El id del update de Telegram, para trazar. |
| `from` | Número. |
| `tipo` | `text \| audio \| image \| ...` |
| `texto` | El mensaje crudo (o la transcripción). |
| `comando` | El comando detectado, o vacío. |
| `items_json` | Qué filas se escribieron. **Es lo que permite `deshacer`.** |
| `resultado` | `ok \| rechazado \| no_entendido \| error` |
| `error` | Mensaje de error si hubo. |

Ponele un filtro por fecha y borrá lo de más de 6 meses una vez por año, o
dejalo: 200 filas/mes son 2.400 al año, nada para un Sheet.

---

## Límites que vale la pena conocer

- Un spreadsheet aguanta **10 millones de celdas**. Con ~15 columnas y 200 filas
  por mes, tenés para ~275 años. No es un problema.
- **Google Sheets API: 300 requests/minuto por proyecto, 60 por usuario por
  minuto.** El flujo de ingesta hace 4–6 llamadas por mensaje. Con dos personas
  escribiendo nunca lo vas a tocar, pero si alguna vez ves un `429`, activá
  `Retry on Fail` con `Wait between tries = 3000 ms` en los nodos de Sheets.
- Google Sheets **no tiene transacciones**. Si los dos escriben en el mismo
  segundo exacto, dos `Append` pueden crear dos filas del mismo ítem. Es raro y
  el `id` distinto lo hace visible; el próximo mensaje que mencione ese ítem lo
  deduplica solo. Si te molesta, seteá `Concurrency = 1` en el workflow de
  ingesta (Settings → *Limit concurrent executions*).
