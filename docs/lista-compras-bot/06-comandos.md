# Comandos

Todos se detectan con regex en el Code node "Router de comandos" (doc 02, nodo
10), **antes** de la IA: cuestan cero y no fallan. El LLM además puede devolver
`tipo: "comando"` para frases sueltas ("pasame la lista", "sacá la cerveza"),
que caen en las mismas ramas.

Sin distinción de mayúsculas ni tildes.

---

## `lista`

También: `ver lista`, `qué hay`, `mostrame la lista`.

**Hace**: lee `Lista` (estado `pendiente`), agrupa por categoría, responde.
Mismo formato que el mensaje mensual pero sin las comparaciones.

```
🛒 Lista actual — 9 ítems

🥫 ALMACÉN
• Café x2
• Yerba

🥛 LÁCTEOS
• Leche x4
...

Se manda sola el 1 de octubre.
```

**Nodos**: `Google Sheets Get rows` (filtro `estado=pendiente`) → `Code` (reusá
la función `linea()` del doc 05) → `WhatsApp Send`.

Si está vacía: *"La lista está vacía 🤷 Escribime lo que falte."*

---

## `borrar X`

También: `sacar X`, `quitar X`, `eliminar X`, `no va X`.

**Hace**: busca `X` entre los pendientes con match difuso y marca
`estado = descartado`.

**El matching es lo delicado.** Code node:

```js
const q = norm($json.argumento);
const filas = $('Leer lista').all().map(i => i.json).filter(r => r.estado === 'pendiente');

const exacto  = filas.filter(r => norm(r.item) === q);
const parcial = filas.filter(r => norm(r.item).includes(q) || q.includes(norm(r.item)));
const alias   = filas.filter(r => norm(r.variantes || '').includes(q));

const cands = exacto.length ? exacto
            : (parcial.length ? parcial : alias);

if (cands.length === 0)
  return [{ json: { accion: 'no_encontrado',
    respuesta: `No encontré "${$json.argumento}" en la lista. Escribí *lista* para ver qué hay.` } }];

if (cands.length > 1)
  return [{ json: { accion: 'ambiguo',
    respuesta: `¿Cuál? ${cands.map(c => `*${c.item}*`).join(' o ')}\nEscribí *borrar <nombre completo>*.` } }];

return [{ json: { accion: 'borrar', id: cands[0].id, item: cands[0].item,
    respuesta: `🗑️ Saqué *${cands[0].item}* de la lista.` } }];
```

Nunca borres cuando hay ambigüedad: preguntá. Borrar lo que no era es el error
que más rompe la confianza en el bot.

**No se borra la fila**, se marca `descartado`. Así `deshacer` funciona y el
historial queda intacto.

---

## `ya compré`

También: `compré`, `listo`, `ya está`, `compramos`.

**Dos modos:**

- **`ya compré`** (sin argumento) → cierra el ciclo completo:
  1. Todos los `pendiente` del ciclo más viejo abierto → `estado = comprado`,
     `fecha_compra = now`, `cerrado_por = <quien escribió>`.
  2. `Append` de esas filas a `Historial` con `cerrado_el`.
  3. Marcar esas filas en `Lista` como `archivado` (no las borres, ver doc 04).
  4. `Append or Update` en `Catalogo`: `frecuencia + 1`, `ultima_vez`.
  5. Responder al que escribió: *"✅ Cerré la compra de octubre: 14 ítems.
     Empiezo lista nueva para noviembre."*
  6. **Avisar al otro**: *"Flor cerró la compra de octubre 🛒 (14 ítems).
     Lo que anotes desde ahora va a la de noviembre."*

- **`ya compré leche y café`** (con argumento) → marca solo esos. Pasá el
  argumento por el mismo matcher difuso de `borrar`, ítem por ítem. Respondé
  con lo que marcó y lo que quedó: *"✅ Marqué Leche y Café. Quedan 12."*

> El paso 6 no es decorativo: sin el aviso cruzado, uno de los dos sigue
> anotando cosas creyendo que van a la compra de este mes.

---

## `reset`

**Dos pasos, siempre.** `reset` no hace nada por sí solo:

```
⚠️ Esto borra los 14 ítems de la lista actual sin marcarlos como comprados.
Si estás seguro, escribí: *confirmar reset*
```

`confirmar reset` (regex propio, con ventana de 5 minutos chequeada contra el
`Log`) → marca todo como `descartado`, archiva en `Historial` con
`estado = descartado`, responde *"🧹 Lista vacía. Empezamos de cero."* y avisa
al otro.

Si pasaron más de 5 minutos desde el `reset`: *"Se venció la confirmación,
escribí *reset* de nuevo."*

---

## `ayuda`

También: `help`, `comandos`, `?`.

Texto fijo (hardcodeado en un `Set` node, no gastes un LLM en esto):

```
🤖 *Cómo usarme*

Escribime lo que falta, como te salga:
• "leche"
• "se terminó el café"
• "papel higiénico x2"
• "detergente y esponjas"

*Comandos*
• *lista* — ver lo que hay anotado
• *borrar <ítem>* — sacar algo
• *ya compré* — cerrar la compra del mes
• *ya compré leche, café* — marcar solo esos
• *deshacer* — revertir mi último cambio
• *reset* — vaciar la lista (pide confirmación)

El 1 de cada mes a las 9 les mando la lista completa a los dos.
También entiendo audios 🎤
```

---

## `deshacer` (el que no pediste y más vas a usar)

También: `undo`.

**Hace**: lee la última fila del `Log` **de ese remitente** con
`resultado = ok` y `items_json` no vacío, y revierte:
- ítems agregados → `estado = descartado`
- cantidades sumadas → resta lo que se sumó
- borrados → vuelven a `pendiente`

Responde: *"↩️ Deshice: agregué Leche x2 → lo saqué."*

Solo revierte el **último** cambio y solo dentro de los últimos 30 minutos.
Sin esto, cada vez que el bot interprete mal algo tenés que abrir el Sheet, y
ese es el momento en que un bot de lista de compras deja de usarse.

---

## Resumen para el `Switch` (nodo 11)

| Salida | Comando | Nodos siguientes |
|---|---|---|
| 0 | `lista` | Sheets read → Code formatear → WhatsApp |
| 1 | `borrar` | Sheets read → Code matcher → IF ambiguo → Sheets update → WhatsApp |
| 2 | `comprado` | Sheets read → Code → Sheets update + append Historial + Catalogo → WhatsApp ×2 |
| 3 | `reset` | Code → WhatsApp (pide confirmación) |
| 4 | `reset_confirmado` | Sheets read Log (ventana 5 min) → IF → Sheets update masivo → WhatsApp ×2 |
| 5 | `ayuda` | Set (texto fijo) → WhatsApp |
| 6 | `deshacer` | Sheets read Log → Code revertir → Sheets update → WhatsApp |
| fallback | *(ninguno)* | **Rama IA** |
