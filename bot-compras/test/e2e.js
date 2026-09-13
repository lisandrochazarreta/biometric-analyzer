/**
 * Corre el Code node "Preparar" del workflow generado contra una respuesta
 * simulada de Sheets batchGet. Verifica el pegamento (parseo de hojas ->
 * decision -> filas/celdas a escribir), que es lo que la suite unitaria no ve.
 *
 *   node test/e2e.js
 */
const fs = require('fs'), vm = require('vm'), assert = require('node:assert');

const wf = JSON.parse(fs.readFileSync(__dirname + '/../workflows/compras-ingesta.json', 'utf8'));
const nodo = n => wf.nodes.find(x => x.name === n).parameters.jsCode;
const CAT = require('./catalogo.fixture.json');

const HEAD_LISTA = ['id','ciclo','item','variantes','cantidad','unidad','categoria','pedido_por',
                    'nota','fecha_alta','estado','fecha_compra','veces_arrastrado','origen','msg_origen'];

function hojas({ lista = [], config = {} } = {}) {
  const cfg = {
    ciclo_activo: '2026-10', telegram_bot_token: '123456789:FAKE_TOKEN_PARA_TEST',
    persona_1_user_id: '111', persona_1_nombre: 'Lisandro',
    persona_2_user_id: '222', persona_2_nombre: 'Flor',
    grupo_chat_id: '-100999', usar_ia: 'true', max_arrastres: '3', ...config,
  };
  return { valueRanges: [
    { values: [HEAD_LISTA, ...lista.map(r => HEAD_LISTA.map(h => r[h] != null ? r[h] : ''))] },
    { values: [['item_canonico','categoria','alias','frecuencia','ultima_vez'],
               ...CAT.map(c => [c.item_canonico, c.categoria, c.alias, 0, ''])] },
    { values: [['clave','valor','descripcion'], ...Object.entries(cfg).map(([k, v]) => [k, v, ''])] },
  ] };
}

function correr(codigo, { update, hojasResp, extra = {} }) {
  const ctx = {
    'Leer hojas': [{ json: hojasResp }],
    'Telegram Trigger': [{ json: update }],
    ...extra,
  };
  const $ = (n) => {
    if (!ctx[n]) throw new Error(`nodo "${n}" no ejecutado`);
    return { first: () => ctx[n][0], all: () => ctx[n] };
  };
  const sandbox = { $, $json: (extra.__json || ctx['Leer hojas'][0].json), console, Date, Math, JSON, Buffer,
                    $input: { all: () => ctx['Leer hojas'] } };
  return vm.runInNewContext(`(function(){${codigo}})()`, sandbox);
}

const msg = (texto, userId = '111', nombre = 'Lisandro') => ({
  update_id: 1000 + Math.floor(Math.random() * 1000),
  message: { message_id: 5, chat: { id: -100999 }, from: { id: Number(userId), first_name: nombre }, text: texto },
});

const PREPARAR = nodo('Preparar');
let ok = 0, fail = 0;
const check = (nombre, fn) => {
  try { fn(); console.log('  ✓ ' + nombre); ok++; }
  catch (e) { console.log('  ✗ ' + nombre + '\n      ' + e.message); fail++; }
};

console.log('\nCode node "Preparar" — end to end\n');

check('un item nuevo produce una fila completa de 15 columnas', () => {
  const [out] = correr(PREPARAR, { update: msg('lavandina x2'), hojasResp: hojas() });
  const j = out.json;
  assert.strictEqual(j.appends.length, 1);
  assert.strictEqual(j.appends[0].length, 15, 'la fila debe tener 15 columnas');
  assert.strictEqual(j.appends[0][2], 'Lavandina', 'columna C = item');
  assert.strictEqual(j.appends[0][4], 2, 'columna E = cantidad');
  assert.strictEqual(j.appends[0][6], 'limpieza', 'columna G = categoria');
  assert.strictEqual(j.appends[0][10], 'pendiente', 'columna K = estado');
  assert.strictEqual(j.appends[0][1], '2026-10', 'columna B = ciclo');
  assert.match(j.respuesta, /Anoté/);
  assert.strictEqual(j.necesita_ia, false);
});

check('un item ya cargado actualiza la celda de cantidad de la fila correcta', () => {
  const lista = [{ id: 'a1', ciclo: '2026-10', item: 'Leche', cantidad: 1, unidad: 'u',
                   categoria: 'lácteos', estado: 'pendiente', variantes: 'leche', pedido_por: 'Flor' }];
  const [out] = correr(PREPARAR, { update: msg('2 litros de leche'), hojasResp: hojas({ lista }) });
  const j = out.json;
  assert.strictEqual(j.appends.length, 0, 'no debe crear fila nueva');
  const cant = j.updates.find(u => u.range.startsWith('Lista!E'));
  assert.ok(cant, 'debe actualizar la columna E');
  assert.strictEqual(cant.range, 'Lista!E2', 'la fila 2 es la primera de datos');
  assert.strictEqual(cant.values[0][0], 3, '1 que habia + 2 nuevos');
  const quien = j.updates.find(u => u.range.startsWith('Lista!H'));
  assert.strictEqual(quien.values[0][0], 'Flor, Lisandro');
});

