/* ===========================================================================
 * Finanzas Personales — lógica de la app (vanilla JS, sin build, sin internet)
 * Datos persistidos en localStorage. Gráficos con Chart.js (vendorizado).
 * ========================================================================= */

(function () {
  "use strict";

  const STORAGE_KEY = "finanzas-personales-v1";

  /* ---------- Estado ---------- */
  let state = load();
  let currentMonth = state.months.length - 1; // último mes por defecto
  const charts = {}; // instancias de Chart por id

  /* ---------- Utilidades ---------- */
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { console.warn("No se pudo leer localStorage:", e); }
    return normalize(deepClone(window.SEED_DATA));
  }

  // Garantiza que todas las filas tengan tantos valores como meses.
  function normalize(d) {
    d.meta = d.meta || {};
    d.meta.titulo = d.meta.titulo || "Finanzas Personales";
    d.meta.usdRate = Number(d.meta.usdRate) || 1450;
    d.meta.saldoInicial = Number(d.meta.saldoInicial) || 0;
    d.months = Array.isArray(d.months) ? d.months : [];
    ["income", "fixed", "variable"].forEach(k => {
      d[k] = Array.isArray(d[k]) ? d[k] : [];
      d[k].forEach(row => {
        row.name = row.name || "";
        row.values = Array.isArray(row.values) ? row.values : [];
        while (row.values.length < d.months.length) row.values.push(0);
        row.values.length = d.months.length;
        row.values = row.values.map(v => num(v));
      });
    });
    return d;
  }

  function num(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : 0;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast("⚠️ No se pudo guardar: " + e.message); }
  }

  const fmtARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
  const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmtNum = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
  const fmtPct = (x) => (isFinite(x) ? x.toFixed(1) : "0.0") + "%";
  const money = (v) => fmtARS.format(Math.round(v));
  const usd = (v) => fmtUSD.format(Math.round(v / state.meta.usdRate));

  /* ---------- Cálculos ---------- */
  function colTotal(rows, m) { return rows.reduce((s, r) => s + num(r.values[m]), 0); }

  function series() {
    const M = state.months.length;
    const income = [], fixed = [], variable = [], egresos = [], ahorro = [], accum = [], rate = [];
    let run = state.meta.saldoInicial;
    for (let m = 0; m < M; m++) {
      const inc = colTotal(state.income, m);
      const fx = colTotal(state.fixed, m);
      const vr = colTotal(state.variable, m);
      const eg = fx + vr;
      const ah = inc - eg;
      run += ah;
      income.push(inc); fixed.push(fx); variable.push(vr);
      egresos.push(eg); ahorro.push(ah); accum.push(run);
      rate.push(inc > 0 ? (ah / inc) * 100 : 0);
    }
    return { income, fixed, variable, egresos, ahorro, accum, rate };
  }

  /* ===========================================================================
   * RENDER
   * ========================================================================= */
  function renderAll() {
    if (currentMonth >= state.months.length) currentMonth = state.months.length - 1;
    if (currentMonth < 0) currentMonth = 0;
    renderMonthSelect();
    renderKpis();
    renderCharts();
    renderTables();
    renderConfig();
    document.title = state.meta.titulo;
    document.querySelector("header.app h1").innerHTML =
      "💰 " + escapeHtml(state.meta.titulo).replace(/(\s)(\S+)$/, "$1<span>$2</span>");
  }

  function renderMonthSelect() {
    const sel = document.getElementById("month-select");
    sel.innerHTML = "";
    if (!state.months.length) { sel.innerHTML = "<option>— sin meses —</option>"; return; }
    state.months.forEach((mName, i) => {
      const o = document.createElement("option");
      o.value = i; o.textContent = mName;
      if (i === currentMonth) o.selected = true;
      sel.appendChild(o);
    });
  }

  function renderKpis() {
    const box = document.getElementById("kpis");
    if (!state.months.length) { box.innerHTML = "<p class='hint'>Agregá un mes en la pestaña «Cargar datos».</p>"; return; }
    const s = series();
    const m = currentMonth;
    const ahorro = s.ahorro[m];
    const cards = [
      { label: "Ingresos", value: money(s.income[m]), sub: usd(s.income[m]), cls: "accent" },
      { label: "Egresos", value: money(s.egresos[m]), sub: usd(s.egresos[m]), cls: "" },
      { label: "Ahorro neto", value: money(ahorro), sub: usd(ahorro), cls: ahorro >= 0 ? "good" : "bad" },
      { label: "Tasa de ahorro", value: fmtPct(s.rate[m]), sub: "de los ingresos del mes", cls: s.rate[m] >= 0 ? "good" : "bad" },
      { label: "Gastos fijos", value: money(s.fixed[m]), sub: pctOf(s.fixed[m], s.egresos[m]) + " de egresos", cls: "" },
      { label: "Gastos variables", value: money(s.variable[m]), sub: pctOf(s.variable[m], s.egresos[m]) + " de egresos", cls: "" },
      { label: "Ahorro acumulado", value: money(s.accum[m]), sub: usd(s.accum[m]), cls: "good" }
    ];
    box.innerHTML = cards.map(c =>
      `<div class="kpi ${c.cls}"><div class="label">${c.label}</div>
        <div class="value">${c.value}</div><div class="sub">${c.sub}</div></div>`
    ).join("");
  }

  function pctOf(part, whole) { return whole > 0 ? (part / whole * 100).toFixed(0) + "%" : "0%"; }

  /* ---------- Gráficos ---------- */
  const PALETTE = [
    "#5b8cff", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#22d3ee",
    "#fb923c", "#4ade80", "#e879f9", "#60a5fa", "#facc15", "#f472b6",
    "#2dd4bf", "#c084fc", "#fca5a5", "#93c5fd", "#fdba74"
  ];
  const GRID = "rgba(255,255,255,0.06)";
  const TICK = "#9aa7c2";

  function baseOpts(extra) {
    return Object.assign({
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: TICK, boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed;
              return ` ${ctx.dataset.label ? ctx.dataset.label + ": " : ""}${money(v)}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: TICK }, grid: { color: GRID } },
        y: { ticks: { color: TICK, callback: (v) => fmtNum.format(v) }, grid: { color: GRID } }
      }
    }, extra || {});
  }

  function mk(id, config) {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    charts[id] = new Chart(el.getContext("2d"), config);
  }

  function renderCharts() {
    if (!state.months.length) { Object.values(charts).forEach(c => c.destroy()); return; }
    const s = series();
    const labels = state.months;

    // Flujo: ingresos / egresos / ahorro
    mk("chart-flow", {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Ingresos", data: s.income, backgroundColor: "#5b8cff" },
          { label: "Egresos", data: s.egresos, backgroundColor: "#f87171" },
          { label: "Ahorro neto", type: "line", data: s.ahorro, borderColor: "#34d399",
            backgroundColor: "#34d399", tension: 0.3, borderWidth: 2, pointRadius: 3 }
        ]
      },
      options: baseOpts()
    });

    // Ahorro acumulado
    mk("chart-accum", {
      type: "line",
      data: { labels, datasets: [{ label: "Acumulado", data: s.accum, borderColor: "#34d399",
        backgroundColor: "rgba(52,211,153,0.15)", fill: true, tension: 0.3, borderWidth: 2, pointRadius: 3 }] },
      options: baseOpts({ plugins: { legend: { display: false } } })
    });

    // Fijos vs variables (apilado)
    mk("chart-fv", {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Fijos", data: s.fixed, backgroundColor: "#a78bfa" },
          { label: "Variables", data: s.variable, backgroundColor: "#fbbf24" }
        ]
      },
      options: baseOpts({ scales: {
        x: { stacked: true, ticks: { color: TICK }, grid: { color: GRID } },
        y: { stacked: true, ticks: { color: TICK, callback: (v) => fmtNum.format(v) }, grid: { color: GRID } }
      } })
    });

    // Distribución del mes: fijos + variables agrupados (doughnut)
    const m = currentMonth;
    const breakdown = [
      ...state.fixed.map(r => ({ name: r.name, v: num(r.values[m]) })),
      ...state.variable.map(r => ({ name: r.name, v: num(r.values[m]) }))
    ].filter(x => x.v > 0).sort((a, b) => b.v - a.v);

    mk("chart-breakdown", {
      type: "doughnut",
      data: {
        labels: breakdown.map(x => x.name),
        datasets: [{ data: breakdown.map(x => x.v), backgroundColor: breakdown.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: "#161d2e", borderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "right", labels: { color: TICK, boxWidth: 12, font: { size: 10.5 } } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${money(ctx.parsed)}` } }
        }
      }
    });

    // Top categorías del mes
    const top = breakdown.slice(0, 8);
    mk("chart-top", {
      type: "bar",
      data: {
        labels: top.map(x => x.name),
        datasets: [{ label: "Gasto", data: top.map(x => x.v), backgroundColor: top.map((_, i) => PALETTE[i % PALETTE.length]) }]
      },
      options: baseOpts({ indexAxis: "y", plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: TICK, callback: (v) => fmtNum.format(v) }, grid: { color: GRID } },
          y: { ticks: { color: TICK, font: { size: 11 } }, grid: { color: GRID } }
        } })
    });

    // Tasa de ahorro %
    mk("chart-rate", {
      type: "line",
      data: { labels, datasets: [{ label: "Tasa de ahorro", data: s.rate, borderColor: "#22d3ee",
        backgroundColor: "rgba(34,211,238,0.15)", fill: true, tension: 0.3, borderWidth: 2, pointRadius: 3 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${fmtPct(ctx.parsed.y)}` } } },
        scales: {
          x: { ticks: { color: TICK }, grid: { color: GRID } },
          y: { ticks: { color: TICK, callback: (v) => v + "%" }, grid: { color: GRID } }
        }
      }
    });
  }

  /* ---------- Tablas editables ---------- */
  function renderTables() {
    buildTable("tbl-income", "💵 Ingresos", "income", "#5b8cff");
    buildTable("tbl-fixed", "🏠 Gastos fijos", "fixed", "#a78bfa");
    buildTable("tbl-variable", "🛒 Gastos variables", "variable", "#fbbf24");
  }

  function buildTable(containerId, title, key, color) {
    const rows = state[key];
    const M = state.months.length;
    let html = `<div class="table-head">
      <h3 style="color:${color}">${title}</h3>
      <button class="primary add-row" data-key="${key}">＋ Categoría</button>
    </div><div class="table-scroll"><table class="data"><thead><tr>
      <th class="cat">Concepto</th>`;
    state.months.forEach((mn, i) => { html += `<th>${escapeHtml(mn)}</th>`; });
    html += `<th class="col-actions"></th></tr></thead><tbody>`;

    rows.forEach((r, ri) => {
      html += `<tr><td class="cat"><input type="text" value="${escapeAttr(r.name)}" data-key="${key}" data-row="${ri}" data-field="name"/></td>`;
      for (let m = 0; m < M; m++) {
        html += `<td><input type="text" inputmode="decimal" value="${r.values[m] ? fmtNum.format(r.values[m]) : ""}" data-key="${key}" data-row="${ri}" data-col="${m}"/></td>`;
      }
      html += `<td class="col-actions"><button class="icon ghost del-row" data-key="${key}" data-row="${ri}" title="Eliminar fila">✕</button></td></tr>`;
    });

    // fila total
    html += `<tr class="total-row"><td class="cat">TOTAL</td>`;
    for (let m = 0; m < M; m++) html += `<td>${fmtNum.format(colTotal(rows, m))}</td>`;
    html += `<td class="col-actions"></td></tr>`;
    html += `</tbody></table></div>`;
    document.getElementById(containerId).innerHTML = html;
  }

  function renderConfig() {
    document.getElementById("cfg-title").value = state.meta.titulo;
    document.getElementById("cfg-usd").value = state.meta.usdRate;
    document.getElementById("cfg-saldo").value = state.meta.saldoInicial;
  }

  /* ===========================================================================
   * EVENTOS
   * ========================================================================= */
  // Tabs
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById("panel-" + t.dataset.tab).classList.add("active");
  }));

  // Selección de mes
  document.getElementById("month-select").addEventListener("change", (e) => {
    currentMonth = parseInt(e.target.value, 10) || 0;
    renderKpis(); renderCharts();
  });

  // Edición de celdas (delegado) — se dispara al perder foco o Enter
  document.body.addEventListener("input", (e) => {
    const t = e.target;
    if (t.tagName !== "INPUT" || !t.dataset.key) return;
    const { key, row, field, col } = t.dataset;
    const r = state[key] && state[key][row];
    if (!r) return;
    if (field === "name") { r.name = t.value; }
    else if (col !== undefined) { r.values[col] = num(t.value); }
    save();
    // refrescar totales/dashboard sin re-render completo (para no perder foco)
    scheduleSoftRefresh();
  });

  // Reformatear el número y refrescar al salir de la celda
  document.body.addEventListener("change", (e) => {
    const t = e.target;
    if (t.tagName === "INPUT" && t.dataset.key && t.dataset.col !== undefined) {
      const v = num(t.value);
      t.value = v ? fmtNum.format(v) : "";
    }
  });

  let softTimer = null;
  function scheduleSoftRefresh() {
    clearTimeout(softTimer);
    softTimer = setTimeout(() => {
      // actualizar filas TOTAL sin reconstruir inputs (mantiene foco)
      ["tbl-income::income", "tbl-fixed::fixed", "tbl-variable::variable"].forEach(pair => {
        const [cid, key] = pair.split("::");
        const tbl = document.querySelector("#" + cid + " table.data");
        if (!tbl) return;
        const totalCells = tbl.querySelectorAll("tr.total-row td");
        for (let m = 0; m < state.months.length; m++) {
          if (totalCells[m + 1]) totalCells[m + 1].textContent = fmtNum.format(colTotal(state[key], m));
        }
      });
      renderKpis(); renderCharts();
    }, 350);
  }

  // Agregar / eliminar filas (delegado)
  document.body.addEventListener("click", (e) => {
    const add = e.target.closest(".add-row");
    const del = e.target.closest(".del-row");
    if (add) {
      const key = add.dataset.key;
      state[key].push({ name: "Nueva categoría", values: new Array(state.months.length).fill(0) });
      save(); renderTables(); renderKpis(); renderCharts();
    }
    if (del) {
      const key = del.dataset.key, ri = parseInt(del.dataset.row, 10);
      state[key].splice(ri, 1);
      save(); renderTables(); renderKpis(); renderCharts();
    }
  });

  // Agregar mes
  document.getElementById("btn-add-month").addEventListener("click", () => {
    const name = prompt("Nombre del nuevo mes:", suggestNextMonth());
    if (name === null) return;
    state.months.push(name.trim() || ("Mes " + (state.months.length + 1)));
    ["income", "fixed", "variable"].forEach(k => state[k].forEach(r => r.values.push(0)));
    currentMonth = state.months.length - 1;
    save(); renderAll();
    document.querySelector('.tab[data-tab="datos"]').click();
    toast("Mes agregado: " + state.months[state.months.length - 1]);
  });

  // Eliminar último mes
  document.getElementById("btn-del-month").addEventListener("click", () => {
    if (!state.months.length) return;
    if (!confirm("¿Eliminar el último mes (" + state.months[state.months.length - 1] + ") y todos sus datos?")) return;
    state.months.pop();
    ["income", "fixed", "variable"].forEach(k => state[k].forEach(r => r.values.pop()));
    if (currentMonth >= state.months.length) currentMonth = state.months.length - 1;
    save(); renderAll();
  });

  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  function suggestNextMonth() {
    const last = state.months[state.months.length - 1];
    const i = MESES.indexOf((last || "").trim());
    return i >= 0 ? MESES[(i + 1) % 12] : "Nuevo mes";
  }

  // Config
  document.getElementById("cfg-title").addEventListener("input", (e) => { state.meta.titulo = e.target.value; save(); document.title = e.target.value; });
  document.getElementById("cfg-usd").addEventListener("input", (e) => { state.meta.usdRate = num(e.target.value) || 1; save(); renderKpis(); });
  document.getElementById("cfg-saldo").addEventListener("input", (e) => { state.meta.saldoInicial = num(e.target.value); save(); renderKpis(); renderCharts(); });

  // Exportar JSON
  document.getElementById("btn-export").addEventListener("click", () => {
    download(JSON.stringify(state, null, 2), "finanzas-" + stamp() + ".json", "application/json");
    toast("Respaldo exportado");
  });

  // Exportar CSV (resumen mensual)
  document.getElementById("btn-csv").addEventListener("click", () => {
    const s = series();
    let lines = ["Mes,Ingresos,Gastos Fijos,Gastos Variables,Egresos,Ahorro Neto,Ahorro Acumulado,Tasa Ahorro %"];
    state.months.forEach((mn, m) => {
      lines.push([mn, s.income[m], s.fixed[m], s.variable[m], s.egresos[m], s.ahorro[m], s.accum[m], s.rate[m].toFixed(1)].join(","));
    });
    download(lines.join("\n"), "resumen-finanzas-" + stamp() + ".csv", "text/csv");
    toast("CSV exportado");
  });

  // Importar JSON
  document.getElementById("btn-import").addEventListener("click", () => document.getElementById("file-input").click());
  document.getElementById("file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = normalize(JSON.parse(reader.result));
        state = data; currentMonth = state.months.length - 1;
        save(); renderAll(); toast("Datos importados ✔");
      } catch (err) { toast("⚠️ Archivo inválido: " + err.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // Restablecer ejemplo
  document.getElementById("btn-seed").addEventListener("click", () => {
    if (!confirm("Esto reemplaza tus datos por los del ejemplo. ¿Continuar?")) return;
    state = normalize(deepClone(window.SEED_DATA));
    currentMonth = state.months.length - 1;
    save(); renderAll(); toast("Datos de ejemplo cargados");
  });

  // Vaciar todo
  document.getElementById("btn-clear").addEventListener("click", () => {
    if (!confirm("Esto borra TODOS los datos y deja la app vacía. ¿Continuar?")) return;
    state = normalize({ meta: deepClone(state.meta), months: [], income: [], fixed: [], variable: [] });
    state.income = [{ name: "Sueldo", values: [] }];
    state.fixed = [{ name: "Alquiler", values: [] }];
    state.variable = [{ name: "Supermercado", values: [] }];
    currentMonth = 0;
    save(); renderAll(); toast("Listo. Agregá tu primer mes con «＋ Mes».");
    document.querySelector('.tab[data-tab="datos"]').click();
  });

  /* ---------- Helpers varios ---------- */
  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function stamp() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function escapeAttr(s) { return escapeHtml(s); }
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  /* ---------- Arranque ---------- */
  if (!window.Chart) {
    document.querySelector(".wrap").insertAdjacentHTML("afterbegin",
      "<p style='color:#f87171'>No se pudo cargar Chart.js (vendor/chart.umd.min.js). Las tablas funcionan igual.</p>");
  }
  renderAll();
})();
