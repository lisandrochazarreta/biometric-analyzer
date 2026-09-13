/**
 * Logica pura del bot de lista de compras.
 *
 * Sin dependencias y sin I/O a proposito: todo lo que hay aca se testea en
 * bot-compras/test/ y despues se inyecta tal cual dentro de los Code nodes de
 * n8n (ver tools/build_workflows.js). Fuente unica de verdad.
 */

// ---------------------------------------------------------------- constantes

const CATEGORIAS = ['almacén', 'lácteos', 'limpieza', 'higiene', 'bebidas', 'frescos', 'otros'];
const UNIDADES = ['u', 'kg', 'g', 'l', 'ml', 'paq', 'docena'];

// Orden de recorrido del super, no alfabetico.
const ORDEN_CATEGORIAS = ['almacén', 'lácteos', 'frescos', 'limpieza', 'higiene', 'bebidas', 'otros'];

const EMOJI_CATEGORIA = {
  'almacén': '🥫', 'lácteos': '🥛', 'frescos': '🥬',
  'limpieza': '🧼', 'higiene': '🧴', 'bebidas': '🍷', 'otros': '📦',
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Se sacan del principio del segmento antes de buscar el producto.
const PREFIJOS_RUIDO = [
  'se nos termino', 'se nos acabo', 'se termino', 'se acabo', 'se acaba',
  'hay que comprar', 'hay que traer', 'tenemos que comprar', 'acordate de',
  'no hay mas', 'no queda mas', 'no hay', 'no queda', 'nos falta', 'me falta',
  'falta', 'faltan', 'comprar', 'compra', 'traer', 'trae', 'necesito',
  'necesitamos', 'anota', 'anotar', 'agrega', 'agregar', 'sumar', 'poner',
  'pone', 'agregame', 'anotame',
];

const PALABRAS_RUIDO = ['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos',
                        'unas', 'mas', 'por', 'para', 'porfa', 'porfavor', 'favor', 'please'];

const NEGACIONES = [
  /^no\s+(compres|compremos|comprar)\s+(mas\s+)?(.+)$/,
  /^(saca|sacar|saca(?:le)?)\s+(.+)$/,
  /^ya\s+no\s+(hace\s+falta|necesitamos|necesito)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+)$/,
];

// ------------------------------------------------------------ normalizacion

