const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/compras');

// Catalogo minimo, mismo shape que la hoja "Catalogo".
const CAT = [
  { item_canonico: 'Leche', categoria: 'lácteos', alias: 'leche,lechee,leche entera,leche descremada,litro de leche' },
  { item_canonico: 'Café', categoria: 'almacén', alias: 'cafe,café,cafe molido,nescafe' },
  { item_canonico: 'Yerba', categoria: 'almacén', alias: 'yerba,yerba mate' },
  { item_canonico: 'Fideos', categoria: 'almacén', alias: 'fideos,tallarines,tirabuzon,mostachol' },
  { item_canonico: 'Papel higiénico', categoria: 'higiene', alias: 'papel higienico,papel,papel h,rollos' },
  { item_canonico: 'Papel de cocina', categoria: 'limpieza', alias: 'papel de cocina,rollo de cocina' },
  { item_canonico: 'Detergente', categoria: 'limpieza', alias: 'detergente,deter,magistral' },
  { item_canonico: 'Esponjas', categoria: 'limpieza', alias: 'esponjas,esponja,virulana' },
  { item_canonico: 'Lavandina', categoria: 'limpieza', alias: 'lavandina,ayudin' },
  { item_canonico: 'Huevos', categoria: 'frescos', alias: 'huevos,huevo,maple de huevos' },
  { item_canonico: 'Queso', categoria: 'lácteos', alias: 'queso,queso cremoso,cremoso' },
  { item_canonico: 'Gaseosa', categoria: 'bebidas', alias: 'gaseosa,coca,coca cola' },
  { item_canonico: 'Cerveza', categoria: 'bebidas', alias: 'cerveza,birra,porrones' },
  { item_canonico: 'Bolsas de residuo', categoria: 'limpieza', alias: 'bolsas,bolsas de basura,bolsas de residuo' },
];

const uno = (txt) => {
  const r = C.normalizarLocal(txt, CAT);
  assert.strictEqual(r.sinResolver.length, 0, `no resolvio: ${txt} -> ${JSON.stringify(r.sinResolver)}`);
  assert.strictEqual(r.items.length, 1, `esperaba 1 item en "${txt}", hubo ${r.items.length}`);
  return r.items[0];
};

// ----------------------------------------------------------- normalizacion

test('norm saca tildes, mayusculas y letras repetidas', () => {
  assert.strictEqual(C.norm('  LECHE  '), 'leche');
  assert.strictEqual(C.norm('Papel Higiénico'), 'papel higienico');
  assert.strictEqual(C.norm('yerbaaaa'), 'yerba');
  assert.strictEqual(C.norm('café ☕'), 'cafe');
});

test('clave ignora orden, plurales y palabras de relleno', () => {
  assert.strictEqual(C.clave('papel higienico'), C.clave('higienico papel'));
  assert.strictEqual(C.clave('esponjas'), C.clave('esponja'));
  assert.strictEqual(C.clave('1 litro de leche'), C.clave('leche 1 litro'));
});

// -------------------------------------------------------------- cantidades

test('parseCantidad entiende los formatos que usa la gente', () => {
  const casos = [
    ['papel higienico x2', 2, 'u', 'papel higienico'],
    ['leche', 1, 'u', 'leche'],
    ['2 litros de leche', 2, 'l', 'de leche'],
    ['medio kilo de queso', 0.5, 'kg', 'de queso'],
    ['media docena de huevos', 6, 'u', 'de huevos'],
    ['docena de huevos', 12, 'u', 'de huevos'],
    ['un par de esponjas', 2, 'u', 'de esponjas'],
    ['3 paquetes de fideos', 3, 'paq', 'de fideos'],
    ['dos litros de leche', 2, 'l', 'de leche'],
    ['4 yogures', 4, 'u', 'yogures'],
  ];
  for (const [txt, cant, un, resto] of casos) {
    const r = C.parseCantidad(txt);
    assert.strictEqual(r.cantidad, cant, `cantidad de "${txt}"`);
    assert.strictEqual(r.unidad, un, `unidad de "${txt}"`);
    assert.strictEqual(r.resto, resto, `resto de "${txt}"`);
  }
});

test('parseCantidad no deja pasar cantidades absurdas ni negativas', () => {
  assert.strictEqual(C.parseCantidad('leche x9999').cantidad, 99);
  assert.strictEqual(C.parseCantidad('leche x0').cantidad, 1);
});

// --------------------------------------------- los mensajes del enunciado

