# El mensaje mensual

Sale el **día 1 a las 09:00** (hora de Buenos Aires) a los dos números.

---

## Cómo queda

```
🛒 Compra de octubre
14 ítems · armada entre el 01/09 y el 01/10

🥫 ALMACÉN
• Café x2
• Yerba
• Fideos x3  (tirabuzón)
• Aceite

🥛 LÁCTEOS
• Leche x4
• Queso cremoso  (Flor)
• Manteca

🧼 LIMPIEZA
• Detergente x2
• Esponjas
• Lavandina

🧴 HIGIENE
• Papel higiénico x2
• Shampoo  (el de siempre)

🥬 FRESCOS
• Huevos x12

🍷 BEBIDAS
• Agua x6

────────────────
🔁 Se repite de septiembre (6)
Café · Leche · Detergente · Papel higiénico · Huevos · Agua

⏳ Quedó pendiente de septiembre (2)
Lavandina · Esponjas
(las volví a poner en la lista)

🆕 Nuevo este mes (3)
Yerba · Queso cremoso · Shampoo

🗑️ Saqué por 3 meses sin comprar (1)
Velas aromáticas — avisame si la seguís necesitando
────────────────

Cuando terminen la compra, escribí "ya compré".
```

Decisiones de formato, por si querés cambiarlas:

- **Emojis por categoría** para escanear rápido en el súper con una mano.
- **Cantidad solo si es > 1.** "Leche" se lee mejor que "Leche x1".
- **`(nota)`** entre paréntesis, en gris mental: la variante o la marca.
- **`(Nombre)`** solo cuando lo pidió una persona y puede haber duda de qué era.
- **Orden de categorías fijo**, no alfabético: sigue el recorrido típico de un
  súper (almacén → lácteos → limpieza → higiene → frescos → bebidas → otros).
  Cambialo al orden de *tu* súper y ahorrás vueltas.
- **Las tres comparaciones separadas y contadas.** "Se repite" te dice qué
  comprás siempre (candidato a comprar de a 2 y dejar de anotar). "Quedó
  pendiente" es el que importa: si algo se pide dos meses seguidos y no se
  compra, o no hacía falta o siempre está agotado.

---

## Code node "Consolidar y comparar"

```js
const CATS = ['almacén','lácteos','limpieza','higiene','frescos','bebidas','otros'];
const EMOJI = { 'almacén':'🥫', 'lácteos':'🥛', 'limpieza':'🧼',
                'higiene':'🧴', 'frescos':'🥬', 'bebidas':'🍷', 'otros':'📦' };
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];

const cfg = Object.fromEntries($('Leer config').all().map(i => [i.json.clave, i.json.valor]));
const cicloActivo = cfg.ciclo_activo;                       // '2026-10'
const maxArrastres = Number(cfg.max_arrastres ?? 3);

const lista     = $('Leer lista').all().map(i => i.json).filter(r => r.id);
const historial = $('Leer historial').all().map(i => i.json).filter(r => r.id);

// --- ciclos ---
const [y, m] = cicloActivo.split('-').map(Number);
const prev = m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`;
const next = m === 12 ? `${y+1}-01` : `${y}-${String(m+1).padStart(2,'0')}`;
const nombreMes = MESES[m-1];

const delCiclo = lista.filter(r => r.ciclo === cicloActivo && r.estado === 'pendiente');
const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

// --- comparación con el ciclo anterior ---
const anterior = historial.filter(r => r.ciclo === prev);
const compradosAntes = new Set(anterior.filter(r => r.estado === 'comprado').map(r => norm(r.item)));
const pendientesAntes = anterior.filter(r => r.estado !== 'comprado');
const pendientesAntesSet = new Set(pendientesAntes.map(r => norm(r.item)));

const repetidos = delCiclo.filter(r => compradosAntes.has(norm(r.item)));
const arrastrados = delCiclo.filter(r => pendientesAntesSet.has(norm(r.item)));
const nuevos = delCiclo.filter(r => !compradosAntes.has(norm(r.item))
                                 && !pendientesAntesSet.has(norm(r.item)));
const descartados = delCiclo.filter(r => Number(r.veces_arrastrado || 0) >= maxArrastres);

const vivos = delCiclo.filter(r => Number(r.veces_arrastrado || 0) < maxArrastres);

// --- render ---
const linea = r => {
  const cant = Number(r.cantidad) > 1
    ? ` x${Number(r.cantidad)}${r.unidad && r.unidad !== 'u' ? r.unidad : ''}` : '';
  const nota = r.nota ? `  (${r.nota})` : '';
  return `• ${r.item}${cant}${nota}`;
};