/** minusculas, sin tildes, sin repeticiones de letras, espacios colapsados. */
function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/([^\W\d_])\1{2,}/g, '$1')  // "yerbaaa" -> "yerba" (digitos NO)
    .replace(/[^\wáéíóúñ\s,./-]/gi, ' ') // saca emojis; la coma se conserva
                                          // porque separa items y argumentos
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stem pobre pero suficiente para es-AR: solo para comparar, no para mostrar. */
function stem(w) {
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

function tokens(s) {
  return norm(s).split(' ')
    .map(t => t.replace(/^[,.]+|[,.]+$/g, ''))
    .filter(t => t && !PALABRAS_RUIDO.includes(t));
}

function clave(s) {
  return tokens(s).map(stem).sort().join(' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function similitud(a, b) {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

// ---------------------------------------------------------------- cantidades

const NUMEROS_PALABRA = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

const UNIDAD_PALABRA = {
  kilo: 'kg', kilos: 'kg', kg: 'kg', k: 'kg',
  gramo: 'g', gramos: 'g', g: 'g', gr: 'g',
  litro: 'l', litros: 'l', l: 'l', lt: 'l', lts: 'l',
  ml: 'ml', cc: 'ml',
  paquete: 'paq', paquetes: 'paq', paq: 'paq', pack: 'paq', caja: 'paq', cajas: 'paq',
  docena: 'docena', docenas: 'docena',
};

/**
 * Saca la cantidad del texto y devuelve el resto limpio.
 * @returns {{cantidad:number, unidad:string, resto:string}}
 */
function parseCantidad(texto) {
  let t = norm(texto);
  let cantidad = null;
  let unidad = 'u';

  const quitar = (re, fn) => {
    const m = t.match(re);
    if (!m) return false;
    fn(m);
    t = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return true;
  };

  // "media docena" / "docena" -> 6 / 12
  quitar(/\b(media|medias)\s+docenas?\b/, () => { cantidad = 6; })
    || quitar(/\b(una\s+)?docenas?\b/, () => { cantidad = 12; })
    // "medio kilo" / "media caja"
    || quitar(/\b(medio|media)\s+(kilos?|litros?|paquetes?|cajas?)\b/, (m) => {
         cantidad = 0.5; unidad = UNIDAD_PALABRA[m[2]] || 'u';
       })
    // "un par de" (el "un" puede venir ya comido por limpiarPrefijos)
    || quitar(/\b(?:un\s+)?par\b/, () => { cantidad = 2; })
    // "2 kg" / "3 litros" / "2 paquetes"
    || quitar(/\b(\d+(?:[.,]\d+)?)\s*(kilos?|kg|k|gramos?|gr?|litros?|lts?|l|ml|cc|paquetes?|paq|pack|cajas?|docenas?)\b/,
         (m) => { cantidad = parseFloat(m[1].replace(',', '.')); unidad = UNIDAD_PALABRA[m[2]] || 'u'; })
    // "dos litros"
    || quitar(new RegExp(`\\b(${Object.keys(NUMEROS_PALABRA).join('|')})\\s+(kilos?|litros?|paquetes?|cajas?)\\b`),
         (m) => { cantidad = NUMEROS_PALABRA[m[1]]; unidad = UNIDAD_PALABRA[m[2]] || 'u'; })
    // "x2" / "X 2" / "*2"
    || quitar(/\b[x*]\s*(\d+)\b/, (m) => { cantidad = parseInt(m[1], 10); })
    || quitar(/\((\d+)\)/, (m) => { cantidad = parseInt(m[1], 10); })
    // "2 leches" (numero suelto al principio)
    || quitar(/^(\d+)\s+/, (m) => { cantidad = parseInt(m[1], 10); })
    // "dos leches"
    || quitar(new RegExp(`^(${Object.keys(NUMEROS_PALABRA).join('|')})\\s+`),
         (m) => { cantidad = NUMEROS_PALABRA[m[1]]; });

  if (cantidad == null) cantidad = 1;
  if (!(cantidad > 0)) cantidad = 1;
  cantidad = Math.min(cantidad, 99);

  return { cantidad, unidad, resto: t };
}

// ------------------------------------------------------------------ catalogo

/**
 * @param {string} texto
 * @param {Array<{item_canonico:string, categoria:string, alias:string}>} catalogo
 * @returns {{item:string, categoria:string, score:number, sobrante:string}|null}
 */
function buscarEnCatalogo(texto, catalogo) {
  const t = norm(texto);
  if (!t) return null;
  const tk = tokens(t);
  const k = clave(t);
  if (!tk.length) return null;

  let mejor = null;
  const considerar = (cand, score, usados) => {
    if (score <= 0) return;
    if (!mejor || score > mejor.score) {
      const sobrante = tk.filter(x => !usados.has(stem(x))).join(' ');
      mejor = { item: cand.item_canonico, categoria: cand.categoria, score, sobrante };
    }
  };

  for (const c of catalogo) {
    if (!c || !c.item_canonico) continue;
    const variantes = [c.item_canonico, ...String(c.alias || '').split(',')]
      .map(v => norm(v)).filter(Boolean);
    // Todo lo que esta entrada sabe llamarse, para juzgar el sobrante.
    const propios = new Set(variantes.flatMap(v => tokens(v)).map(stem));

    for (const v of variantes) {
      const vk = clave(v);
      const vtk = tokens(v);
      if (!vtk.length) continue;
      const usados = new Set(vtk.map(stem));

      if (vk === k) { considerar(c, 1.0, usados); continue; }        // igual

      // Un alias corto ("te", "ala", "deo") solo vale si es el mensaje entero:
      // si no, "te amo" se convierte en un pedido de te.
      if (vtk.length === 1 && vtk[0].length <= 3) continue;

      // el alias esta contenido entero en el mensaje ("fideos x3 tirabuzon")
      const contenido = vtk.every(w => tk.some(x => stem(x) === stem(w)));
      if (contenido) {
        const sobra = tk.filter(x => !usados.has(stem(x)));

        // Un alias generico de UNA palabra ("papel", "leche", "queso") con algo
        // colgando es ambiguo: "papel de aluminio" no es papel higienico y
        // "leche de almendras" no es leche. Solo se acepta si lo que sobra
        // tambien es una forma de nombrar a este mismo item ("fideos tirabuzon").
        if (vtk.length === 1 && sobra.length &&
            !sobra.every(x => propios.has(stem(x)))) continue;

        // cuanto mas sobra, menos confiable: una frase larga con una palabra
        // suelta de producto es mejor que la lea el LLM.
        considerar(c, 0.95 - 0.06 * sobra.length, usados);
        continue;
      }
      // typo en un alias de una sola palabra
      if (vtk.length === 1 && tk.length === 1) {
        const s = similitud(stem(tk[0]), stem(vtk[0]));
        if (s >= 0.8) considerar(c, 0.6 + (s - 0.8) * 1.5, usados);
      }
    }
  }
  return mejor;
}

// -------------------------------------------------------------- segmentacion

function segmentar(texto) {
  return norm(texto)
    .split(/\s*(?:,|;|\/|\+|\n|\by\b|\be\b|\btambien\b)\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

function limpiarPrefijos(seg) {
  let s = norm(seg);
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const p of PREFIJOS_RUIDO) {
      if (s === p) return '';
      if (s.startsWith(p + ' ')) { s = s.slice(p.length + 1).trim(); cambio = true; break; }
    }
    const m = s.match(/^(el|la|los|las|un|una|unos|unas|de|del)\s+(.+)$/);
    if (m) { s = m[2]; cambio = true; }
  }
  return s;
}

// ------------------------------------------------------------------ comandos

const REGLAS_COMANDO = [
  [/^(lista|ver lista|la lista|que hay|que tenemos|mostrar|mostrame la lista|pasame la lista)$/, 'lista'],
  [/^(ayuda|help|comandos|start|\?)$/, 'ayuda'],
  [/^(deshacer|undo)$/, 'deshacer'],
  [/^confirmar reset$/, 'reset_confirmado'],
  [/^reset$/, 'reset'],
  [/^(borrar|sacar|quitar|eliminar|cancelar)\s+(.+)$/, 'borrar'],
  [/^(ya compre|ya compramos|compre|compramos|ya esta|listo|ya fuimos)(?:\s+(.+))?$/, 'comprado'],
];

/** @returns {{comando:string|null, argumento:string}} */
function routerComandos(texto) {
  const t = norm(texto).replace(/^\//, '');   // /lista -> lista
  for (const [re, nombre] of REGLAS_COMANDO) {
    const m = t.match(re);
    if (m) return { comando: nombre, argumento: (m[2] || '').trim() };
  }
  for (const re of NEGACIONES) {
    const m = t.match(re);
    if (m) return { comando: 'borrar', argumento: (m[m.length - 1] || '').trim() };
  }
  return { comando: null, argumento: '' };
}

// -------------------------------------------------------- normalizador local

/**
 * Intenta resolver el mensaje con el diccionario, sin IA.
 * @returns {{items:Array, sinResolver:Array<string>, resueltoTodo:boolean}}
 */
function normalizarLocal(texto, catalogo, opts = {}) {
  const umbral = opts.umbral == null ? 0.75 : opts.umbral;
  const items = [];
  const sinResolver = [];

  for (const seg of segmentar(texto)) {
    const limpio = limpiarPrefijos(seg);
    if (!limpio) continue;

    const { cantidad, unidad, resto } = parseCantidad(limpio);
    const base = limpiarPrefijos(resto);
    if (!base) { sinResolver.push(seg); continue; }

    const hit = buscarEnCatalogo(base, catalogo);
    if (hit && hit.score >= umbral) {
      items.push({
        item: hit.item,
        cantidad,
        unidad,
        categoria: CATEGORIAS.includes(hit.categoria) ? hit.categoria : 'otros',
        nota: hit.sobrante || null,
        texto_original: seg,
        confianza: Math.min(0.99, hit.score),
        fuente: 'diccionario',
      });
    } else {
      sinResolver.push(seg);
    }
  }

  return { items: fusionarDuplicados(items), sinResolver, resueltoTodo: sinResolver.length === 0 };
}

/** "cafe y cafe molido" -> un solo item con la suma. */
function fusionarDuplicados(items) {
  const out = [];
  for (const it of items) {
    const ya = out.find(o => o.item === it.item);
    if (ya) {
      ya.cantidad = Math.min(99, ya.cantidad + it.cantidad);
      if (it.nota && !ya.nota) ya.nota = it.nota;
      ya.texto_original += ' | ' + it.texto_original;
    } else {
      out.push({ ...it });
    }
  }
  return out;
}

// --------------------------------------------------------------- validacion

/** Blinda cualquier salida (del LLM o del diccionario) antes de tocar el Sheet. */
function validarItems(items, opts = {}) {
  const umbral = opts.umbralConfianza == null ? 0.4 : opts.umbralConfianza;
  if (!Array.isArray(items)) return [];
  return items
    .filter(i => i && typeof i.item === 'string' && norm(i.item).length >= 2)
    .filter(i => (i.confianza == null ? 1 : Number(i.confianza)) >= umbral)
    .slice(0, 15)
    .map(i => {
      let cant = Number(i.cantidad);
      if (!Number.isFinite(cant) || cant <= 0) cant = 1;
      return {
        item: String(i.item).trim().slice(0, 60),
        cantidad: Math.min(cant, 99),
        unidad: UNIDADES.includes(i.unidad) ? i.unidad : 'u',
        categoria: CATEGORIAS.includes(i.categoria) ? i.categoria : 'otros',
        nota: i.nota ? String(i.nota).slice(0, 80) : null,
        texto_original: String(i.texto_original || '').slice(0, 200),
        confianza: i.confianza == null ? 1 : Number(i.confianza),
        fuente: i.fuente || 'ia',
      };
    });
}

// ------------------------------------------------------ dedup contra la hoja

/**
 * Decide, para cada item, si es fila nueva o suma a una existente.
 * @returns {{appends:Array, updates:Array}}
 */
function planificarEscrituras(items, lista, ctx = {}) {
  const pendientes = (lista || []).filter(r => r && r.estado === 'pendiente');
  const appends = [];
  const updates = [];

  for (const it of items) {
    const existente =
      pendientes.find(r => norm(r.item) === norm(it.item)) ||
      pendientes.find(r => clave(r.item) === clave(it.item));

    if (existente) {
      const ya = updates.find(u => u.id === existente.id);
      const previa = ya ? ya.cantidad : Number(existente.cantidad) || 0;
      const nueva = Math.min(99, previa + it.cantidad);
      const variantes = [existente.variantes, it.texto_original]
        .filter(Boolean).join(' | ').slice(0, 500);
      const pedido = unirPersonas(existente.pedido_por, ctx.nombre);
      if (ya) { ya.cantidad = nueva; ya.variantes = variantes; ya.pedido_por = pedido; }
      else {
        updates.push({
          id: existente.id, item: existente.item, cantidad: nueva,
          cantidad_previa: Number(existente.cantidad) || 0,
          variantes, pedido_por: pedido,
          nota: existente.nota || it.nota || '',
        });
      }
    } else {
      appends.push({
        id: nuevoId(ctx.ahora, appends.length),
        ciclo: ctx.ciclo || '',
        item: it.item,
        variantes: it.texto_original,
        cantidad: it.cantidad,
        unidad: it.unidad,
        categoria: it.categoria,
        pedido_por: ctx.nombre || '',
        nota: it.nota || '',
        fecha_alta: ctx.ahora || new Date().toISOString(),
        estado: 'pendiente',
        fecha_compra: '',
        veces_arrastrado: 0,
        origen: 'mensaje',
        msg_origen: ctx.msgId || '',
      });
    }
  }
  return { appends, updates };
}

function unirPersonas(actual, nuevo) {
  const set = new Set(String(actual || '').split(',').map(s => s.trim()).filter(Boolean));
  if (nuevo) set.add(String(nuevo).trim());
  return [...set].join(', ');
}

function nuevoId(ahora, i) {
  const base = ahora ? Date.parse(ahora) : Date.now();
  return `${base}-${i}-${Math.random().toString(36).slice(2, 7)}`;
}

// ------------------------------------------------------------ borrar / match

/**
 * Busca a que fila se refiere "borrar X". Nunca adivina si hay empate.
 * @returns {{estado:'ok'|'ambiguo'|'no_encontrado', filas:Array}}
 */
function matchParaBorrar(query, lista) {
  const pendientes = (lista || []).filter(r => r && r.estado === 'pendiente');
  const q = norm(query);
  if (!q) return { estado: 'no_encontrado', filas: [] };

  const exactos = pendientes.filter(r => norm(r.item) === q || clave(r.item) === clave(q));
  if (exactos.length === 1) return { estado: 'ok', filas: exactos };
  if (exactos.length > 1) return { estado: 'ambiguo', filas: exactos };

  const parciales = pendientes.filter(r => {
    const ri = norm(r.item);
    return ri.includes(q) || q.includes(ri) ||
           norm(r.variantes || '').includes(q) ||
           similitud(clave(r.item), clave(q)) >= 0.82;
  });
  if (parciales.length === 1) return { estado: 'ok', filas: parciales };
  if (parciales.length > 1) return { estado: 'ambiguo', filas: parciales };
  return { estado: 'no_encontrado', filas: [] };
}

// -------------------------------------------------------------------- ciclos

function cicloAnterior(ciclo) {
  const [y, m] = String(ciclo).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function cicloSiguiente(ciclo) {
  const [y, m] = String(ciclo).split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function nombreMes(ciclo) {
  const m = Number(String(ciclo).split('-')[1]);
  return MESES[m - 1] || '';
}

// --------------------------------------------------------------- consolidar

/**
 * Cierre mensual: agrupa, compara contra el ciclo anterior y decide arrastres.
 */
function consolidar(lista, historial, config = {}) {
  const ciclo = config.ciclo_activo;
  const maxArrastres = Number(config.max_arrastres || 3);
  const prev = cicloAnterior(ciclo);

  const delCiclo = (lista || []).filter(r => r && r.ciclo === ciclo && r.estado === 'pendiente');
  const anterior = (historial || []).filter(r => r && r.ciclo === prev);

  const compradosAntes = new Set(anterior.filter(r => r.estado === 'comprado').map(r => clave(r.item)));
  const pendientesAntes = new Set(anterior.filter(r => r.estado !== 'comprado').map(r => clave(r.item)));

  const vivos = delCiclo.filter(r => Number(r.veces_arrastrado || 0) < maxArrastres);
  const descartados = delCiclo.filter(r => Number(r.veces_arrastrado || 0) >= maxArrastres);

  const repetidos = vivos.filter(r => compradosAntes.has(clave(r.item)));
  const arrastrados = vivos.filter(r => pendientesAntes.has(clave(r.item)));
  const nuevos = vivos.filter(r => !compradosAntes.has(clave(r.item)) && !pendientesAntes.has(clave(r.item)));

  const porCategoria = ORDEN_CATEGORIAS
    .map(cat => ({
      categoria: cat,
      emoji: EMOJI_CATEGORIA[cat],
      filas: vivos.filter(r => r.categoria === cat)
                  .sort((a, b) => String(a.item).localeCompare(String(b.item), 'es')),
    }))
    .filter(g => g.filas.length);

  return {
    ciclo, ciclo_anterior: prev, ciclo_nuevo: cicloSiguiente(ciclo),
    mes: nombreMes(ciclo),
    total: vivos.length,
    porCategoria, vivos, descartados, repetidos, arrastrados, nuevos,
  };
}

// ------------------------------------------------------------------- render

/** Telegram rechaza el mensaje entero si un & o un < rompen el HTML. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function lineaItem(r, opts = {}) {
  const c = Number(r.cantidad) || 1;
  const un = r.unidad && r.unidad !== 'u' ? r.unidad : '';
  const cant = c > 1 || un ? ` x${c}${un}` : '';
  const nota = r.nota && opts.conNota !== false ? `  (${esc(r.nota)})` : '';
  return `• ${esc(r.item)}${cant}${nota}`;
}

function renderLista(lista, config = {}) {
  const pendientes = (lista || []).filter(r => r && r.estado === 'pendiente');
  if (!pendientes.length) {
    return 'La lista está vacía 🤷\nEscribime lo que falte y lo anoto.';
  }
  let txt = `🛒 <b>Lista actual</b> — ${pendientes.length} ítems\n`;
  for (const cat of ORDEN_CATEGORIAS) {
    const filas = pendientes.filter(r => r.categoria === cat)
                            .sort((a, b) => String(a.item).localeCompare(String(b.item), 'es'));
    if (!filas.length) continue;
    txt += `\n${EMOJI_CATEGORIA[cat]} <b>${cat.toUpperCase()}</b>\n${filas.map(r => lineaItem(r)).join('\n')}\n`;
  }
  const mes = config.ciclo_activo ? nombreMes(config.ciclo_activo) : null;
  txt += mes ? `\nSe manda sola el 1 de ${mes}.` : '';
  return txt.trim();
}

function renderMensual(c) {
  if (!c.total) {
    return `🛒 <b>Compra de ${c.mes}</b>\n\nNo hay nada anotado este mes 🤷\n` +
           `Escribime los ítems y te armo la lista.`;
  }
  let txt = `🛒 <b>Compra de ${c.mes}</b>\n${c.total} ítems\n`;
  for (const g of c.porCategoria) {
    txt += `\n${g.emoji} <b>${g.categoria.toUpperCase()}</b>\n${g.filas.map(r => lineaItem(r)).join('\n')}\n`;
  }
  const nombres = rs => [...new Set(rs.map(r => esc(r.item)))].join(' · ');
  txt += `\n────────────────\n`;
  if (c.repetidos.length)
    txt += `\n🔁 <b>Se repite del mes pasado</b> (${c.repetidos.length})\n${nombres(c.repetidos)}\n`;
  if (c.arrastrados.length)
    txt += `\n⏳ <b>Quedó pendiente el mes pasado</b> (${c.arrastrados.length})\n${nombres(c.arrastrados)}\n`;
  if (c.nuevos.length)
    txt += `\n🆕 <b>Nuevo este mes</b> (${c.nuevos.length})\n${nombres(c.nuevos)}\n`;
  if (c.descartados.length)
    txt += `\n🗑️ <b>Saqué por 3 meses sin comprar</b> (${c.descartados.length})\n${nombres(c.descartados)}\n— avisame si los siguen necesitando\n`;
  return txt.trim();
}

function renderConfirmacion(appends, updates) {
  const partes = [];
  if (appends.length) {
    partes.push('✅ Anoté:\n' + appends.map(r => lineaItem(r)).join('\n'));
  }
  if (updates.length) {
    partes.push('🔁 Ya estaban, sumé:\n' + updates
      .map(u => `• ${esc(u.item)} → ahora ${u.cantidad}`).join('\n'));
  }
  return partes.join('\n\n');
}

const TEXTO_AYUDA = [
  '🤖 <b>Cómo usarme</b>',
  '',
  'Escribime lo que falta, como te salga:',
  '• "leche"',
  '• "se terminó el café"',
  '• "papel higiénico x2"',
  '• "detergente y esponjas"',
  '',
  '<b>Comandos</b>',
  '• <b>lista</b> — ver lo que hay anotado',
  '• <b>borrar &lt;ítem&gt;</b> — sacar algo',
  '• <b>ya compré</b> — cerrar la compra del mes',
  '• <b>ya compré leche, café</b> — marcar solo esos',
  '• <b>deshacer</b> — revertir mi último cambio',
  '• <b>reset</b> — vaciar la lista (pide confirmación)',
  '',
  'El 1 de cada mes a las 9 mando la lista completa acá.',
  'También entiendo audios 🎤',
].join('\n');

/** Telegram corta en 4096; partimos por bloques para no cortar al medio. */
function partirMensaje(txt, max = 3900) {
  if (txt.length <= max) return [txt];
  const partes = [];
  let buf = '';
  for (const bloque of txt.split('\n\n')) {
    if ((buf + '\n\n' + bloque).length > max) { if (buf) partes.push(buf); buf = bloque; }
    else buf = buf ? buf + '\n\n' + bloque : bloque;
  }
  if (buf) partes.push(buf);
  return partes;
}

/** Teclado inline: un ✅ por item (max 90 botones) + acciones al final. */
function tecladoLista(filas, opts = {}) {
  const botones = filas.slice(0, 90).map(r => ([{
    text: `✅ ${String(r.item).slice(0, 25)}`,
    callback_data: `ok:${r.id}`,
  }]));
  if (opts.conCerrar !== false) {
    botones.push([{ text: '🛒 Ya compré todo', callback_data: 'comprado:all' }]);
  }
  return { inline_keyboard: botones };
}

// ------------------------------------------------------------------ prompt

/**
 * Solo ve los fragmentos que el diccionario no supo resolver, asi que es
 * corto y barato. Los placeholders los reemplaza el Code node "Preparar".
 */
const PROMPT_IA = [
  'Sos el normalizador de una lista de compras compartida de una casa en Argentina.',
  'Convertis el mensaje en items de compra. Respondes SOLO un objeto JSON valido,',
  'sin texto alrededor y sin ```.',
  '',
  'Categorias permitidas (exactamente estos strings): ' + CATEGORIAS.join(', ') + '.',
  'Unidades permitidas: ' + UNIDADES.join(', ') + '.',
  '',
  'ITEMS YA CARGADOS (si el producto ya esta, devolve su id en id_existente y en',
  'cantidad SOLO lo que hay que sumar):',
  '__LISTA__',
  '',
  'ITEMS CONOCIDOS DE LA CASA (reusa el nombre canonico si aplica):',
  '__CATALOGO__',
  '',
  'Reglas:',
  '1. Un mensaje puede tener varios items: "detergente y esponjas" son DOS.',
  '2. Ignora el verbo: "se termino el cafe" / "falta cafe" -> item "Cafe".',
  '3. Nombre canonico en singular y con mayuscula inicial, salvo productos que',
  '   solo existen en plural (Fideos, Galletitas, Huevos).',
  '4. NO inventes items que no esten en el mensaje.',
  '5. Cantidad por defecto 1, maximo 99. "x2", "dos", "media docena"=6,',
  '   "docena"=12, "medio kilo"=0.5 kg.',
  '6. Variantes del MISMO producto (descremada, marca, tamano) no crean item',
  '   nuevo: van en "nota".',
  '7. Productos distintos aunque compartan palabra SI son items nuevos:',
  '   "leche" vs "leche de almendras", "papel higienico" vs "papel de cocina",',
  '   "jabon en polvo" vs "jabon de tocador".',
  '8. Saludos, chistes, emojis y preguntas no son items: devolve items vacio.',
  '9. confianza entre 0 y 1. Usa menos de 0.5 si dudas de que sea un producto.',
  '10. Ante la duda, NO anotes: ensuciar la lista molesta mas que no anotar.',
  '',
  'Formato exacto de salida:',
  '{"items":[{"item":"Papel higienico","cantidad":2,"unidad":"u",',
  '"categoria":"higiene","id_existente":null,"nota":null,',
  '"texto_original":"papel higienico x2","confianza":0.97}]}',
  '',
  'MENSAJE:',
  '__MENSAJE__',
].join('\n');

module.exports = {
  CATEGORIAS, UNIDADES, ORDEN_CATEGORIAS, EMOJI_CATEGORIA, MESES, TEXTO_AYUDA,
  PROMPT_IA,
  norm, stem, tokens, clave, levenshtein, similitud,
  parseCantidad, buscarEnCatalogo, segmentar, limpiarPrefijos,
  routerComandos, normalizarLocal, fusionarDuplicados, validarItems,
  planificarEscrituras, matchParaBorrar, unirPersonas,
  cicloAnterior, cicloSiguiente, nombreMes, consolidar,
  esc, lineaItem, renderLista, renderMensual, renderConfirmacion,
  partirMensaje, tecladoLista,
};