test('los 4 ejemplos que dio el usuario salen bien sin IA', () => {
  assert.deepStrictEqual(
    (({ item, cantidad, categoria }) => ({ item, cantidad, categoria }))(uno('leche')),
    { item: 'Leche', cantidad: 1, categoria: 'lácteos' });

  assert.strictEqual(uno('se terminó el café').item, 'Café');

  const ph = uno('papel higiénico x2');
  assert.strictEqual(ph.item, 'Papel higiénico');
  assert.strictEqual(ph.cantidad, 2);

  const dos = C.normalizarLocal('detergente y esponjas', CAT);
  assert.strictEqual(dos.sinResolver.length, 0);
  assert.deepStrictEqual(dos.items.map(i => i.item), ['Detergente', 'Esponjas']);
});

test('variantes de "se termino" y frases con relleno', () => {
  for (const t of ['se terminó el café', 'no hay más café', 'falta café',
                   'comprar café', 'acordate de comprar café', 'se nos terminó el café',
                   'necesito café porfa', 'CAFÉ']) {
    assert.strictEqual(uno(t).item, 'Café', `fallo: "${t}"`);
  }
});

test('multi-item con separadores variados', () => {
  const r = C.normalizarLocal('lavandina, esponjas y bolsas de basura', CAT);
  assert.strictEqual(r.sinResolver.length, 0);
  assert.deepStrictEqual(r.items.map(i => i.item),
    ['Lavandina', 'Esponjas', 'Bolsas de residuo']);
});

test('cantidad + nota de variante en el mismo segmento', () => {
  const r = uno('fideos x3 tirabuzon');
  assert.strictEqual(r.item, 'Fideos');
  assert.strictEqual(r.cantidad, 3);
});

test('typos y alargues se resuelven solos', () => {
  assert.strictEqual(uno('yerbaaa').item, 'Yerba');
  assert.strictEqual(uno('lechee').item, 'Leche');
  assert.strictEqual(uno('deter').item, 'Detergente');
});

test('productos parecidos NO se confunden', () => {
  assert.strictEqual(uno('papel higienico').item, 'Papel higiénico');
  assert.strictEqual(uno('papel de cocina').item, 'Papel de cocina');
  assert.strictEqual(uno('coca').item, 'Gaseosa');
});

test('un mensaje que no tiene ningun producto queda sin resolver', () => {
  for (const t of ['jajaja', 'todo bien amor?', 'ok', 'dale gracias']) {
    const r = C.normalizarLocal(t, CAT);
    assert.strictEqual(r.items.length, 0, `no deberia sacar items de "${t}"`);
  }
});

test('repetir el mismo producto en un mensaje suma en vez de duplicar', () => {
  const r = C.normalizarLocal('cafe y cafe molido', CAT);
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].item, 'Café');
  assert.strictEqual(r.items[0].cantidad, 2);
});

// ---------------------------------------------------------------- comandos

test('router de comandos', () => {
  const casos = [
    ['lista', 'lista'], ['Lista', 'lista'], ['/lista', 'lista'],
    ['pasame la lista', 'lista'], ['ayuda', 'ayuda'], ['/start', 'ayuda'],
    ['ya compré', 'comprado'], ['ya compramos', 'comprado'], ['listo', 'comprado'],
    ['reset', 'reset'], ['confirmar reset', 'reset_confirmado'],
    ['deshacer', 'deshacer'],
  ];
  for (const [txt, esperado] of casos) {
    assert.strictEqual(C.routerComandos(txt).comando, esperado, `"${txt}"`);
  }
});

test('borrar y negaciones capturan el argumento', () => {
  assert.deepStrictEqual(C.routerComandos('borrar leche'), { comando: 'borrar', argumento: 'leche' });
  assert.deepStrictEqual(C.routerComandos('sacá la cerveza'), { comando: 'borrar', argumento: 'la cerveza' });
  assert.deepStrictEqual(C.routerComandos('no compres más gaseosa'), { comando: 'borrar', argumento: 'gaseosa' });
  assert.strictEqual(C.routerComandos('ya compré leche, café').argumento, 'leche, cafe');
});

test('un item suelto NO se confunde con un comando', () => {
  for (const t of ['leche', 'café', 'papel higiénico x2', 'detergente y esponjas']) {
    assert.strictEqual(C.routerComandos(t).comando, null, `"${t}" no es comando`);
  }
});

// ------------------------------------------------------------- validacion

