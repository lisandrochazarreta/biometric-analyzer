> **Actualizado para Telegram.** Varias secciones eran específicas de WhatsApp
> (eventos de estado, `wamid`, media de Meta) y se reescribieron. La versión
> original está en el historial de git.

# Manejo de errores y casos borde

Ordenado por probabilidad de que te pase.

---

## 1. Mensajes que no son ítems

"jajaja", "ok", "te amo", "compraste?", un sticker con texto, un emoji suelto.

- El prompt (regla 15) devuelve `tipo: "no_entendido"`.
- `validarItems()` también lo captura si `items` viene vacío.
- **Respuesta**: *"No pude sacar ítems de eso 🤔 Escribí *ayuda* para ver qué
  entiendo."*
- **Siempre respondé algo.** El silencio es indistinguible de "el bot está
  caído" y te van a preguntar a vos.
- Loguealo con `resultado = no_entendido`. Si en un mes ves 10 mensajes ahí que
  **sí** eran ítems, agregalos como ejemplos al prompt.

**En Telegram esto no pasa**: el bot no recibe eventos de estado de sus propios
mensajes, y por defecto tampoco recibe lo que mandan otros bots. El equivalente
del bug de loop era de WhatsApp.

Lo que **sí** te va a pasar en Telegram, y no es un error del código: si no
desactivaste el *privacy mode* en BotFather, en un grupo el bot solo recibe los
mensajes que empiezan con `/`. Parece caído pero está sano. Ver
[`00-setup.md`](00-setup.md) § 1.

---

## 2. Duplicados

Tres clases distintas, tres soluciones:

**a) Duplicado semántico** — "leche" hoy, "1 litro de leche" mañana.
Lo resuelve el prompt con `id_existente` + el catálogo de alias.
Respuesta: *"🔁 Leche ya estaba, ahora van 2"*.

**b) Duplicado exacto en el mismo mensaje** — "café y café molido".
Regla 14 del prompt: se devuelve una vez sumando cantidades.

**c) Duplicado técnico** — Telegram reintenta la entrega de un update si el
webhook no devuelve 200. El riesgo es mucho menor que en WhatsApp (el flujo hace
1 lectura + 2 escrituras y responde antes de escribir), pero existe si n8n queda
muy lento.

El `update_id` se guarda en la columna `msg_origen` de cada fila, así que un
duplicado es **visible y rastreable**. Si algún día te pasa seguido, el arreglo
es agregar un gate en `Preparar` que corte cuando ya exista una fila con ese
`update_id` — la lista ya está leída en memoria, no cuesta una llamada extra.

---

## 3. Mensajes de voz

**Sí, vale la pena.** Son ~6 nodos y USD 0.03/mes, y en la práctica la mitad de
los "se terminó X" salen mientras tenés las manos ocupadas en la cocina — que es
exactamente cuando te acordás de que falta algo.

Flujo (nodos 13-17 de `compras-ingesta`):

```
voice.file_id → GET api.telegram.org/bot<token>/getFile   → { file_path }
              → GET api.telegram.org/file/bot<token>/<path> → binario .ogg
              → POST api.groq.com/openai/v1/audio/transcriptions
                model=whisper-large-v3-turbo, language=es
              → texto → sigue el flujo normal
```

Detalles que importan:
- Telegram sirve el archivo en un host distinto (`/file/bot<token>/`), sin
  header de auth: el token va en la URL. Es más simple que el flujo de Meta.
- `getFile` funciona para archivos de hasta 20 MB. Una nota de voz nunca se
  acerca.
- Telegram manda **OGG/Opus**. Whisper lo acepta nativo, no hace falta convertir.
- El parámetro `prompt` de Whisper mejora muchísimo el reconocimiento de
  productos locales. Ya va puesto: *"Lista de compras de supermercado en
  Argentina: leche, yerba, fideos, lavandina, papel higiénico, fernet."*
- Groq tiene free tier para Whisper, así que los audios también salen **USD 0**.
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
- Si igual falla: `validarItems()` devuelve una lista vacía y el bot responde
  *"Se me trabó el cerebro con ese mensaje 🤖 ¿Me lo escribís más simple?
  (ej: 'leche x2')"*, y se loguea con `resultado = error` + el raw del modelo.
- **No escribas nunca en `Lista` una salida que no pasó el validador.** Una fila
  con `categoria: "supermercado"` o `cantidad: "dos"` rompe el Code node del
  mensaje mensual tres semanas después, cuando ya no te acordás de nada.

---

## 6. Gente desconocida

Alguien equivocado, spam, o un bot de marketing que scrapeó el número.

- La allowlist en `Preparar` devuelve `[]` y corta.
- **No respondas.** Responder confirma que el bot existe y está vivo.
- En Telegram el riesgo es bajo: para escribirle a tu bot hay que saber su
  usuario exacto. Si igual te pasa, `/setjoingroups Disable` en BotFather evita
  que lo agreguen a otros grupos.

---

## 7. Fallas de infraestructura

| Falla | Síntoma | Qué hacer |
|---|---|---|
| Token de Telegram mal copiado | `400 chat not found` o `401` | El token va en `Config.telegram_bot_token`, sin espacios. Los tokens de Telegram no vencen. |
| Sheets 429 | `Rate limit exceeded` | `Retry on Fail` + `Wait between tries = 3000 ms` en los nodos de Sheets. |
| n8n caído | Nadie recibe nada | Telegram reintenta un rato y después descarta. Si estuvo caído mucho, esos mensajes se perdieron: mirá la hoja y volvé a anotar. |
| Certificado vencido | Telegram deja de mandar updates | Telegram **exige HTTPS con certificado válido** para webhooks. Renovación automática (Caddy / Let's Encrypt). |
| Cron no dispara | No llega la lista el día 1 | Timezone del workflow en `America/Argentina/Buenos_Aires`. Verificá en *Executions* que corrió. |

**Workflow de errores** (`compras-errores`): `Error Trigger` → Telegram a tu
chat privado. Seteado como *Error Workflow* en los dos workflows principales.

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
- Ojo: esto importa más acá que en la versión WhatsApp, porque `Preparar`
  calcula los números de fila a partir de una lectura previa. Si entran dos
  mensajes en el mismo segundo, el segundo puede escribir sobre una fila
  corrida. Con dos personas es improbable; si te preocupa, poné el límite en 1.

---

## 9. Qué mirar la primera semana

1. La hoja `Log`, filtrando `resultado != ok`. Ahí está todo lo que el bot no
   supo hacer.
2. Los ítems que quedaron en categoría `otros`: o falta guía en el prompt o hace
   falta una categoría nueva.
3. Los duplicados que sobrevivieron: cada uno es un alias que le falta al
   catálogo. Agregalo a mano en `Catalogo.alias` y no vuelve a pasar.