check('el numero de fila se calcula bien con varias filas', () => {
  const lista = [
    { id: 'a1', ciclo: '2026-10', item: 'Café', cantidad: 1, estado: 'pendiente', categoria: 'almacén' },
    { id: 'a2', ciclo: '2026-10', item: 'Pan', cantidad: 1, estado: 'comprado', categoria: 'frescos' },
    { id: 'a3', ciclo: '2026-10', item: 'Leche', cantidad: 2, estado: 'pendiente', categoria: 'lácteos' },
  ];
  const [out] = correr(PREPARAR, { update: msg('leche'), hojasResp: hojas({ lista }) });
  const cant = out.json.updates.find(u => u.range.startsWith('Lista!E'));
  assert.strictEqual(cant.range, 'Lista!E4', 'Leche esta en la 3er fila de datos = fila 4');
  assert.strictEqual(cant.values[0][0], 3);
});

check('un numero no autorizado se ignora en silencio', () => {
  const out = correr(PREPARAR, { update: msg('leche', '999', 'Random'), hojasResp: hojas() });
  assert.strictEqual(out.length, 0, 'no debe responder nada');
});

check('"lista" arma el texto y el teclado inline', () => {
  const lista = [
    { id: 'a1', ciclo: '2026-10', item: 'Café', cantidad: 2, estado: 'pendiente', categoria: 'almacén' },
    { id: 'a2', ciclo: '2026-10', item: 'Leche', cantidad: 1, estado: 'pendiente', categoria: 'lácteos' },
  ];
  const [out] = correr(PREPARAR, { update: msg('lista'), hojasResp: hojas({ lista }) });
  assert.match(out.json.respuesta, /Café x2/);
  assert.strictEqual(out.json.teclado.inline_keyboard.length, 3, '2 items + boton de cierre');
  assert.strictEqual(out.json.teclado.inline_keyboard[0][0].callback_data, 'ok:a1');
});

check('"ya compré" marca estado y fecha de todos los pendientes', () => {
  const lista = [
    { id: 'a1', ciclo: '2026-10', item: 'Café', cantidad: 1, estado: 'pendiente', categoria: 'almacén' },
    { id: 'a2', ciclo: '2026-10', item: 'Pan', cantidad: 1, estado: 'comprado', categoria: 'frescos' },
    { id: 'a3', ciclo: '2026-10', item: 'Leche', cantidad: 1, estado: 'pendiente', categoria: 'lácteos' },
  ];
  const [out] = correr(PREPARAR, { update: msg('ya compré'), hojasResp: hojas({ lista }) });
  const estados = out.json.updates.filter(u => u.range.startsWith('Lista!K'));
  assert.strictEqual(estados.length, 2, 'solo los 2 pendientes');
  assert.deepStrictEqual(estados.map(u => u.range).sort(), ['Lista!K2', 'Lista!K4']);
  assert.ok(estados.every(u => u.values[0][0] === 'comprado'));
  assert.strictEqual(out.json.updates.filter(u => u.range.startsWith('Lista!L')).length, 2, 'y la fecha');
});

check('"reset" pide confirmacion y no escribe nada', () => {
  const lista = [{ id: 'a1', ciclo: '2026-10', item: 'Café', cantidad: 1, estado: 'pendiente', categoria: 'almacén' }];
  const [out] = correr(PREPARAR, { update: msg('reset'), hojasResp: hojas({ lista }) });
  assert.match(out.json.respuesta, /confirmar reset/);
  assert.strictEqual(out.json.updates.length, 0, 'reset solo NO borra');
  const [out2] = correr(PREPARAR, { update: msg('confirmar reset'), hojasResp: hojas({ lista }) });
  assert.strictEqual(out2.json.updates.length, 1);
  assert.strictEqual(out2.json.updates[0].values[0][0], 'descartado');
});

check('"borrar X" ambiguo pregunta en vez de adivinar', () => {
  const lista = [
    { id: 'p1', ciclo: '2026-10', item: 'Papel higiénico', cantidad: 1, estado: 'pendiente', categoria: 'higiene' },
    { id: 'p2', ciclo: '2026-10', item: 'Papel de cocina', cantidad: 1, estado: 'pendiente', categoria: 'limpieza' },
  ];
  const [out] = correr(PREPARAR, { update: msg('borrar papel'), hojasResp: hojas({ lista }) });
  assert.match(out.json.respuesta, /¿Cuál\?/);
  assert.strictEqual(out.json.updates.length, 0, 'no borra nada si duda');
});