test('validarItems blinda salidas rotas del LLM', () => {
  const sucio = [
    { item: 'Leche', cantidad: 400, unidad: 'litros', categoria: 'supermercado', confianza: 0.9 },
    { item: 'x', cantidad: 1, categoria: 'otros', confianza: 1 },
    { item: 'Dudoso', cantidad: 1, categoria: 'otros', confianza: 0.1 },
    { item: 'Café', cantidad: 'dos', unidad: 'u', categoria: 'almacén', confianza: 0.9 },
    null,
  ];
  const ok = C.validarItems(sucio);
  assert.strictEqual(ok.length, 2);
  assert.strictEqual(ok[0].cantidad, 99);
  assert.strictEqual(ok[0].unidad, 'u');
  assert.strictEqual(ok[0].categoria, 'otros');
  assert.strictEqual(ok[1].cantidad, 1);
});

test('validarItems corta a 15 items', () => {
  const muchos = Array.from({ length: 40 }, (_, i) => ({ item: `Item ${i}`, cantidad: 1, categoria: 'otros' }));
  assert.strictEqual(C.validarItems(muchos).length, 15);
});

// ------------------------------------------------------------------ dedup

const LISTA = [
  { id: 'a1', ciclo: '2026-10', item: 'Leche', cantidad: 1, unidad: 'u', categoria: 'lácteos',
    estado: 'pendiente', variantes: 'leche', pedido_por: 'Flor', veces_arrastrado: 0 },
  { id: 'a2', ciclo: '2026-10', item: 'Café', cantidad: 2, unidad: 'u', categoria: 'almacén',
    estado: 'pendiente', variantes: 'cafe', pedido_por: 'Lisandro', veces_arrastrado: 0 },
  { id: 'a3', ciclo: '2026-10', item: 'Cerveza', cantidad: 6, unidad: 'u', categoria: 'bebidas',
    estado: 'comprado', variantes: 'birra', pedido_por: 'Lisandro', veces_arrastrado: 0 },
];

test('"1 litro de leche" suma a la Leche ya cargada, no crea fila nueva', () => {
  const items = C.normalizarLocal('1 litro de leche', CAT).items;
  const { appends, updates } = C.planificarEscrituras(items, LISTA,
    { ciclo: '2026-10', nombre: 'Lisandro', ahora: '2026-09-13T12:00:00Z' });
  assert.strictEqual(appends.length, 0);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].id, 'a1');
  assert.strictEqual(updates[0].cantidad, 2);
  assert.strictEqual(updates[0].pedido_por, 'Flor, Lisandro');
});

test('un item nuevo genera append con todas las columnas', () => {
  const items = C.normalizarLocal('lavandina x2', CAT).items;
  const { appends, updates } = C.planificarEscrituras(items, LISTA,
    { ciclo: '2026-10', nombre: 'Flor', ahora: '2026-09-13T12:00:00Z', msgId: '42' });
  assert.strictEqual(updates.length, 0);
  assert.strictEqual(appends.length, 1);
  const a = appends[0];
  assert.strictEqual(a.item, 'Lavandina');
  assert.strictEqual(a.cantidad, 2);
  assert.strictEqual(a.estado, 'pendiente');
  assert.strictEqual(a.ciclo, '2026-10');
  assert.strictEqual(a.msg_origen, '42');
  assert.ok(a.id);
});

test('un item comprado NO bloquea volver a pedirlo', () => {
  const items = C.normalizarLocal('birra', CAT).items;
  const { appends } = C.planificarEscrituras(items, LISTA, { ciclo: '2026-10' });
  assert.strictEqual(appends.length, 1, 'Cerveza ya comprada debe poder re-pedirse');
});

test('dos menciones del mismo item nuevo en un mensaje no crean dos filas', () => {
  const items = C.validarItems([
    { item: 'Lavandina', cantidad: 1, categoria: 'limpieza', confianza: 1 },
    { item: 'Lavandina', cantidad: 2, categoria: 'limpieza', confianza: 1 },
  ]);
  const { appends, updates } = C.planificarEscrituras(C.fusionarDuplicados(items), LISTA, { ciclo: '2026-10' });
  assert.strictEqual(appends.length, 1);
  assert.strictEqual(appends[0].cantidad, 3);
  assert.strictEqual(updates.length, 0);
});

// ----------------------------------------------------------------- borrar

