# Arquitectura y decisiones

Objetivo: dos personas anotan ítems sueltos por Telegram durante el mes; el bot
mantiene una lista limpia, deduplicada y categorizada en Google Sheets; el día 1
manda la lista consolidada al grupo. **El bot no compra.**

---

## Decisión 1 — Telegram, no WhatsApp

Se evaluaron las tres opciones. El registro completo de la comparación está en
[`A1-whatsapp.md`](A1-whatsapp.md); el resumen de por qué ganó Telegram:

| | Telegram | WhatsApp Cloud API | Twilio |
|---|---|---|---|
| Costo/mes (uso doméstico) | **USD 0** | ~USD 0.10 | ~USD 1.20 |
| Necesita un número dedicado | **No** | Sí (bloqueante) | Sí |
| Alta | 60 segundos | 45–90 min en Meta | 15 min (sandbox) |
| Puede escribir sin que le escriban | **Sí, siempre** | Solo templates pagos | Igual que Meta |
| Teclados con botones | **Sí** | No | No |
| Editar un mensaje ya enviado | **Sí** | No | No |

Lo que gana Telegram no es solo precio: **borra subsistemas enteros**.

- **No hay ventana de 24 h.** El mensaje del día 1 simplemente se manda. Se cae
  todo el mecanismo de dos caminos (texto libre vs. template) y el seguimiento
  de `ultimo_inbound` por persona.
- **No hay templates.** Se cae la restricción de que las variables no aceptan
  saltos de línea, que era lo que impedía mandar la lista formateada.
- **Un grupo.** Los dos ven todo lo que dice el bot. Se cae toda la lógica de
  notificación cruzada ("avisale al otro que cerré la compra").
- **Botones inline.** "Ya compré" deja de ser algo que hay que escribir y pasa a
  ser un ✅ al lado de cada ítem. En el súper, con una mano ocupada, esto es la
  diferencia entre usar el bot y no usarlo.

Lo único que WhatsApp gana: **está donde la gente ya vive**. Esa era la decisión
real, y ya está tomada.

---

## Decisión 2 — Diccionario primero, IA solo para la cola larga

Dos capas, en este orden:

1. **Router de comandos (regex).** `lista`, `borrar X`, `ya compré`, `reset`,
   `ayuda`, `deshacer`. Nunca llegan al LLM.
2. **Normalizador con diccionario.** Match contra el catálogo de la casa con
   normalización de tildes, plurales, letras repetidas y distancia de edición.
   Resuelve "leche", "se terminó el café", "papel higiénico x2", "lechee".
3. **LLM (Gemini Flash).** Solo los fragmentos que el diccionario no supo.

Medido con el catálogo sembrado (`npm run sim`): **72 de 72** mensajes típicos
se resuelven sin IA, **0 de 9** mensajes de ruido generan ítems falsos, y **12
de 12** productos fuera del catálogo se derivan correctamente al LLM.

> Ese 100% es optimista: escribí yo el catálogo y los mensajes de prueba. El
> número real lo vas a ver en la hoja `Log`. Lo que sí es sólido es la forma:
> lo conocido sale gratis e instantáneo, lo raro lo lee el modelo.

Y hay un efecto acumulativo: cada ítem que el LLM resuelve se puede agregar al
catálogo con sus alias, así que el mes 3 usa menos IA que el mes 1.

**El `Config.usar_ia = false` apaga el LLM por completo.** El bot sigue
funcionando; lo que no entiende te lo devuelve para que lo escribas más simple.

### Por qué no meter los comandos en el LLM

Cuesta plata, agrega latencia, y un día `reset` se interpreta como un ítem. Un
regex de 7 líneas no tiene ninguna de esas propiedades.

---

## Decisión 3 — Modelo de ciclos

La unidad es el **ciclo**, nombrado por el mes en que se compra:

- Ciclo `2026-10` = todo lo que se anote entre el cierre de septiembre y el
  **1 de octubre 09:00**.
- El cron del día 1 **cierra** el ciclo (lo manda) y **abre** el siguiente. Lo
  que se anote el 1 a las 10 AM ya entra a `2026-11`.
- Los ítems del ciclo cerrado siguen en `Lista` como `pendiente` hasta que
  alguien toque ✅ o escriba **"ya compré"**. Ahí pasan a `comprado` y se
  archivan en `Historial`.
