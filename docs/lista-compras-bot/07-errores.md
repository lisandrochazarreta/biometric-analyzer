# Manejo de errores y casos borde

Ordenado por probabilidad de que te pase.

---

## 1. Mensajes que no son ítems

"jajaja", "ok", "te amo", "compraste?", un sticker con texto, un emoji suelto.

- El prompt (regla 15) devuelve `tipo: "no_entendido"`.
- El validador (nodo 16) también lo captura si `items` viene vacío.
- **Respuesta**: *"No pude sacar ítems de eso 🤔 Escribí *ayuda* para ver qué
  entiendo."*
- **Siempre respondé algo.** El silencio es indistinguible de "el bot está
  caído" y te van a preguntar a vos.
- Loguealo con `resultado = no_entendido`. Si en un mes ves 10 mensajes ahí que
  **sí** eran ítems, agregalos como ejemplos al prompt.

**Anti-loop crítico**: el webhook de Meta dispara también con eventos de estado
(`sent`, `delivered`, `read`) de tus propios mensajes. Si el nodo 2 no los
filtra (`if (!msg) continue`), el bot se responde a sí mismo hasta que Meta te
rate-limitee. Es el bug número uno de este tipo de flujo.

---

## 2. Duplicados

Tres clases distintas, tres soluciones:

**a) Duplicado semántico** — "leche" hoy, "1 litro de leche" mañana.
Lo resuelve el prompt con `id_existente` + el catálogo de alias.
Respuesta: *"🔁 Leche ya estaba, ahora van 2"*.

**b) Duplicado exacto en el mismo mensaje** — "café y café molido".
Regla 14 del prompt: se devuelve una vez sumando cantidades.

**c) Duplicado técnico** — Meta **reintenta el webhook** si no le respondés 200
en ~20 segundos, y tu flujo con LLM + 5 llamadas a Sheets puede tardar eso.
Sin protección, cada ítem entra dos veces.
Solución: el chequeo de `wamid` contra la hoja `Log` (nodos 4-5 del doc 02).
**No lo saltees**, es el error que más va a ensuciar la hoja en producción.

Si querés blindarlo más: activá *Respond Immediately* en el trigger para
devolver 200 apenas llega, y seguí procesando. n8n lo hace por defecto en el
WhatsApp Trigger, pero verificalo.

---

## 3. Mensajes de voz

**Sí, vale la pena.** Son ~6 nodos y USD 0.03/mes, y en la práctica la mitad de
los "se terminó X" salen mientras tenés las manos ocupadas en la cocina — que es
exactamente cuando te acordás de que falta algo.

Flujo (doc 02, §6b):

```
audio.id → GET graph.facebook.com/v21.0/{id}   (con Bearer token) → { url }
         → GET {url}                            (con Bearer token) → binario .ogg
         → POST api.openai.com/v1/audio/transcriptions
           model=whisper-1, language=es, file=<binario>
         → texto → sigue el flujo normal
```

Detalles que importan:
- La URL que devuelve Meta **expira en ~5 minutos** y **exige el header de
  autorización** también en la descarga. Si la pedís sin token, 401.
- WhatsApp manda **OGG/Opus**. Whisper lo acepta nativo, no hace falta convertir.
- El parámetro `prompt` de Whisper mejora muchísimo el reconocimiento de
  productos locales. Usá: *"Lista de compras de supermercado en Argentina:
  leche, yerba, fideos, lavandina, papel higiénico, fernet."*
- **Confirmá siempre lo que entendiste**: *"🎤 Entendí: 'leche y yerba' →
  Anoté: Leche · Yerba"*. Si transcribió mal, lo ven al instante y usan
  `deshacer`.
- Si la transcripción vuelve vacía o con menos de 3 caracteres:
  *"No pude escuchar bien el audio, ¿me lo escribís?"*
- Límite defensivo: si el audio dura más de 60 s, respondé *"El audio es muy
  largo, mandame uno más cortito o escribime"* y no lo transcribas. Evita que
  un audio de 8 minutos te cueste plata y devuelva basura.

**Si no querés sumarlo**, la rama del `Switch` para `audio` responde:
*"Por ahora solo entiendo texto 🙂"*. Es un solo nodo.

