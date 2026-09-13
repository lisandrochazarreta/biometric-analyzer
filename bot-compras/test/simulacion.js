const C = require('../lib/compras');
const CAT = require('./catalogo.fixture.json');

const MENSAJES = [
  'leche','se terminó el café','papel higiénico x2','detergente y esponjas',
  'leche x3','yerba','falta lavandina','no hay más shampoo','fideos',
  'huevos','pan','queso','manteca','azucar','aceite','arroz',
  'se acabó el detergente','bolsas de basura','esponjas','papel de cocina',
  'coca x2','cerveza','vino tinto','agua x6','fernet','jugo',
  'medio kilo de queso','media docena de huevos','2 litros de leche',
  '3 paquetes de fideos','docena de huevos','un par de esponjas',
  'lechee','yerbaaa','deter','dentifrico','jabon en polvo',
  'pilas AA','lamparitas','comida de gato','pollo','carne picada',
  'acordate de comprar yerba','necesito papel higienico porfa',
  'lavandina, esponjas y bolsas de basura','pan y manteca','shampoo y acondicionador',
  'dulce de leche','puré de tomate','galletitas','mermelada','atun',
  'desodorante','maquinitas','suavizante','trapo de piso','limpiavidrios',
  'verduras','frutas','fiambre','polenta','lentejas','vinagre','sal','harina','te',
  'yogur','crema','queso rallado','soda','gaseosa','birra',
];

let ok = 0, items = 0, fallos = [];
for (const m of MENSAJES) {
  const r = C.normalizarLocal(m, CAT);
  items += r.items.length;
  if (r.resueltoTodo && r.items.length) ok++;
  else fallos.push(`${m}  ->  ${JSON.stringify(r.items.map(i => i.item))} | sin resolver: ${JSON.stringify(r.sinResolver)}`);
}
console.log(`mensajes:        ${MENSAJES.length}`);
console.log(`resueltos solos: ${ok}  (${(100*ok/MENSAJES.length).toFixed(0)}%)`);
console.log(`items extraidos: ${items}`);
console.log(`\nvan al LLM (${fallos.length}):`);
fallos.forEach(f => console.log('  ' + f));

// ruido: no deberia sacar nada
const RUIDO = ['jajaja','ok','dale','gracias','te amo','todo bien?','buenisimo','😂','listo'];
const falsosPositivos = RUIDO.filter(m => C.normalizarLocal(m, CAT).items.length > 0);
console.log(`\nruido mal interpretado como item: ${falsosPositivos.length}/${RUIDO.length}`,
            falsosPositivos.length ? JSON.stringify(falsosPositivos) : '✓');

// Mensajes deliberadamente FUERA del catalogo sembrado: deben ir al LLM.
const FUERA = [
  'queso azul','papel de aluminio','edulcorante','salsa de soja','curry',
  'pañales','protector solar','hilo dental','pasas de uva','leche de almendras',
  'dos latas de cerveza artesanal IPA','lo que sea que use ella para el pelo',
];
console.log('\n--- fuera del catalogo (deben ir al LLM) ---');
let derivados = 0;
for (const m of FUERA) {
  const r = C.normalizarLocal(m, CAT);
  const va = !r.resueltoTodo || !r.items.length;
  if (va) derivados++;
  console.log(`  ${va ? 'LLM ' : 'DICC'}  ${m}${va ? '' : '  -> ' + JSON.stringify(r.items.map(i => i.item))}`);
}
console.log(`derivados al LLM: ${derivados}/${FUERA.length}`);
