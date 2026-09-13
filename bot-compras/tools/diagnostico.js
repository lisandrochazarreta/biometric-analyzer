#!/usr/bin/env node
/**
 * Diagnóstico del bot de Telegram. Corrélo en tu máquina:
 *
 *   node tools/diagnostico.js <TOKEN>
 *   node tools/diagnostico.js <TOKEN> --enviar     (manda un mensaje de prueba)
 *
 * No guarda nada, no manda nada a ningún lado salvo api.telegram.org.
 * Chequea las 5 cosas que rompen un bot de Telegram recién armado.
 */
const TOKEN = process.argv[2] || process.env.TELEGRAM_BOT_TOKEN || '';
const ENVIAR = process.argv.includes('--enviar');
const BASE = (process.argv.find(a => a.startsWith('--api-base=')) || '').split('=')[1]
             || 'https://api.telegram.org';

const C = { ok: '\x1b[32m', mal: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' };
const ok   = m => console.log(`${C.ok}  ✓${C.off} ${m}`);
const mal  = m => console.log(`${C.mal}  ✗${C.off} ${m}`);
const warn = m => console.log(`${C.warn}  !${C.off} ${m}`);
const dim  = m => console.log(`${C.dim}    ${m}${C.off}`);

let problemas = 0;
const fallar = m => { mal(m); problemas++; };

async function api(metodo, params = {}) {
  const url = new URL(`${BASE}/bot${TOKEN}/${metodo}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({ ok: false, description: `respuesta no-JSON (HTTP ${r.status})` }));
  return j;
}

(async () => {
  if (!TOKEN) {
    console.error('Uso: node tools/diagnostico.js <TOKEN>');
    process.exit(2);
  }
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(TOKEN)) {
    warn('El token no tiene la pinta habitual (12345678:AAH...). Puede que le falte algo o tenga un espacio.');
  }

  // 1 -------------------------------------------------------------- identidad
  console.log('\n1. El token');
  const me = await api('getMe');
  if (!me.ok) {
    fallar(`Telegram rechazó el token: ${me.description}`);
    dim('Revisá que esté completo y sin espacios. Se regenera con /revoke en BotFather.');
    process.exit(1);
  }
  ok(`Es @${me.result.username} ("${me.result.first_name}")`);

  // 2 ----------------------------------------------------- privacy mode (!!!)
  console.log('\n2. Privacy mode — el error nº 1');
  if (me.result.can_read_all_group_messages) {
    ok('Desactivado: el bot ve todos los mensajes del grupo.');
  } else {
    fallar('ACTIVADO. En un grupo el bot solo va a recibir mensajes que empiecen con "/".');
    dim('Arreglo: BotFather → /setprivacy → elegí el bot → Disable.');
    dim('OJO: después hay que SACAR el bot del grupo y volver a agregarlo.');
  }
  if (me.result.can_join_groups === false) {
    fallar('El bot no puede entrar a grupos. BotFather → /setjoingroups → Enable.');
  }

  // 3 ------------------------------------------------------------- el webhook
  console.log('\n3. El webhook de n8n');
  const wh = await api('getWebhookInfo');
  const w = wh.result || {};
  if (!w.url) {
    warn('No hay webhook configurado. Normal si todavía no activaste el workflow en n8n.');
    dim('n8n registra el webhook solo cuando activás "compras-ingesta".');
  } else {
    ok(`Apuntando a ${w.url}`);
    if (w.pending_update_count > 0) {
      fallar(`${w.pending_update_count} updates encolados sin entregar.`);
      dim('n8n no está respondiendo. ¿Está prendido? ¿El workflow está activo?');
    } else {
      ok('Sin updates encolados.');
    }
    if (w.last_error_message) {
      fallar(`Último error de entrega: ${w.last_error_message}`);
      dim(`Fue el ${new Date((w.last_error_date || 0) * 1000).toLocaleString('es-AR')}.`);
      if (/certificate|SSL|TLS/i.test(w.last_error_message))
        dim('Telegram exige HTTPS con certificado válido. Nada de self-signed.');
    } else if (w.url) {
      ok('Sin errores de entrega.');
    }
  }

  // 4 -------------------------------------------------------- ids para Config
  console.log('\n4. Los ids para la hoja Config');
  if (w.url) {
    warn('Hay un webhook activo, así que getUpdates no devuelve nada (Telegram no permite los dos).');
    dim('Para sacar los ids: desactivá "compras-ingesta" en n8n, escribí en el grupo,');
    dim('corré esto de nuevo, y volvé a activarlo.');
  } else {
    const up = await api('getUpdates', { limit: 100 });
    const updates = up.result || [];
    if (!updates.length) {
      warn('No hay mensajes recientes. Escriban algo en el grupo los dos y corré esto de nuevo.');
    } else {
      const chats = new Map(), users = new Map();
      for (const u of updates) {
        const m = u.message || u.edited_message || (u.callback_query || {}).message;
        if (!m) continue;
        chats.set(String(m.chat.id), m.chat.title || m.chat.first_name || m.chat.type);
        const f = (u.callback_query || m).from;
        if (f && !f.is_bot) users.set(String(f.id), f.first_name || f.username);
      }
      const grupos = [...chats].filter(([id]) => id.startsWith('-'));
      if (!grupos.length) {
        warn('Vi mensajes privados pero ningún grupo. ¿Agregaste el bot al grupo y escribieron ahí?');
      }
      console.log('\n   Pegá esto en la hoja Config (columnas clave | valor):\n');
      const filas = [];
      if (grupos.length) filas.push(['grupo_chat_id', grupos[0][0]]);
      [...users].slice(0, 2).forEach(([id, nom], i) => {
        filas.push([`persona_${i + 1}_user_id`, id]);
        filas.push([`persona_${i + 1}_nombre`, nom]);
      });
      filas.push(['telegram_bot_token', TOKEN.slice(0, 8) + '…(el token completo)']);
      for (const [k, v] of filas) console.log(`   ${k.padEnd(22)}\t${v}`);
      if (grupos.length > 1) {
        console.log('');
        warn(`Hay ${grupos.length} grupos. Usé "${grupos[0][1]}". Los otros: ` +
             grupos.slice(1).map(([id, t]) => `${t} (${id})`).join(', '));
      }
      if (users.size < 2) warn(`Solo vi ${users.size} persona(s). Que escriba la otra también.`);
    }
  }

  // 5 ------------------------------------------------------ mensaje de prueba
  if (ENVIAR) {
    console.log('\n5. Mensaje de prueba');
    const destino = (process.argv.find(a => a.startsWith('--chat=')) || '').split('=')[1];
    if (!destino) {
      warn('Pasá --chat=<grupo_chat_id> para mandar la prueba.');
    } else {
      const r = await api('sendMessage', {
        chat_id: destino,
        text: '🤖 Prueba de <b>compras-casa</b>. Si ves esto, el bot puede escribir en el grupo.',
        parse_mode: 'HTML',
      });
      if (r.ok) ok('Mensaje enviado. Miralo en el grupo.');
      else fallar(`No pudo enviar: ${r.description}`);
    }
  }

  console.log('');
  if (problemas) {
    console.log(`${C.mal}${problemas} problema(s) que arreglar.${C.off}\n`);
    process.exit(1);
  }
  console.log(`${C.ok}Todo en orden.${C.off} Escribí "leche" en el grupo y fijate en el Sheet.\n`);
})().catch(e => {
  console.error(`\n${C.mal}Error:${C.off} ${e.message}`);
  if (/fetch failed|ENOTFOUND|timeout/i.test(e.message))
    console.error('No pude llegar a api.telegram.org. ¿Internet? ¿Proxy? ¿VPN?');
  process.exit(1);
});