check('el boton ✅ marca ese item por su id', () => {
  const lista = [{ id: 'a1', ciclo: '2026-10', item: 'Café', cantidad: 1, estado: 'pendiente', categoria: 'almacén' }];
  const [out] = correr(PREPARAR, {
    update: { update_id: 7, callback_query: { id: 'cb1', data: 'ok:a1', from: { id: 222, first_name: 'Flor' },
              message: { message_id: 9, chat: { id: -100999 } } } },
    hojasResp: hojas({ lista }),
  });
  assert.match(out.json.respuesta, /Café/);
  assert.strictEqual(out.json.updates[0].range, 'Lista!K2');
  assert.strictEqual(out.json.updates[0].values[0][0], 'comprado');
});

check('un mensaje fuera del catalogo arma el prompt y NO escribe todavia', () => {
  const [out] = correr(PREPARAR, { update: msg('hilo dental y pañales'), hojasResp: hojas() });
  assert.strictEqual(out.json.necesita_ia, true);
  assert.strictEqual(out.json.appends.length, 0);
  assert.ok(out.json.prompt_ia.includes('hilo dental'), 'el mensaje va en el prompt');
  assert.ok(!out.json.prompt_ia.includes('__MENSAJE__'), 'placeholders reemplazados');
  assert.ok(!out.json.prompt_ia.includes('__LISTA__'));
  assert.ok(!out.json.prompt_ia.includes('__CATALOGO__'));
});

check('con usar_ia=false nunca se llama al LLM', () => {
  const [out] = correr(PREPARAR, { update: msg('hilo dental'), hojasResp: hojas({ config: { usar_ia: 'false' } }) });
  assert.strictEqual(out.json.necesita_ia, false);
  assert.match(out.json.respuesta, /No pude sacar ítems/);
});

check('mensaje mixto: anota lo que entiende y deriva el resto', () => {
  const [out] = correr(PREPARAR, { update: msg('leche y hilo dental'), hojasResp: hojas() });
  assert.strictEqual(out.json.necesita_ia, true);
  assert.strictEqual(out.json.items_locales.length, 1, 'la leche ya esta resuelta');
  assert.strictEqual(out.json.items_locales[0].item, 'Leche');
  // lo que se le manda al LLM es solo la seccion MENSAJE del prompt
  const enviado = out.json.prompt_ia.split('MENSAJE:')[1];
  assert.ok(enviado.includes('hilo dental'));
  assert.ok(!enviado.includes('leche'), 'no se le manda al LLM lo que ya se resolvio');
  assert.strictEqual(out.json.pendientes_ia.join('|'), 'hilo dental');
});

check('las URLs se arman con el token de Config, no hardcodeadas', () => {
  const [out] = correr(PREPARAR, { update: msg('leche'), hojasResp: hojas() });
  assert.strictEqual(out.json.url_responder,
    'https://api.telegram.org/bot123456789:FAKE_TOKEN_PARA_TEST/sendMessage');
  assert.match(out.json.url_append, /\/values\/Lista!A:O:append$/);
  assert.match(out.json.url_batch, /values:batchUpdate$/);
});

check('un audio se deriva a la rama de transcripcion', () => {
  const [out] = correr(PREPARAR, {
    update: { update_id: 8, message: { message_id: 3, chat: { id: -100999 },
              from: { id: 111, first_name: 'Lisandro' }, voice: { file_id: 'AwACAgEAA' } } },
    hojasResp: hojas(),
  });
  assert.strictEqual(out.json.es_audio, true);
  assert.strictEqual(out.json.file_id, 'AwACAgEAA');
  assert.match(out.json.url_getfile, /\/getFile$/);
});

check('una foto responde que solo entiende texto y audio', () => {
  const [out] = correr(PREPARAR, {
    update: { update_id: 9, message: { message_id: 4, chat: { id: -100999 },
              from: { id: 111, first_name: 'Lisandro' }, photo: [{ file_id: 'x' }] } },
    hojasResp: hojas(),
  });
  assert.match(out.json.respuesta, /solo entiendo texto y audios/);
  assert.strictEqual(out.json.appends.length, 0);
});

check('una hoja Lista vacia no rompe', () => {
  const [out] = correr(PREPARAR, { update: msg('leche'), hojasResp: hojas({ lista: [] }) });
  assert.strictEqual(out.json.appends.length, 1);
});

console.log(`\n${ok} ok, ${fail} fallando\n`);
process.exit(fail ? 1 : 0);
