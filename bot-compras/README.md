# Bot de lista de compras — Telegram + n8n + Google Sheets

Dos personas anotan ítems sueltos por Telegram durante todo el mes ("leche",
"se terminó el café", "papel higiénico x2", "detergente y esponjas"). El bot los
normaliza, deduplica y categoriza en un Google Sheet. El **día 1 de cada mes a
las 9** manda la lista consolidada al grupo, con botones para ir tachando y una
comparación contra el mes anterior.

**No compra nada**: el click final es tuyo.

**Costo: USD 0,00 / mes.**

---

## Estado

| | |
|---|---|
| Google Sheet | ✅ [creado en tu Drive](https://docs.google.com/spreadsheets/d/1Boax5fBBasvYdIy2AEmVhaNonSUGq1jB0IvMbxdEDfA/edit), 5 hojas, catálogo sembrado con 56 ítems |
| Lógica | ✅ `lib/compras.js` — 37 tests unitarios + 16 end-to-end, todos verdes |
| Workflows n8n | ✅ 3 JSON importables, estructura validada |
| Prompt del LLM | ✅ en la librería, solo se llama para lo que el diccionario no entiende |
| Probado contra Telegram real | ❌ **no** — no tengo tu bot. Tu primer "leche" es el smoke test |

Lo que falta hacer vos está en **[`docs/00-setup.md`](docs/00-setup.md)**:
crear el bot (2 min), pegar 5 valores en la hoja `Config`, importar 3 JSON.

---

## Cómo se usa

```
vos:  leche
bot:  ✅ Anoté: Leche

ella: papel higiénico x2 y detergente
bot:  ✅ Anoté:
      • Papel higiénico x2
      • Detergente

vos:  2 litros de leche
bot:  🔁 Ya estaban, sumé:
      • Leche → ahora 3

vos:  lista
bot:  🛒 Lista actual — 3 ítems
      🥫 ALMACÉN …          [ ✅ Leche ] [ ✅ Detergente ] [ 🛒 Ya compré todo ]
```

El día 1 llega solo el mensaje del mes, con las tres comparaciones: qué se
repite, qué quedó pendiente sin comprar, y qué es nuevo.

---

## Cómo está armado

```
bot-compras/
├── lib/compras.js          ← toda la lógica, sin dependencias ni I/O
├── test/
│   ├── compras.test.js     ← 37 tests unitarios
│   ├── e2e.js              ← 16 tests del Code node "Preparar" contra Sheets simulado
│   ├── simulacion.js       ← mide el hit rate del diccionario
│   └── catalogo.fixture.json
├── tools/
│   ├── build_workflows.js  ← genera los JSON inyectando la librería
│   ├── build_sheet.py      ← genera el .xlsx que se sube a Drive
│   └── validar_workflows.js
├── workflows/              ← los 3 JSON para importar en n8n
└── docs/
```

**`lib/compras.js` es la única fuente de verdad.** Los Code nodes de n8n no
tienen lógica propia: el generador les inyecta la librería. Para cambiar cómo
el bot entiende un mensaje:

```bash
vim lib/compras.js
npm run check      # tests + e2e + build + validación
# después reimportás workflows/compras-ingesta.json en n8n
```

No edites el Code node dentro de n8n: el próximo build te lo pisa.

---

## Las tres decisiones que importan

1. **Telegram, no WhatsApp.** No necesita número dedicado, no tiene ventana de
   24 h, no tiene templates, tiene botones, y sale gratis. Se cayeron
   subsistemas enteros del diseño original. La comparación completa está
   archivada en [`docs/A1-whatsapp.md`](docs/A1-whatsapp.md).

2. **Diccionario primero, IA para la cola larga.** Un catálogo con alias +
   normalización de tildes/plurales/typos resuelve lo conocido gratis y al
   instante; el LLM solo ve los fragmentos que nadie entendió. Medido:
   72/72 mensajes típicos sin IA, 0/9 falsos positivos con ruido, 12/12
   productos desconocidos derivados correctamente. `Config.usar_ia = false`
   apaga el LLM y el bot sigue andando.

3. **HTTP Request en vez de los nodos nativos.** Los teclados inline son de
   largo variable y el nodo Telegram los define como configuración estática;
   además un `batchGet` trae las 3 hojas de una. Ver
   [`docs/01-arquitectura.md`](docs/01-arquitectura.md) § Decisión 4.

---

## Lo que falta

Ordenado por cuánto lo vas a extrañar:

- **`deshacer`.** Está especificado en [`docs/06-comandos.md`](docs/06-comandos.md)
  pero no implementado: necesita que el bot escriba en la hoja `Log`, que hoy
  queda vacía. Es el que más se usa cuando el bot interpreta mal algo.
- **Escribir en `Log`.** La hoja existe con sus headers pero ningún workflow le
  escribe todavía. Sin esto no hay auditoría ni `deshacer`.
- **Auto-alimentar el `Catalogo`.** Cada ítem que resuelve el LLM debería
  volver a la hoja como alias, para que el mes siguiente salga gratis. Hoy el
  catálogo se mantiene a mano.
- **Recordatorio del día 3** si nadie cerró la compra (ver
  [`docs/05-mensaje-mensual.md`](docs/05-mensaje-mensual.md)).