let txt = `🛒 *Compra de ${nombreMes}*\n${vivos.length} ítems\n`;

for (const cat of CATS) {
  const filas = vivos.filter(r => r.categoria === cat)
                     .sort((a,b) => a.item.localeCompare(b.item, 'es'));
  if (!filas.length) continue;
  txt += `\n${EMOJI[cat]} *${cat.toUpperCase()}*\n${filas.map(linea).join('\n')}\n`;
}

const nombres = rs => [...new Set(rs.map(r => r.item))].join(' · ');
txt += `\n────────────────\n`;
if (repetidos.length)
  txt += `\n🔁 *Se repite del mes pasado* (${repetidos.length})\n${nombres(repetidos)}\n`;
if (arrastrados.length)
  txt += `\n⏳ *Quedó pendiente el mes pasado* (${arrastrados.length})\n${nombres(arrastrados)}\n(las volví a poner en la lista)\n`;
if (nuevos.length)
  txt += `\n🆕 *Nuevo este mes* (${nuevos.length})\n${nombres(nuevos)}\n`;
if (descartados.length)
  txt += `\n🗑️ *Saqué por ${maxArrastres} meses sin comprar* (${descartados.length})\n${nombres(descartados)}\n— avisame si los seguís necesitando\n`;
txt += `\n────────────────\nCuando terminen la compra, escribí *"ya compré"*.`;

if (!vivos.length) {
  txt = `🛒 *Compra de ${nombreMes}*\n\nNo hay nada anotado este mes 🤷\n` +
        `Escribime los ítems y te armo la lista.`;
}

return [{ json: {
  texto: txt,
  ciclo_cerrado: cicloActivo,
  ciclo_nuevo: next,
  descartados_ids: descartados.map(r => r.id),
  a_arrastrar: [],   // lo llena el paso de archivado si el ciclo anterior quedó abierto
}}];
```

---

## Envío: el detalle que te va a morder

WhatsApp **no te deja mandar texto libre** si esa persona no te escribió en las
últimas 24 h, y **las variables de un template no aceptan saltos de línea**. O
sea: la lista formateada no entra en un template. Por eso el envío tiene dos
caminos (ver `01-arquitectura.md` §4):

```
IF  $now.diff(ultimo_inbound_<persona>, 'hours').hours < 23
    ├─ true  → WhatsApp: Send message (texto libre, GRATIS)
    └─ false → WhatsApp: Send template "lista_mensual_v1" ({{1}} = "octubre")
               + Config.envio_pendiente_<persona> = true
               + Config.ultimo_mensaje_mensual = <texto>
```

Cuando la persona responde cualquier cosa al template, el nodo 8 del workflow de
ingesta ve el flag, le manda la lista completa y lo baja.

**Template a dar de alta en Meta** (categoría **utility**, idioma *Spanish (ARG)*
o *Spanish*):

```
Nombre: lista_mensual_v1
Categoría: Utility
Body:
Tu lista de compras de {{1}} ya está armada 🛒
Respondeme cualquier cosa y te la paso completa.

Ejemplo para la aprobación — {{1}}: octubre
```

Pedila **utility**, no marketing: cuesta la mitad y no cae en el filtro de
promociones. Si Meta te la reclasifica a marketing, reescribila sacando todo lo
que suene a oferta y volvé a mandarla.

**Corte a 4096 caracteres**: WhatsApp rechaza mensajes más largos. Con 14 ítems
estás en ~900 caracteres, pero poné el guard igual:

```js
const MAX = 3900;
const txt = $json.texto;
if (txt.length <= MAX) return [{ json: { partes: [txt] } }];
const bloques = txt.split('\n\n');
const partes = []; let buf = '';
for (const b of bloques) {
  if ((buf + '\n\n' + b).length > MAX) { partes.push(buf); buf = b; }
  else buf = buf ? buf + '\n\n' + b : b;
}
if (buf) partes.push(buf);
return [{ json: { partes } }];
```

---

## Extra que vale la pena: el recordatorio del día 3

Un segundo cron, `0 20 3 * *`: si el ciclo del mes sigue abierto (nadie dijo
"ya compré"), mandá *"¿Fueron al súper? Si ya compraron, escribime 'ya compré'
así cierro la lista."* Sin esto, la mitad de los meses el ciclo se cierra solo
como `no_comprado` y la comparación mes a mes queda sucia.
