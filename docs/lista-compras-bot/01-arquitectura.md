# Bot de lista de compras por WhatsApp — Arquitectura y decisiones

Objetivo: dos personas escriben ítems sueltos por WhatsApp durante todo el mes;
el bot mantiene una lista limpia, deduplicada y categorizada en Google Sheets;
el día 1 de cada mes manda la lista consolidada a los dos. **El bot no compra.**

---

## 1. Decisión: WhatsApp Cloud API vs Twilio

### WhatsApp Cloud API (Meta, directo) — **recomendado**

| | |
|---|---|
| Costo mensajes de servicio (tus respuestas dentro de la ventana de 24 h) | **USD 0** — Meta los dejó gratis desde nov-2024 |
| Costo templates *utility* (el ping del día 1) | ~USD 0.03–0.04 c/u en Argentina |
| Costo de plataforma | USD 0 |
| Nodo en n8n | Nativo: `WhatsApp Trigger` + `WhatsApp Business Cloud` |
| Setup | 45–90 min de Meta Business Manager la primera vez |

**Pros**
- Es literalmente gratis para este caso de uso (2 personas, ~200 mensajes/mes).
- Soporte nativo en n8n para trigger y envío, incluido media.
- Sin intermediario: menos latencia, menos cosas que se rompen.

**Contras / fricciones reales**
- Necesitás **un número que NO esté registrado en WhatsApp ni WhatsApp Business**.
  Si lo está, hay que borrar esa cuenta primero (se pierde el historial). En la
  práctica: comprá un chip prepago o un eSIM barato y dedicalo al bot.
- Alta en Meta Business Manager: crear app tipo *Business*, agregar el producto
  WhatsApp, verificar el número, aprobar el *display name*.
- Los **templates** se aprueban (minutos a horas) y la categoría la decide Meta
  (pedí *utility*, no *marketing* — marketing sale 2× y puede caer en el filtro
  de notificaciones).
- El **access token permanente** sale de un System User en Business Manager;
  el token de prueba dura 24 h y te va a hacer perder una tarde si no lo sabés.
- Tier inicial sin verificación de negocio: 250 conversaciones iniciadas por día.
  Para 2 destinatarios sobra de por vida.

### Twilio (WhatsApp Business API vía Twilio)

| | |
|---|---|
| Fee de Twilio | ~USD 0.005 por mensaje, **además** de lo que cobra Meta |
| Costo estimado (200 msjs/mes) | ~USD 1.00–1.20/mes |
| Nodo en n8n | Nativo (`Twilio`), webhook simple |
| Setup | 15 min con el Sandbox; el número productivo igual pasa por Meta |

**Pros**
- El **Sandbox** te deja probar en 10 minutos sin tocar Meta: mandás un código
  de join a un número compartido y ya estás recibiendo webhooks en n8n.
- Descarga de media con Basic Auth directo (más simple que el flujo de 2 pasos
  de Meta).
- Logs y debugging del panel de Twilio son mejores que los de Meta.

**Contras**
- El Sandbox **caduca cada 72 h de inactividad** y hay que re-joinear. No sirve
  para producción de algo que usás todos los días.
- Para producción igual tenés que hacer el alta de WhatsApp en Meta (Twilio la
  intermedia, no la evita).
- Pagás un fee por cada mensaje entrante y saliente, incluidos los que con Cloud
  API serían gratis. Sigue siendo <USD 5, pero es 10× más caro sin dar nada a
  cambio en este caso.

### Veredicto

**Cloud API directo.** Twilio no compra nada que necesites acá y cobra por
mensaje lo que Meta regala. Excepción razonable: **usá el Sandbox de Twilio los
primeros días** para tener el flujo de n8n andando end-to-end mientras Meta te
aprueba el número, y después cambiá los dos nodos (trigger + envío). El resto
del workflow es idéntico porque lo primero que hace es normalizar el payload a
una forma propia.

### Requisito de infra (vale para las dos)

El webhook de n8n tiene que ser **HTTPS público con certificado válido**. Meta
no acepta self-signed ni IP pelada. Si tu n8n está detrás de Cloudflare Tunnel,
Caddy o Traefik con Let's Encrypt, ya estás. Seteá `WEBHOOK_URL` en el entorno
de n8n a la URL pública o el trigger te va a registrar una URL interna.

---

## 2. Decisión: quién parsea qué

