#!/usr/bin/env node
/**
 * Genera los JSON importables de n8n inyectando lib/compras.js dentro de los
 * Code nodes. Correr: node tools/build_workflows.js
 *
 * Por que HTTP Request y no los nodos nativos de Google Sheets / Telegram:
 *  - Sheets: una sola llamada batchGet trae las 4 hojas y un batchUpdate
 *    escribe todo junto. Con el nodo nativo serian 6-8 llamadas por mensaje.
 *  - Telegram: los teclados inline son de largo variable y el nodo nativo los
 *    define como fixedCollection (configuracion estatica), asi que no se
 *    pueden construir en runtime.
 *  - Ademas el shape de parametros de la API REST es estable; el de los nodos
 *    cambia entre typeVersions.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SHEET_ID = '1Boax5fBBasvYdIy2AEmVhaNonSUGq1jB0IvMbxdEDfA';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID;

// ---- libreria inyectable ---------------------------------------------------
const LIB = fs.readFileSync(path.join(RAIZ, 'lib/compras.js'), 'utf8')
  .replace(/\nmodule\.exports = \{[\s\S]*?\n\};\s*$/, '\n');

const PRELUDIO = `// ===== lib/compras.js (generado por tools/build_workflows.js - no editar aca) =====
${LIB}
// ===== fin de la libreria =====
`;

// ---- helpers de nodos ------------------------------------------------------
let seq = 0;
const nid = () => `n${String(++seq).padStart(3, '0')}`;

function code(name, js, pos) {          // con la libreria inyectada
  return { parameters: { jsCode: PRELUDIO + js }, id: nid(), name,
           type: 'n8n-nodes-base.code', typeVersion: 2, position: pos };
}
function gate(name, js, pos) {          // filtros de una linea: no necesitan la lib
  return { parameters: { jsCode: js }, id: nid(), name,
           type: 'n8n-nodes-base.code', typeVersion: 2, position: pos };
}
function http(name, params, pos, extra = {}) {
  return { parameters: { options: {}, ...params }, id: nid(), name,
           type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, ...extra };
}
function sheetsAuth() {
  return { authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api' };
}
function conectar(pares) {
  const c = {};
  for (const [de, a] of pares) {
    (c[de] ||= { main: [[]] }).main[0].push({ node: a, type: 'main', index: 0 });
  }
  return c;
}

// ---- lectura de las hojas (una sola llamada) -------------------------------
const LEER_HOJAS = (pos) => http('Leer hojas', {
  method: 'GET',
  url: `${SHEETS}/values:batchGet`,
  ...sheetsAuth(),
  sendQuery: true,
  queryParameters: { parameters: [
    { name: 'ranges', value: 'Lista!A:O' },
    { name: 'ranges', value: 'Catalogo!A:E' },
    { name: 'ranges', value: 'Config!A:C' },
    { name: 'majorDimension', value: 'ROWS' },
  ] },
}, pos);

// Se usa dentro de los Code nodes para pasar de la respuesta cruda a objetos.
const PARSEO_HOJAS = `
function filasAObjetos(valueRange) {
  const v = (valueRange && valueRange.values) || [];
  if (!v.length) return [];
  const head = v[0].map(h => String(h).trim());
  return v.slice(1).map((fila, i) => {
    const o = { _fila: i + 2 };                 // numero de fila real en la hoja
    head.forEach((h, j) => { o[h] = fila[j] != null ? fila[j] : ''; });
    return o;
  });
}
function leerHojas(json) {
  const r = json.valueRanges || [];
  const lista = filasAObjetos(r[0]);
  const catalogo = filasAObjetos(r[1]);
  const cfgFilas = filasAObjetos(r[2]);
  const config = {};
  for (const f of cfgFilas) config[f.clave] = f.valor;
  return { lista, catalogo, config };
}
const COL = { id:'A', ciclo:'B', item:'C', variantes:'D', cantidad:'E', unidad:'F',
              categoria:'G', pedido_por:'H', nota:'I', fecha_alta:'J', estado:'K',
              fecha_compra:'L', veces_arrastrado:'M', origen:'N', msg_origen:'O' };
const ORDEN_COLS = ['id','ciclo','item','variantes','cantidad','unidad','categoria',
                    'pedido_por','nota','fecha_alta','estado','fecha_compra',
                    'veces_arrastrado','origen','msg_origen'];
function filaDesdeObjeto(o) { return ORDEN_COLS.map(k => o[k] != null ? o[k] : ''); }
function tg(config, metodo) {
  return 'https://api.telegram.org/bot' + String(config.telegram_bot_token || '').trim() + '/' + metodo;
}
`;

// ===========================================================================
//  WORKFLOW 1 — ingesta
// ===========================================================================
function ingesta() {
  seq = 0;
  const N = [];

  N.push({ parameters: { updates: ['message', 'callback_query'], additionalFields: {} },
           id: nid(), name: 'Telegram Trigger', type: 'n8n-nodes-base.telegramTrigger',
           typeVersion: 1.1, position: [-220, 300], webhookId: 'compras-ingesta' });

  N.push(LEER_HOJAS([0, 300]));

  N.push(code('Preparar', PARSEO_HOJAS + `
const { lista, catalogo, config } = leerHojas($('Leer hojas').first().json);
const upd = $('Telegram Trigger').first().json;

// --- normalizar el update de Telegram (mensaje o botón) -------------------
const cb  = upd.callback_query || null;
const msg = cb ? cb.message : (upd.message || upd.edited_message);
if (!msg) return [];

const from    = cb ? cb.from : msg.from;
const chatId  = String(msg.chat.id);
const userId  = String(from.id);
const nombre  = from.first_name || from.username || userId;
const texto   = cb ? '' : (msg.text || msg.caption || '');
const voiceId = (msg.voice && msg.voice.file_id) || (msg.audio && msg.audio.file_id) || null;

// --- autorización ---------------------------------------------------------
const permitidos = [config.persona_1_user_id, config.persona_2_user_id]
  .map(x => String(x || '').trim()).filter(x => x && x !== '<PEGAR>');
if (permitidos.length && !permitidos.includes(userId)) return [];   // silencio

const base = {
  chat_id: chatId, user_id: userId, nombre, update_id: upd.update_id,
  callback_id: cb ? cb.id : null,
  url_responder: tg(config, 'sendMessage'),
  url_append: '${SHEETS}/values/Lista!A:O:append',
  url_batch: '${SHEETS}/values:batchUpdate',
  ciclo: config.ciclo_activo || '',
  appends: [], updates: [], necesita_ia: false, prompt_ia: '',
};
const responder = (t, extra = {}) => [{ json: { ...base, respuesta: t, ...extra } }];

// --- botón "✅ item" o "🛒 ya compré todo" ---------------------------------
if (cb) {
  const dato = String(cb.data || '');
  const ahora = new Date().toISOString();
  if (dato === 'comprado:all') {
    const pend = lista.filter(r => r.estado === 'pendiente');
    return responder(\`🛒 \${esc(nombre)} cerró la compra: \${pend.length} ítems marcados.\`, {
      updates: pend.flatMap(r => [
        { range: 'Lista!K' + r._fila, values: [['comprado']] },
        { range: 'Lista!L' + r._fila, values: [[ahora]] },
      ]),
    });
  }
  const id = dato.replace(/^ok:/, '');
  const fila = lista.find(r => String(r.id) === id && r.estado === 'pendiente');
  if (!fila) return responder('Ese ítem ya estaba marcado 👍');
  return responder(\`✅ \${esc(fila.item)} — marcado por \${esc(nombre)}\`, {
    updates: [
      { range: 'Lista!K' + fila._fila, values: [['comprado']] },
      { range: 'Lista!L' + fila._fila, values: [[ahora]] },
    ],
  });
}

// --- audio: se resuelve en la rama de transcripción ------------------------
if (!texto && voiceId) {
  return [{ json: { ...base, respuesta: '', es_audio: true, file_id: voiceId,
                    url_getfile: tg(config, 'getFile'),
                    token: String(config.telegram_bot_token || '').trim() } }];
}
if (!texto) return responder('Por ahora solo entiendo texto y audios 🙂');

// --- comandos -------------------------------------------------------------
const { comando, argumento } = routerComandos(texto);
const ahora = new Date().toISOString();

if (comando === 'ayuda') return responder(TEXTO_AYUDA);
if (comando === 'lista') {
  const pend = lista.filter(r => r.estado === 'pendiente');
  return responder(renderLista(lista, config), { teclado: tecladoLista(pend) });
}
if (comando === 'reset') {
  const n = lista.filter(r => r.estado === 'pendiente').length;
  return responder(\`⚠️ Esto saca los \${n} ítems de la lista sin marcarlos como comprados.\\nSi estás seguro, escribí <b>confirmar reset</b>\`);
}
if (comando === 'reset_confirmado') {
  const pend = lista.filter(r => r.estado === 'pendiente');
  return responder('🧹 Lista vacía. Empezamos de cero.', {
    updates: pend.map(r => ({ range: 'Lista!K' + r._fila, values: [['descartado']] })),
  });
}
if (comando === 'borrar') {
  const m = matchParaBorrar(argumento, lista);
  if (m.estado === 'no_encontrado')
    return responder(\`No encontré "\${esc(argumento)}" en la lista. Escribí <b>lista</b> para ver qué hay.\`);
  if (m.estado === 'ambiguo')
    return responder('¿Cuál? ' + m.filas.map(f => '<b>' + esc(f.item) + '</b>').join(' o ') +
                     '\\nEscribí <b>borrar &lt;nombre completo&gt;</b>.');
  return responder(\`🗑️ Saqué <b>\${esc(m.filas[0].item)}</b> de la lista.\`, {
    updates: [{ range: 'Lista!K' + m.filas[0]._fila, values: [['descartado']] }],
  });
}
if (comando === 'comprado') {
  let objetivo;
  if (argumento) {
    objetivo = [];
    for (const parte of argumento.split(',').map(s => s.trim()).filter(Boolean)) {
      const m = matchParaBorrar(parte, lista);
      if (m.estado === 'ok') objetivo.push(m.filas[0]);
    }
    if (!objetivo.length) return responder(\`No encontré nada de "\${esc(argumento)}" en la lista.\`);
  } else {
    objetivo = lista.filter(r => r.estado === 'pendiente');
    if (!objetivo.length) return responder('No hay nada pendiente para marcar 🤷');
  }
  const quedan = lista.filter(r => r.estado === 'pendiente' && !objetivo.includes(r)).length;
  const txt = argumento
    ? \`✅ Marqué: \${objetivo.map(r => esc(r.item)).join(', ')}. Quedan \${quedan}.\`
    : \`✅ \${esc(nombre)} cerró la compra: \${objetivo.length} ítems. Lo que anoten desde ahora va al mes que viene.\`;
  return responder(txt, {
    updates: objetivo.flatMap(r => [
      { range: 'Lista!K' + r._fila, values: [['comprado']] },
      { range: 'Lista!L' + r._fila, values: [[ahora]] },
    ]),
  });
}

// --- texto libre: primero el diccionario, gratis --------------------------
const local = normalizarLocal(texto, catalogo);
const usarIA = String(config.usar_ia || 'true') !== 'false';

if (local.resueltoTodo && local.items.length) {
  const plan = planificarEscrituras(validarItems(local.items), lista,
    { ciclo: config.ciclo_activo, nombre, ahora, msgId: String(upd.update_id) });
  return [{ json: { ...base,
    respuesta: renderConfirmacion(plan.appends, plan.updates),
    appends: plan.appends.map(filaDesdeObjeto),
    updates: plan.updates.flatMap(u => {
      const f = lista.find(r => String(r.id) === String(u.id));
      return f ? [
        { range: 'Lista!E' + f._fila, values: [[u.cantidad]] },
        { range: 'Lista!D' + f._fila, values: [[u.variantes]] },
        { range: 'Lista!H' + f._fila, values: [[u.pedido_por]] },
      ] : [];
    }),
  } }];
}

if (!usarIA) {
  if (local.items.length) {
    const plan = planificarEscrituras(validarItems(local.items), lista,
      { ciclo: config.ciclo_activo, nombre, ahora, msgId: String(upd.update_id) });
    return [{ json: { ...base,
      respuesta: renderConfirmacion(plan.appends, plan.updates) +
        \`\\n\\n🤔 No entendí: \${esc(local.sinResolver.join(', '))}\`,
      appends: plan.appends.map(filaDesdeObjeto), updates: [] } }];
  }
  return responder('No pude sacar ítems de eso 🤔 Escribí <b>ayuda</b> para ver qué entiendo.');
}

// --- cae al LLM solo lo que el diccionario no supo ------------------------
const contexto = {
  lista: lista.filter(r => r.estado === 'pendiente')
              .map(r => ({ id: r.id, item: r.item, cant: r.cantidad, cat: r.categoria })),
  catalogo: catalogo.slice(0, 120)
              .map(c => ({ item: c.item_canonico, cat: c.categoria })),
};
return [{ json: { ...base, necesita_ia: true,
  respuesta: '',
  pendientes_ia: local.sinResolver,
  items_locales: validarItems(local.items),
  prompt_ia: PROMPT_IA
    .replace('__LISTA__', JSON.stringify(contexto.lista))
    .replace('__CATALOGO__', JSON.stringify(contexto.catalogo))
    .replace('__MENSAJE__', local.sinResolver.join(' ; ')),
} }];
`, [220, 300]));

  // ---- rama audio --------------------------------------------------------
  N.push(gate('Gate: audio', `return $input.all().filter(i => i.json.es_audio);`, [440, 560]));
  N.push(http('Telegram getFile', {
    method: 'GET', url: '={{ $json.url_getfile }}',
    sendQuery: true, queryParameters: { parameters: [{ name: 'file_id', value: '={{ $json.file_id }}' }] },
  }, [660, 560]));
  N.push(http('Bajar audio', {
    method: 'GET',
    url: '={{ "https://api.telegram.org/file/bot" + $(\'Gate: audio\').first().json.token + "/" + $json.result.file_path }}',
    options: { response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
  }, [880, 560]));
  N.push(http('Transcribir (Groq Whisper)', {
    method: 'POST', url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    contentType: 'multipart-form-data', sendBody: true,
    bodyParameters: { parameters: [
      { name: 'file', parameterType: 'formBinaryData', inputDataFieldName: 'data' },
      { name: 'model', value: 'whisper-large-v3-turbo' },
      { name: 'language', value: 'es' },
      { name: 'prompt', value: 'Lista de compras de supermercado en Argentina: leche, yerba, fideos, lavandina, papel higiénico, fernet.' },
    ] },
  }, [1100, 560], { onError: 'continueRegularOutput' }));
  N.push(gate('Audio → texto', `
const t = ($json.text || '').trim();
const ctx = $('Gate: audio').first().json;
if (t.length < 3) {
  return [{ json: { ...ctx, respuesta: 'No pude escuchar bien el audio, ¿me lo escribís? 🎤' } }];
}
// Se reinyecta como si hubiera sido texto: el usuario ve qué se entendió.
return [{ json: { ...ctx, texto_transcripto: t, respuesta: '🎤 Entendí: "' + t + '"\\n\\nMandámelo por texto si me equivoqué.' } }];
`, [1320, 560]));

  // ---- respuesta principal ----------------------------------------------
  N.push(gate('Gate: responder', `return $input.all().filter(i => i.json.respuesta);`, [440, 300]));
  N.push(http('Responder', {
    method: 'POST', url: '={{ $json.url_responder }}',
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ chat_id: $json.chat_id, text: $json.respuesta, parse_mode: "HTML", reply_markup: $json.teclado || undefined }) }}',
  }, [660, 300], { onError: 'continueRegularOutput' }));

  // ---- escrituras --------------------------------------------------------
  N.push(gate('Gate: hay filas nuevas', `return $input.all().filter(i => (i.json.appends || []).length);`, [880, 180]));
  N.push(http('Agregar filas', {
    method: 'POST', url: '={{ $json.url_append }}', ...sheetsAuth(),
    sendQuery: true, queryParameters: { parameters: [
      { name: 'valueInputOption', value: 'RAW' },
      { name: 'insertDataOption', value: 'INSERT_ROWS' },
    ] },
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ values: $json.appends }) }}',
  }, [1100, 180]));

  N.push(gate('Gate: hay celdas a actualizar', `return $input.all().filter(i => (i.json.updates || []).length);`, [880, 420]));
  N.push(http('Actualizar celdas', {
    method: 'POST', url: '={{ $json.url_batch }}', ...sheetsAuth(),
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ valueInputOption: "RAW", data: $json.updates }) }}',
  }, [1100, 420]));

  // ---- rama IA -----------------------------------------------------------
  N.push(gate('Gate: necesita IA', `return $input.all().filter(i => i.json.necesita_ia);`, [440, 40]));
  N.push(http('Gemini', {
    method: 'POST',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ contents: [{ parts: [{ text: $json.prompt_ia }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 800 } }) }}',
  }, [660, 40], { onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2 }));
  N.push(code('Aplicar IA', PARSEO_HOJAS + `
const ctx = $('Gate: necesita IA').first().json;
const { lista, config } = leerHojas($('Leer hojas').first().json);
const ahora = new Date().toISOString();

let salida = null;
try {
  const txt = $json.candidates[0].content.parts[0].text;
  salida = JSON.parse(txt.replace(/^\\\`\\\`\\\`json\\s*|\\s*\\\`\\\`\\\`$/g, ''));
} catch (e) { salida = null; }

const itemsIA = salida && Array.isArray(salida.items) ? validarItems(salida.items) : [];
const todos = fusionarDuplicados([...(ctx.items_locales || []), ...itemsIA]);

if (!todos.length) {
  return [{ json: { ...ctx, appends: [], updates: [],
    respuesta: 'No pude sacar ítems de eso 🤔 Escribí <b>ayuda</b> para ver qué entiendo.' } }];
}

const plan = planificarEscrituras(todos, lista,
  { ciclo: config.ciclo_activo, nombre: ctx.nombre, ahora, msgId: String(ctx.update_id) });

return [{ json: { ...ctx,
  respuesta: renderConfirmacion(plan.appends, plan.updates),
  appends: plan.appends.map(filaDesdeObjeto),
  updates: plan.updates.flatMap(u => {
    const f = lista.find(r => String(r.id) === String(u.id));
    return f ? [
      { range: 'Lista!E' + f._fila, values: [[u.cantidad]] },
      { range: 'Lista!D' + f._fila, values: [[u.variantes]] },
      { range: 'Lista!H' + f._fila, values: [[u.pedido_por]] },
    ] : [];
  }),
} }];
`, [880, 40]));

  const conexiones = conectar([
    ['Telegram Trigger', 'Leer hojas'],
    ['Leer hojas', 'Preparar'],
    ['Preparar', 'Gate: responder'],
    ['Preparar', 'Gate: necesita IA'],
    ['Preparar', 'Gate: audio'],
    ['Gate: responder', 'Responder'],
    ['Responder', 'Gate: hay filas nuevas'],
    ['Responder', 'Gate: hay celdas a actualizar'],
    ['Gate: hay filas nuevas', 'Agregar filas'],
    ['Gate: hay celdas a actualizar', 'Actualizar celdas'],
    ['Gate: necesita IA', 'Gemini'],
    ['Gemini', 'Aplicar IA'],
    ['Aplicar IA', 'Gate: responder'],
    ['Gate: audio', 'Telegram getFile'],
    ['Telegram getFile', 'Bajar audio'],
    ['Bajar audio', 'Transcribir (Groq Whisper)'],
    ['Transcribir (Groq Whisper)', 'Audio → texto'],
    ['Audio → texto', 'Gate: responder'],
  ]);

  return { name: 'compras-ingesta', nodes: N, connections: conexiones,
           settings: { timezone: 'America/Argentina/Buenos_Aires',
                       executionOrder: 'v1', errorWorkflow: '' },
           pinData: {} };
}

// ===========================================================================
//  WORKFLOW 2 — cierre mensual
// ===========================================================================
function mensual() {
  seq = 0;
  const N = [];

  N.push({ parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 9 1 * *' }] } },
           id: nid(), name: 'Día 1, 09:00', type: 'n8n-nodes-base.scheduleTrigger',
           typeVersion: 1.2, position: [-220, 300] });

  N.push(LEER_HOJAS([0, 300]));

  N.push(http('Leer historial', {
    method: 'GET', url: `${SHEETS}/values/Historial!A:Q`, ...sheetsAuth(),
  }, [220, 300]));

  N.push(code('Consolidar', PARSEO_HOJAS + `
const { lista, config } = leerHojas($('Leer hojas').first().json);
const historial = filasAObjetos($json);
const ahora = new Date().toISOString();
const c = consolidar(lista, historial, config);

// 1. El ciclo que se cierra se archiva en Historial.
const archivar = c.vivos.concat(c.descartados).map(r => filaDesdeObjeto(r).concat([ahora, 'cron']));

// 2. Los pendientes vivos se arrastran al ciclo nuevo y se marcan archivados acá.
const arrastrar = c.vivos.map(r => filaDesdeObjeto({
  ...r,
  id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
  ciclo: c.ciclo_nuevo,
  veces_arrastrado: Number(r.veces_arrastrado || 0) + 1,
  origen: 'arrastre',
}));

const updates = c.vivos.concat(c.descartados)
  .map(r => ({ range: 'Lista!K' + r._fila, values: [['archivado']] }));
// 3. El puntero del ciclo avanza.
const filaCiclo = filasAObjetos(($('Leer hojas').first().json.valueRanges || [])[2])
  .find(f => f.clave === 'ciclo_activo');
if (filaCiclo) updates.push({ range: 'Config!B' + filaCiclo._fila, values: [[c.ciclo_nuevo]] });

const texto = renderMensual(c);
return [{ json: {
  texto, partes: partirMensaje(texto),
  teclado: tecladoLista(c.vivos),
  chat_id: config.grupo_chat_id,
  url_responder: tg(config, 'sendMessage'),
  url_append_hist: '${SHEETS}/values/Historial!A:Q:append',
  url_append_lista: '${SHEETS}/values/Lista!A:O:append',
  url_batch: '${SHEETS}/values:batchUpdate',
  archivar, arrastrar, updates,
  resumen: c.total + ' ítems, ' + c.descartados.length + ' descartados',
} }];
`, [440, 300]));

  N.push(http('Mandar lista al grupo', {
    method: 'POST', url: '={{ $json.url_responder }}',
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ chat_id: $json.chat_id, text: $json.texto, parse_mode: "HTML", reply_markup: $json.teclado }) }}',
  }, [660, 300], { onError: 'continueRegularOutput' }));

  N.push(gate('Gate: hay algo que archivar', `return $input.all().filter(() => ($('Consolidar').first().json.archivar || []).length);`, [880, 180]));
  N.push(http('Archivar en Historial', {
    method: 'POST', url: '={{ $(\'Consolidar\').first().json.url_append_hist }}', ...sheetsAuth(),
    sendQuery: true, queryParameters: { parameters: [
      { name: 'valueInputOption', value: 'RAW' }, { name: 'insertDataOption', value: 'INSERT_ROWS' } ] },
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ values: $(\'Consolidar\').first().json.archivar }) }}',
  }, [1100, 180]));
  N.push(http('Arrastrar pendientes', {
    method: 'POST', url: '={{ $(\'Consolidar\').first().json.url_append_lista }}', ...sheetsAuth(),
    sendQuery: true, queryParameters: { parameters: [
      { name: 'valueInputOption', value: 'RAW' }, { name: 'insertDataOption', value: 'INSERT_ROWS' } ] },
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ values: $(\'Consolidar\').first().json.arrastrar }) }}',
  }, [1320, 180]));
  N.push(http('Cerrar ciclo', {
    method: 'POST', url: '={{ $(\'Consolidar\').first().json.url_batch }}', ...sheetsAuth(),
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ valueInputOption: "RAW", data: $(\'Consolidar\').first().json.updates }) }}',
  }, [1540, 180]));

  return { name: 'compras-mensual', nodes: N,
           connections: conectar([
             ['Día 1, 09:00', 'Leer hojas'],
             ['Leer hojas', 'Leer historial'],
             ['Leer historial', 'Consolidar'],
             ['Consolidar', 'Mandar lista al grupo'],
             ['Mandar lista al grupo', 'Gate: hay algo que archivar'],
             ['Gate: hay algo que archivar', 'Archivar en Historial'],
             ['Archivar en Historial', 'Arrastrar pendientes'],
             ['Arrastrar pendientes', 'Cerrar ciclo'],
           ]),
           settings: { timezone: 'America/Argentina/Buenos_Aires', executionOrder: 'v1' },
           pinData: {} };
}

// ===========================================================================
//  WORKFLOW 3 — errores
// ===========================================================================
function errores() {
  seq = 0;
  const N = [
    { parameters: {}, id: nid(), name: 'Error Trigger',
      type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 300] },
    LEER_HOJAS([220, 300]),
    gate('Armar aviso', PARSEO_HOJAS + `
const { config } = leerHojas($json);
const e = $('Error Trigger').first().json;
const txt = [
  '⚠️ <b>Falló ' + (e.workflow && e.workflow.name) + '</b>',
  'Nodo: ' + ((e.execution && e.execution.lastNodeExecuted) || '?'),
  'Error: ' + String((e.execution && e.execution.error && e.execution.error.message) || '?').slice(0, 400),
].join('\\n');
return [{ json: { chat_id: config.persona_1_user_id, texto: txt, url: tg(config, 'sendMessage') } }];
`, [440, 300]),
    http('Avisarme', {
      method: 'POST', url: '={{ $json.url }}',
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ chat_id: $json.chat_id, text: $json.texto, parse_mode: "HTML" }) }}',
    }, [660, 300]),
  ];
  return { name: 'compras-errores', nodes: N,
           connections: conectar([
             ['Error Trigger', 'Leer hojas'],
             ['Leer hojas', 'Armar aviso'],
             ['Armar aviso', 'Avisarme'],
           ]),
           settings: { timezone: 'America/Argentina/Buenos_Aires', executionOrder: 'v1' },
           pinData: {} };
}

// ---- salida ----------------------------------------------------------------
const dir = path.join(RAIZ, 'workflows');
fs.mkdirSync(dir, { recursive: true });
for (const [nombre, wf] of [['compras-ingesta', ingesta()],
                            ['compras-mensual', mensual()],
                            ['compras-errores', errores()]]) {
  const p = path.join(dir, nombre + '.json');
  fs.writeFileSync(p, JSON.stringify(wf, null, 2));
  console.log(`${nombre.padEnd(18)} ${String(wf.nodes.length).padStart(2)} nodos  ${(fs.statSync(p).size/1024).toFixed(0)} KB`);
}
