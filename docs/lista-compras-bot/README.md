# Bot de lista de compras por WhatsApp (n8n + Google Sheets)

Dos personas escriben ítems sueltos por WhatsApp durante el mes. El bot los
normaliza con IA, los deduplica y los guarda categorizados en Google Sheets. El
día 1 de cada mes manda la lista consolidada a los dos, con comparación contra
el mes anterior. **No compra nada**: el click final es tuyo.

Costo estimado: **~USD 0.45/mes**.

## Documentos

| | |
|---|---|
| [`01-arquitectura.md`](01-arquitectura.md) | Cloud API vs Twilio, modelo de ciclos, la trampa de los templates, costos, decisiones previas. |
| [`02-n8n-nodo-por-nodo.md`](02-n8n-nodo-por-nodo.md) | Los 3 workflows, nodo por nodo, con el código de cada Code node. |
| [`03-prompt-normalizacion.md`](03-prompt-normalizacion.md) | El system prompt completo + JSON Schema + tests. |
| [`04-google-sheet.md`](04-google-sheet.md) | Las 5 hojas, columnas, cómo marcar comprado, límites de la API. |
| [`05-mensaje-mensual.md`](05-mensaje-mensual.md) | Formato del mensaje, código de consolidación y comparación, envío. |
| [`06-comandos.md`](06-comandos.md) | `lista`, `borrar X`, `ya compré`, `reset`, `ayuda`, `deshacer`. |
| [`07-errores.md`](07-errores.md) | No-ítems, duplicados, audios, JSON inválido, infra. |

## Orden de implementación sugerido

1. **Google Sheet** (doc 04). 20 min. Sembrá `Catalogo` con 30 ítems que sabés
   que compran siempre y `Config` con los dos números.
2. **Alta en Meta** (doc 01 §1). Es lo que más tarda y no depende de vos: hacelo
   primero y seguí con el resto mientras esperás. Bloqueante real: **un número
   que no esté en WhatsApp**.
3. **Workflow de ingesta sin IA** (doc 02, nodos 1-11): recibir, validar
   remitente, dedup por `wamid`, responder `ayuda`. Probá que el ida y vuelta
   funcione antes de gastar un token.
4. **Rama IA** (doc 02, nodos 12-21 + doc 03). Corré los 10 mensajes de test del
   doc 03 §Notas.
5. **Comandos** (doc 06). Empezá por `lista` y `ya compré`; `deshacer` va
   tercero y lo vas a agradecer.
6. **Cron mensual** (doc 05). Probalo cambiando el cron a `*/5 * * * *` con
   datos de prueba, y recién después ponelo en `0 9 1 * *`.
7. **Workflow de errores** (doc 02, workflow 3). 3 nodos, no lo saltees.

## Los tres errores que te van a costar una tarde

1. Usar el **token de prueba de Meta** (dura 24 h) en vez del System User token.
2. No filtrar los eventos de `statuses` en el nodo 2 → el bot se responde a sí
   mismo en loop.
3. No chequear `wamid` contra el `Log` → Meta reintenta el webhook y cada ítem
   entra dos veces.