Dos capas, en este orden:

1. **Router determinístico (Code node, regex).** Comandos exactos —`lista`,
   `borrar X`, `ya compré`, `reset`, `ayuda`, `deshacer`. Gratis, 0 ms,
   0 alucinaciones. Todo lo que matchea acá **no llega a la IA**.
2. **Normalizador con IA.** Solo el texto libre. Es el único paso que cuesta
   plata y el único que puede equivocarse, así que se lo alimenta con la lista
   actual y un catálogo de alias para que deduplique bien, y se le exige JSON
   estricto validado por schema.

Poner los comandos en la IA "porque entiende mejor" es un error clásico: te
cuesta plata, agrega latencia y un día `reset` se interpreta como un ítem.

---

## 3. Decisión: modelo de ciclos

La unidad es el **ciclo**, nombrado por el mes en que se compra:

- Ciclo `2026-10` = todo lo que se agregue entre el cierre de septiembre y el
  **1 de octubre 09:00**.
- El cron del día 1 **cierra** el ciclo (lo manda por WhatsApp) y **abre** el
  siguiente. Lo que se agregue el 1 a las 10 AM ya entra a `2026-11`.
- Los ítems del ciclo cerrado siguen en la hoja `Lista` con estado `pendiente`
  hasta que alguien diga **"ya compré"**. Ahí pasan a `comprado` y se archivan
  en `Historial`.
- Si llega el día 1 siguiente y el ciclo anterior nunca se cerró: se archiva con
  estado `no_comprado`, y los pendientes **se arrastran** al ciclo nuevo con
  `veces_arrastrado + 1`. A los 3 arrastres el ítem se descarta solo (si en tres
  meses no lo compraste, no hacía falta) y el mensaje lo avisa.

Esto es lo que permite el punto 4 del pedido: "qué se repite" y "qué se pidió y
no se compró" salen de comparar el ciclo actual contra el anterior en
`Historial`, sin lógica extra.

---

## 4. Decisión: cómo mandar el mensaje del día 1

Acá hay una trampa de WhatsApp que conviene saber antes de diseñar el mensaje:

- Solo podés mandar **texto libre** dentro de las **24 h** desde el último
  mensaje que te mandó esa persona. Fuera de eso, solo **templates aprobados**.
- Las **variables de un template no admiten saltos de línea**, tabs ni más de 4
  espacios seguidos. O sea: **no podés meter la lista formateada dentro de un
  template.**

Solución de dos caminos (está implementada en el cron):

- **Camino A (lo normal).** Como los dos escriben al bot seguido, casi siempre
  hay alguno que escribió en las últimas 24 h. Guardás `ultimo_inbound_<persona>`
  en la hoja `Config` y, si está dentro de la ventana, mandás el mensaje completo
  **gratis** como texto libre.
- **Camino B (fallback).** Si la ventana está cerrada, mandás un template
  *utility* cortito (`Tu lista de compras de {{1}} está lista 🛒 Respondé
  cualquier cosa y te la paso.`) y dejás `envio_pendiente_<persona> = true`.
  Cuando esa persona responde cualquier cosa, el workflow de ingesta ve el flag
  y le manda la lista completa antes de procesar el mensaje. Costo: ~USD 0.04.

Alternativa que descarté: mandar la lista como PDF adjunto en el header del
template. Funciona y evita el ping, pero hay que generar y hostear el PDF, y
leer un PDF en el súper es peor que leer un mensaje.

---

## 5. Diagrama de flujo