test('matchParaBorrar acierta, pregunta si hay empate y avisa si no esta', () => {
  assert.strictEqual(C.matchParaBorrar('leche', LISTA).estado, 'ok');
  assert.strictEqual(C.matchParaBorrar('cafe', LISTA).estado, 'ok');
  assert.strictEqual(C.matchParaBorrar('cerveza', LISTA).estado, 'no_encontrado', 'ya comprada, no pendiente');
  assert.strictEqual(C.matchParaBorrar('chocolate', LISTA).estado, 'no_encontrado');

  const ambiguo = [
    { id: 'p1', item: 'Papel higiénico', estado: 'pendiente' },
    { id: 'p2', item: 'Papel de cocina', estado: 'pendiente' },
  ];
  assert.strictEqual(C.matchParaBorrar('papel', ambiguo).estado, 'ambiguo');
  assert.strictEqual(C.matchParaBorrar('papel higienico', ambiguo).estado, 'ok');
});

// ------------------------------------------------------------------ ciclos

test('aritmetica de ciclos cruza el año', () => {
  assert.strictEqual(C.cicloAnterior('2026-01'), '2025-12');
  assert.strictEqual(C.cicloSiguiente('2026-12'), '2027-01');
  assert.strictEqual(C.cicloSiguiente('2026-09'), '2026-10');
  assert.strictEqual(C.nombreMes('2026-10'), 'octubre');
});

// ------------------------------------------------------------- consolidar

const HIST = [
  { ciclo: '2026-09', item: 'Café', estado: 'comprado' },
  { ciclo: '2026-09', item: 'Leche', estado: 'comprado' },
  { ciclo: '2026-09', item: 'Lavandina', estado: 'no_comprado' },
  { ciclo: '2026-08', item: 'Yerba', estado: 'comprado' },
];

const LISTA_MES = [
  { id: '1', ciclo: '2026-10', item: 'Café', cantidad: 2, unidad: 'u', categoria: 'almacén', estado: 'pendiente', veces_arrastrado: 0 },
  { id: '2', ciclo: '2026-10', item: 'Leche', cantidad: 4, unidad: 'u', categoria: 'lácteos', estado: 'pendiente', veces_arrastrado: 0 },
  { id: '3', ciclo: '2026-10', item: 'Lavandina', cantidad: 1, unidad: 'u', categoria: 'limpieza', estado: 'pendiente', veces_arrastrado: 1 },
  { id: '4', ciclo: '2026-10', item: 'Yerba', cantidad: 1, unidad: 'u', categoria: 'almacén', estado: 'pendiente', veces_arrastrado: 0 },
  { id: '5', ciclo: '2026-10', item: 'Velas', cantidad: 1, unidad: 'u', categoria: 'otros', estado: 'pendiente', veces_arrastrado: 3 },
  { id: '6', ciclo: '2026-11', item: 'Pan', cantidad: 1, unidad: 'u', categoria: 'frescos', estado: 'pendiente', veces_arrastrado: 0 },
];

test('consolidar separa repetidos, arrastrados, nuevos y descartados', () => {
  const c = C.consolidar(LISTA_MES, HIST, { ciclo_activo: '2026-10', max_arrastres: 3 });
  assert.strictEqual(c.total, 4, 'Velas se descarta y Pan es del ciclo siguiente');
  assert.deepStrictEqual(c.repetidos.map(r => r.item).sort(), ['Café', 'Leche']);
  assert.deepStrictEqual(c.arrastrados.map(r => r.item), ['Lavandina']);
  assert.deepStrictEqual(c.nuevos.map(r => r.item), ['Yerba'], 'Yerba se compro en agosto, no en septiembre');
  assert.deepStrictEqual(c.descartados.map(r => r.item), ['Velas']);
  assert.strictEqual(c.ciclo_nuevo, '2026-11');
  assert.strictEqual(c.mes, 'octubre');
});

test('consolidar agrupa por categoria en orden de recorrido del super', () => {
  const c = C.consolidar(LISTA_MES, HIST, { ciclo_activo: '2026-10' });
  assert.deepStrictEqual(c.porCategoria.map(g => g.categoria), ['almacén', 'lácteos', 'limpieza']);
  assert.deepStrictEqual(c.porCategoria[0].filas.map(r => r.item), ['Café', 'Yerba']);
});

test('un mes sin nada anotado no rompe', () => {
  const c = C.consolidar([], [], { ciclo_activo: '2026-10' });
  assert.strictEqual(c.total, 0);
  assert.match(C.renderMensual(c), /No hay nada anotado/);
});

// ------------------------------------------------------------------ render

test('el mensaje mensual tiene las 3 comparaciones y los items', () => {
  const txt = C.renderMensual(C.consolidar(LISTA_MES, HIST, { ciclo_activo: '2026-10', max_arrastres: 3 }));
  assert.match(txt, /Compra de octubre/);
  assert.match(txt, /Café x2/);
  assert.match(txt, /Se repite del mes pasado/);
  assert.match(txt, /Quedó pendiente el mes pasado/);
  assert.match(txt, /Nuevo este mes/);
  assert.ok(!txt.includes('Pan'), 'no debe filtrarse el ciclo siguiente');
  assert.ok(txt.length < 4096, 'entra en un mensaje de Telegram');
});