- Si llega el día 1 siguiente y el ciclo anterior nunca se cerró: se archiva y
  los pendientes **se arrastran** al ciclo nuevo con `veces_arrastrado + 1`.
  A los 3 arrastres el ítem se descarta solo, y el mensaje lo avisa.

De comparar el ciclo actual contra el anterior en `Historial` salen, sin lógica
extra, las tres secciones del mensaje mensual: qué se repite, qué quedó
pendiente, qué es nuevo.

---

## Decisión 4 — HTTP Request en vez de los nodos nativos

Los workflows hablan con las APIs REST de Google Sheets y de Telegram a través
del nodo `HTTP Request`, en vez de usar los nodos `Google Sheets` y `Telegram`
de n8n (salvo el trigger). Tres razones:

1. **Los teclados inline son de largo variable.** El nodo Telegram los define
   como `fixedCollection`, que es configuración estática: no se pueden construir
   en runtime. Esto solo es posible por HTTP.
2. **Menos llamadas.** Un `values:batchGet` trae `Lista`, `Catalogo` y `Config`
   de una; un `values:batchUpdate` escribe todas las celdas juntas. Con los
   nodos nativos serían 6–8 llamadas por mensaje.
3. **El shape de parámetros de la API REST es estable**; el de los nodos cambia
   entre `typeVersion`s. Como estos workflows se generan y no se arman a mano,
   generar contra un contrato estable es más seguro.

Costo: se ven menos "lindos" en el editor. Si preferís los nodos nativos, el
único que no se puede reemplazar es el que manda la lista con botones.

---

## Decisión 5 — Responder antes de escribir

En `compras-ingesta` la respuesta a Telegram sale **antes** de escribir en el
Sheet. Es a propósito: la confirmación llega instantánea y no queda colgada si
Sheets está lento.

El riesgo es real y acotado: si la escritura falla, recibiste un "✅ Anoté" de
algo que no se guardó. Por eso `compras-errores` te avisa por Telegram cuando
cualquier nodo falla. Para una lista de compras de casa, el trade-off vale;
si algún día molesta, invertí el orden de las conexiones en el nodo `Responder`.

---

## Diagrama

```
WORKFLOW 1 — compras-ingesta   (webhook, ~200 ejecuciones/mes)

  Telegram Trigger  (message + callback_query)
        │
  Leer hojas        (1 batchGet: Lista + Catalogo + Config)
        │
  Preparar          ← toda la decisión pasa acá
        │   · normaliza el update (mensaje o botón)
        │   · allowlist: si no sos vos o ella, silencio
        │   · router de comandos
        │   · diccionario; si falla, arma el prompt
        │   · calcula filas a agregar y celdas a actualizar
        │
        ├─ Gate: responder ──▶ Responder ──┬─▶ Gate appends ─▶ Agregar filas
        │                                  └─▶ Gate updates ─▶ Actualizar celdas
        │
        ├─ Gate: necesita IA ─▶ Gemini ─▶ Aplicar IA ─▶ (vuelve a Gate: responder)
        │
        └─ Gate: audio ─▶ getFile ─▶ Bajar ─▶ Whisper ─▶ Audio a texto


WORKFLOW 2 — compras-mensual   (0 9 1 * *, America/Argentina/Buenos_Aires)

  Día 1, 09:00 ─▶ Leer hojas ─▶ Leer historial ─▶ Consolidar
        ├─▶ Mandar lista al grupo   (con un ✅ por ítem)
        └─▶ Archivar en Historial ─▶ Arrastrar pendientes ─▶ Cerrar ciclo


WORKFLOW 3 — compras-errores

  Error Trigger ─▶ Leer hojas ─▶ Armar aviso ─▶ Avisarme por Telegram
```

Los "Gate" son Code nodes de una línea que devuelven `[]` cuando la rama no
aplica. Un Code node que devuelve vacío corta la rama sin ejecutar lo que sigue;
es más robusto entre versiones de n8n que un nodo `IF` o `Switch`, cuyo shape de
parámetros cambia.

---

## Costo

| Componente | Costo/mes |
|---|---|
| Telegram Bot API | USD 0 |
| Gemini Flash (free tier), ~40 llamadas | USD 0 |
| Groq Whisper (free tier), ~20 audios | USD 0 |
| Google Sheets | USD 0 |
| n8n self-hosted | ya lo pagás |
| **Total** | **USD 0.00** |

Para que esto deje de ser cero tendrían que anotar unos dos órdenes de magnitud
más de ítems por mes.