```
WORKFLOW 1 — compras-ingesta (webhook, corre ~200 veces/mes)

  WhatsApp Trigger
        │
        ├─ Code: parsear payload → {wamid, from, tipo, texto|audio_id, ts}
        │
        ├─ IF remitente ∈ allowlist ────── no ──▶ Log + stop (sin responder)
        │
        ├─ Sheets: ¿wamid ya procesado? ── sí ──▶ stop (idempotencia)
        │
        ├─ Switch tipo
        │     ├─ audio ──▶ get media URL ▶ download ▶ Whisper ▶ texto
        │     ├─ text  ──▶ texto
        │     └─ otro  ──▶ "solo texto y audios" ▶ stop
        │
        ├─ IF envio_pendiente_<persona> ── sí ──▶ mandar lista mensual + bajar flag
        │
        ├─ Code: router de comandos (regex)
        │
        ├─ Switch
        │     ├─ lista     ──▶ Sheets read ▶ formatear ▶ responder
        │     ├─ borrar X  ──▶ fuzzy match ▶ Sheets update (descartado) ▶ responder
        │     ├─ ya compré ──▶ Sheets update masivo ▶ archivar ▶ avisar a los dos
        │     ├─ reset     ──▶ pedir "confirmar reset"
        │     ├─ ayuda     ──▶ responder texto fijo
        │     ├─ deshacer  ──▶ revertir último cambio del Log
        │     └─ (ninguno) ──▶ RAMA IA
        │                        ├─ Sheets: leer Lista (pendientes) + Catalogo
        │                        ├─ Code: armar contexto compacto
        │                        ├─ LLM (JSON estricto, temp 0)
        │                        ├─ Code: validar schema
        │                        ├─ Split Out ▶ Switch accion
        │                        │     ├─ sumar_a_existente ▶ Sheets update
        │                        │     └─ agregar           ▶ Sheets append
        │                        ├─ Sheets: actualizar Catalogo (alias + frecuencia)
        │                        └─ WhatsApp: confirmación
        │
        └─ Sheets: append en Log (siempre)


WORKFLOW 2 — compras-mensual (cron 0 9 1 * *, America/Argentina/Buenos_Aires)

  Schedule Trigger
        ├─ Sheets: leer Lista (ciclo activo) + Historial (ciclo anterior)
        ├─ Code: arrastrar pendientes viejos, consolidar, comparar, formatear
        ├─ Sheets: archivar ciclo vencido / actualizar veces_arrastrado
        ├─ Sheets: Config.ciclo_activo = siguiente mes
        └─ Loop 2 personas
              ├─ IF ventana 24h abierta ── sí ──▶ WhatsApp texto libre (gratis)
              └─                          no  ──▶ WhatsApp template + flag

WORKFLOW 3 — compras-errores (Error Trigger)
        └─ WhatsApp/email a vos con el nodo que falló y el input
```

---

## 6. Costo mensual estimado

Supuesto: ~200 mensajes entrantes/mes, ~200 respuestas, 2–4 templates, 20 audios
de ~15 s.

| Componente | Costo |
|---|---|
| n8n self-hosted | ya lo tenés |
| Cloud API — mensajes de servicio (respuestas dentro de 24 h) | **USD 0** |
| Cloud API — 2–4 templates *utility* AR (~USD 0.034 c/u) | ~USD 0.10 |
| LLM normalizador — Claude Haiku 4.5, ~190k tok in / 30k out | ~USD 0.30 |
| Transcripción — Whisper `whisper-1`, ~5 min | ~USD 0.03 |
| Google Sheets / Drive | USD 0 |
| **Total** | **≈ USD 0.45/mes** |

Con Twilio en vez de Cloud API: **≈ USD 1.50/mes**. Las dos opciones entran
holgadas en el presupuesto de USD 5.

> Los precios de templates de Meta cambian por país y categoría. Verificá el
> rate card actual (Argentina / utility) antes de dar el número por bueno; el
> orden de magnitud —centavos por mes— no va a cambiar.

Si querés gastar **cero absoluto** en el LLM: Gemini Flash tiene free tier en
Google AI Studio y te alcanza de sobra para 200 mensajes/mes. El prompt del
doc 03 es portable, solo cambia el nodo.

---

## 7. Qué decidir antes de empezar

1. **¿Tenés un número libre para el bot?** Es el bloqueante real. Sin número
   dedicado (chip prepago o eSIM) no hay Cloud API. Mientras tanto, Sandbox de
   Twilio.
2. **¿El "ya compré" lo dispara una persona o los dos?** Asumí una: el primero
   que lo diga cierra el ciclo y al otro le llega el aviso.
3. **¿Querés eco cruzado?** O sea, que cuando vos agregás algo le llegue un
   aviso a ella. Recomiendo **sí pero agrupado**: un resumen a las 21:00 con lo
   que se agregó en el día, en vez de un ping por ítem. Está como nodo opcional
   en el doc 02.
4. **Categorías fijas.** Las que pediste: `almacén, lácteos, limpieza, higiene,
   bebidas, frescos, otros`. Son las únicas que el prompt acepta; agregar una
   después implica tocar el prompt y la hoja `Config`.
