const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'workflows');
let errores = 0;
const err = m => { console.log('  ✗ ' + m); errores++; };

for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
  const wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  console.log(`\n${f}  (${wf.nodes.length} nodos)`);

  const nombres = new Set(wf.nodes.map(n => n.name));
  if (nombres.size !== wf.nodes.length) err('nombres de nodo duplicados');
  const ids = new Set(wf.nodes.map(n => n.id));
  if (ids.size !== wf.nodes.length) err('ids duplicados');

  // campos obligatorios
  for (const n of wf.nodes) {
    for (const k of ['parameters', 'id', 'name', 'type', 'typeVersion', 'position'])
      if (n[k] === undefined) err(`${n.name}: falta "${k}"`);
    if (!Array.isArray(n.position) || n.position.length !== 2) err(`${n.name}: position invalida`);
  }

  // conexiones: origen y destino existen
  const conectados = new Set();
  for (const [de, v] of Object.entries(wf.connections)) {
    if (!nombres.has(de)) err(`conexion desde nodo inexistente "${de}"`);
    for (const salida of v.main || [])
      for (const c of salida) {
        if (!nombres.has(c.node)) err(`"${de}" -> nodo inexistente "${c.node}"`);
        conectados.add(c.node); conectados.add(de);
      }
  }
  // nodos huerfanos (salvo triggers)
  for (const n of wf.nodes)
    if (!conectados.has(n.name) && !/trigger/i.test(n.type))
      err(`nodo huerfano: ${n.name}`);

  // exactamente un trigger
  const trig = wf.nodes.filter(n => /trigger/i.test(n.type));
  if (trig.length !== 1) err(`esperaba 1 trigger, hay ${trig.length}`);

  // el JS de cada Code node tiene que compilar
  let codeNodes = 0;
  for (const n of wf.nodes.filter(n => n.type === 'n8n-nodes-base.code')) {
    codeNodes++;
    try { new vm.Script(`(async () => {${n.parameters.jsCode}})`); }
    catch (e) { err(`${n.name}: JS no compila -> ${e.message}`); }
  }

  // las expresiones n8n arrancan con "=" y tienen llaves balanceadas
  let exprs = 0;
  const revisar = (obj, ruta) => {
    if (typeof obj === 'string') {
      if (obj.startsWith('={{') || obj.includes('{{')) {
        exprs++;
        const a = (obj.match(/\{\{/g) || []).length, b = (obj.match(/\}\}/g) || []).length;
        if (a !== b) err(`${ruta}: llaves {{ }} desbalanceadas`);
        if (obj.includes('{{') && !obj.startsWith('=')) err(`${ruta}: expresion sin "=" inicial`);
      }
    } else if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) revisar(v, `${ruta}.${k}`);
    }
  };
  for (const n of wf.nodes) {
    // jsCode es JS crudo, n8n no lo evalua como expresion
    const { jsCode, ...resto } = n.parameters;
    revisar(resto, n.name);
  }

  // el token del bot no puede estar hardcodeado
  const crudo = JSON.stringify(wf);
  if (/\d{8,10}:[A-Za-z0-9_-]{35}/.test(crudo)) err('parece haber un bot token hardcodeado');

  console.log(`  ${codeNodes} Code nodes compilan · ${exprs} expresiones · ` +
              `${Object.keys(wf.connections).length} nodos con salida`);
}
console.log(errores ? `\n${errores} PROBLEMAS` : '\n✓ los 3 workflows validan');
process.exit(errores ? 1 : 0);