test('lineaItem no escribe "x1" al pedo', () => {
  assert.strictEqual(C.lineaItem({ item: 'Leche', cantidad: 1, unidad: 'u' }), '• Leche');
  assert.strictEqual(C.lineaItem({ item: 'Leche', cantidad: 3, unidad: 'u' }), '• Leche x3');
  assert.strictEqual(C.lineaItem({ item: 'Queso', cantidad: 0.5, unidad: 'kg' }), '• Queso x0.5kg');
});

test('renderLista avisa cuando esta vacia', () => {
  assert.match(C.renderLista([]), /vacía/);
  assert.match(C.renderLista(LISTA), /Leche/);
});

test('partirMensaje respeta el limite de Telegram', () => {
  const largo = Array.from({ length: 400 }, (_, i) => `• Item numero ${i}`).join('\n\n');
  const partes = C.partirMensaje(largo);
  assert.ok(partes.length > 1);
  for (const p of partes) assert.ok(p.length <= 3900, 'cada parte entra en un mensaje');
  assert.strictEqual(partes.join('\n\n'), largo, 'no se pierde contenido');
});

test('tecladoLista genera un callback por fila y el boton de cierre', () => {
  const kb = C.tecladoLista(LISTA.filter(r => r.estado === 'pendiente'));
  assert.strictEqual(kb.inline_keyboard.length, 3);
  assert.strictEqual(kb.inline_keyboard[0][0].callback_data, 'ok:a1');
  assert.strictEqual(kb.inline_keyboard[2][0].callback_data, 'comprado:all');
  for (const fila of kb.inline_keyboard)
    assert.ok(Buffer.byteLength(fila[0].callback_data) <= 64, 'Telegram limita callback_data a 64 bytes');
});

// ------------------------------------------- regresiones halladas simulando

test('un alias generico + modificador NO se resuelve solo (va al LLM)', () => {
  // "papel" es alias de Papel higienico, pero papel de aluminio es otra cosa.
  for (const t of ['papel de aluminio', 'leche de almendras', 'queso azul']) {
    const r = C.normalizarLocal(t, CAT);
    assert.strictEqual(r.resueltoTodo, false, `"${t}" no deberia resolverse con el diccionario`);
  }
});

test('pero si lo que sobra es otro alias del mismo item, si resuelve', () => {
  const r = C.normalizarLocal('fideos tirabuzon', CAT);
  assert.strictEqual(r.resueltoTodo, true);
  assert.strictEqual(r.items[0].item, 'Fideos');
});

test('"te amo" no es un pedido de te', () => {
  const cat = [...CAT, { item_canonico: 'Té', categoria: 'almacén', alias: 'te,té,saquitos de te' }];
  assert.strictEqual(C.normalizarLocal('te amo', cat).items.length, 0);
  assert.strictEqual(C.normalizarLocal('te', cat).items[0].item, 'Té', 'pero "te" solo si');
});

test('"un par de" funciona aunque limpiarPrefijos ya haya comido el "un"', () => {
  assert.strictEqual(C.parseCantidad('par de esponjas').cantidad, 2);
  const r = C.normalizarLocal('un par de esponjas', CAT);
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].item, 'Esponjas');
  assert.strictEqual(r.items[0].cantidad, 2);
});

test('cantidades con digitos repetidos no se colapsan', () => {
  assert.strictEqual(C.parseCantidad('leche x22').cantidad, 22);
  assert.strictEqual(C.norm('x2222'), 'x2222');
});

test('esc evita que un & o un < rompan el mensaje HTML de Telegram', () => {
  assert.strictEqual(C.esc('Ron & Cola'), 'Ron &amp; Cola');
  assert.strictEqual(C.esc('<b>hack</b>'), '&lt;b&gt;hack&lt;/b&gt;');
  assert.strictEqual(C.lineaItem({ item: 'Ron & Cola', cantidad: 1, unidad: 'u' }), '• Ron &amp; Cola');
  const lista = [{ id: 'x', item: 'M&Ms', cantidad: 1, unidad: 'u', categoria: 'almacén', estado: 'pendiente' }];
  assert.ok(C.renderLista(lista).includes('M&amp;Ms'));
  assert.ok(!/M&Ms/.test(C.renderLista(lista)), 'el & crudo no debe quedar');
});