---

## 4. Otros tipos de mensaje

Imágenes, stickers, documentos, ubicaciones, contactos → rama *fallback* del
`Switch`:

> *"Por ahora solo entiendo texto y audios 🙂"*

Caso especial que sí vale la pena: **foto de una lista escrita a mano o de la
heladera**. Es tentador y se hace con el mismo LLM (multimodal) en vez de
Whisper. Lo dejaría para la versión 2: la tasa de error es alta y corregir 12
ítems mal leídos es peor que escribirlos.

---

## 5. El LLM devuelve JSON inválido

- `Structured Output Parser` con **Auto-fix activado**: reintenta una vez
  pasándole el error de validación.
- Nodo LLM con `Retry on Fail = true`, `Max tries = 2`.
- Si igual falla: el validador (nodo 16) devuelve `ok: false` y el bot responde
  *"Se me trabó el cerebro con ese mensaje 🤖 ¿Me lo escribís más simple?
  (ej: 'leche x2')"*, y se loguea con `resultado = error` + el raw del modelo.
- **No escribas nunca en `Lista` una salida que no pasó el validador.** Una fila
  con `categoria: "supermercado"` o `cantidad: "dos"` rompe el Code node del
  mensaje mensual tres semanas después, cuando ya no te acordás de nada.

---

## 6. Números desconocidos

Alguien equivocado, spam, o un bot de marketing que scrapeó el número.

- El `If` "Remitente permitido" (nodo 3) corta.
- **No respondas.** Loguealo con `resultado = rechazado` y listo. Responder
  confirma que el número está activo.
- Si ves muchos, el número se filtró: Meta deja bloquear en el panel.

---

## 7. Fallas de infraestructura

| Falla | Síntoma | Qué hacer |
|---|---|---|
| Token de Meta vencido | 401 en todos los envíos | Usá **System User token permanente**, no el de prueba (dura 24 h). Es el error que más veces mata este flujo. |
| Sheets 429 | `Rate limit exceeded` | `Retry on Fail` + `Wait between tries = 3000 ms` en los nodos de Sheets. |
| n8n caído | Nadie recibe nada | Meta reintenta el webhook ~5 veces durante varias horas. Si n8n vuelve en ese lapso, los mensajes llegan (y el chequeo de `wamid` evita duplicar). Si no, se pierden. |
| Certificado vencido | Meta deja de mandar webhooks, silenciosamente | Renovación automática (Caddy / Let's Encrypt) + el check de salud de abajo. |
| Cron no dispara | No llega la lista el día 1 | Timezone del workflow en `America/Argentina/Buenos_Aires`. Verificá en *Executions* que corrió. |

**Workflow de errores** (doc 02, workflow 3): `Error Trigger` → WhatsApp a tu
número. Seteado como *Error Workflow* en los dos workflows principales.

**Check de salud** (opcional, muy barato): un cron semanal que manda un mensaje
al bot desde el propio n8n vía HTTP y verifica que la ejecución de ingesta
aparezca. Si no aparece, te avisa. Es la única forma de detectar "el webhook
dejó de llegar" antes de que falte el café.

---

## 8. Los dos escriben el mismo ítem al mismo tiempo

Google Sheets no tiene transacciones: dos `Append` simultáneos pueden crear dos
filas de "Leche".

- Probabilidad real con 2 personas: bajísima.
- Consecuencia: dos filas, visible en la lista.
- Arreglo automático: el próximo mensaje que mencione "leche" le pasa las dos
  filas al LLM, que va a elegir una — pero la otra queda.
- Arreglo real si te molesta: **Settings del workflow → Limit concurrent
  executions = 1**. Serializa todo. Con este volumen no vas a notar la latencia.

---

## 9. Qué mirar la primera semana

1. La hoja `Log`, filtrando `resultado != ok`. Ahí está todo lo que el bot no
   supo hacer.
2. Los ítems que quedaron en categoría `otros`: o falta guía en el prompt o hace
   falta una categoría nueva.
3. Los duplicados que sobrevivieron: cada uno es un alias que le falta al
   catálogo. Agregalo a mano en `Catalogo.alias` y no vuelve a pasar.
