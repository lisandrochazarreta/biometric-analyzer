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
    // Roles para el análisis de sueldos: por defecto todo ingreso es sueldo,
    // salvo los que parezcan préstamos.
    d.income.forEach(r => {
      if (r.isSalary === undefined) r.isSalary = !/pr[eé]stamo/i.test(r.name);
    });
    if (!d.meta.primaryIncome || !d.income.some(r => r.name === d.meta.primaryIncome)) {
      const arpov = d.income.find(r => /arpov/i.test(r.name));
      const firstSalary = d.income.find(r => r.isSalary) || d.income[0];
      d.meta.primaryIncome = (arpov || firstSalary || { name: "" }).name;
    }
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

  // Análisis de sueldos: cuánto queda del sueldo principal y de todos los sueldos
  // tras pagar los egresos del mes.
  function salaryAnalysis(s) {
    const M = state.months.length;
    const primaryRow = state.income.find(r => r.name === state.meta.primaryIncome);
    const primaryName = primaryRow ? primaryRow.name : "(sin definir)";
    const salaryNames = state.income.filter(r => r.isSalary).map(r => r.name);
    const principal = [], sueldos = [], remPrincipal = [], remSueldos = [], pctPrincipal = [], pctSueldos = [];
    for (let m = 0; m < M; m++) {
      const p = primaryRow ? num(primaryRow.values[m]) : 0;
      const sd = state.income.reduce((a, r) => a + (r.isSalary ? num(r.values[m]) : 0), 0);
      const eg = s.egresos[m];
      principal.push(p); sueldos.push(sd);
      remPrincipal.push(p - eg); remSueldos.push(sd - eg);
      pctPrincipal.push(p > 0 ? (p - eg) / p * 100 : 0);
      pctSueldos.push(sd > 0 ? (sd - eg) / sd * 100 : 0);
    }
    return { primaryName, salaryNames, principal, sueldos, remPrincipal, remSueldos, pctPrincipal, pctSueldos };
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
    const sal = salaryAnalysis(s);
    const m = currentMonth;
    const ahorro = s.ahorro[m];
    const cards = [
      { label: "Ingresos", value: money(s.income[m]), sub: usd(s.income[m]), cls: "accent" },
      { label: "Egresos", value: money(s.egresos[m]), sub: usd(s.egresos[m]), cls: "" },
      { label: "Ahorro neto", value: money(ahorro), sub: usd(ahorro), cls: ahorro >= 0 ? "good" : "bad" },
      { label: "Tasa de ahorro", value: fmtPct(s.rate[m]), sub: "de los ingresos del mes", cls: s.rate[m] >= 0 ? "good" : "bad" },
      { label: "Gastos fijos", value: money(s.fixed[m]), sub: pctOf(s.fixed[m], s.egresos[m]) + " de egresos", cls: "" },
      { label: "Gastos variables", value: money(s.variable[m]), sub: pctOf(s.variable[m], s.egresos[m]) + " de egresos", cls: "" },
      { label: "Ahorro acumulado", value: money(s.accum[m]), sub: usd(s.accum[m]), cls: "good" },
      { label: "Te queda del sueldo " + sal.primaryName, value: money(sal.remPrincipal[m]),
        sub: fmtPct(sal.pctPrincipal[m]) + " del sueldo · gastás " + pctOf(s.egresos[m], sal.principal[m]),
        cls: sal.remPrincipal[m] >= 0 ? "good" : "bad" },
      { label: "Te queda de los sueldos", value: money(sal.remSueldos[m]),
        sub: fmtPct(sal.pctSueldos[m]) + " de los sueldos del mes",
        cls: sal.remSueldos[m] >= 0 ? "good" : "bad" }
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

    renderSalaryCharts(s, labels);
    renderGeneral(s);
  }

  /* ---------- Gráficos de sueldos (mes a mes) ---------- */
  function renderSalaryCharts(s, labels) {
    const sal = salaryAnalysis(s);
    const lbl = document.getElementById("lbl-principal");
    if (lbl) lbl.textContent = sal.primaryName;

    // Sueldos vs egresos (barras agrupadas)
    mk("chart-sal-abs", {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Sueldo " + sal.primaryName, data: sal.principal, backgroundColor: "#5b8cff" },
          { label: "Todos los sueldos", data: sal.sueldos, backgroundColor: "#22d3ee" },
          { label: "Egresos", data: s.egresos, backgroundColor: "#f87171" }
        ]
      },
      options: baseOpts()
    });

    // Lo que queda cada mes ($) — barras coloreadas por signo
    const colBySign = (arr, pos, neg) => arr.map(v => (v >= 0 ? pos : neg));
    mk("chart-sal-rem", {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Te queda del sueldo " + sal.primaryName, data: sal.remPrincipal,
            backgroundColor: colBySign(sal.remPrincipal, "#34d399", "#f87171") },
          { label: "Te queda de los sueldos", data: sal.remSueldos,
            backgroundColor: colBySign(sal.remSueldos, "#a78bfa", "#fb923c") }
        ]
      },
      options: baseOpts()
    });

    // % disponible (líneas)
    mk("chart-sal-pct", {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "% disponible del sueldo " + sal.primaryName, data: sal.pctPrincipal,
            borderColor: "#5b8cff", backgroundColor: "#5b8cff", tension: 0.3, borderWidth: 2, pointRadius: 3, fill: false },
          { label: "% disponible de los sueldos", data: sal.pctSueldos,
            borderColor: "#34d399", backgroundColor: "#34d399", tension: 0.3, borderWidth: 2, pointRadius: 3, fill: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: TICK, boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y)}` } }
        },
        scales: {
          x: { ticks: { color: TICK }, grid: { color: GRID } },
          y: { ticks: { color: TICK, callback: (v) => v + "%" }, grid: { color: GRID } }
        }
      }
    });
  }

  /* ---------- Gráficos generales (todo el período) ---------- */
  function rowTotal(row) { return (row.values || []).reduce((a, b) => a + num(b), 0); }

  function renderGeneral(s) {
    const M = state.months.length;
    const sum = (arr) => arr.reduce((a, b) => a + b, 0);
    const totIng = sum(s.income), totFix = sum(s.fixed), totVar = sum(s.variable);
    const totEgr = totFix + totVar, totAho = totIng - totEgr;

    // Rango de meses y KPIs generales
    const range = M ? `(${state.months[0]} – ${state.months[M - 1]}, ${M} ${M === 1 ? "mes" : "meses"})` : "";
    const rangeEl = document.getElementById("gen-range");
    if (rangeEl) rangeEl.textContent = " " + range;

    const tasa = totIng > 0 ? (totAho / totIng) * 100 : 0;
    const genCards = [
      { label: "Ingresos totales", value: money(totIng), sub: usd(totIng), cls: "accent" },
      { label: "Egresos totales", value: money(totEgr), sub: usd(totEgr), cls: "" },
      { label: "Ahorro total", value: money(totAho), sub: usd(totAho), cls: totAho >= 0 ? "good" : "bad" },
      { label: "Tasa de ahorro media", value: fmtPct(tasa), sub: "sobre ingresos del período", cls: tasa >= 0 ? "good" : "bad" },
      { label: "Egreso promedio / mes", value: money(M ? totEgr / M : 0), sub: usd(M ? totEgr / M : 0), cls: "" },
      { label: "Ahorro promedio / mes", value: money(M ? totAho / M : 0), sub: usd(M ? totAho / M : 0), cls: totAho >= 0 ? "good" : "bad" }
    ];
    const genBox = document.getElementById("kpis-gen");
    if (genBox) genBox.innerHTML = genCards.map(c =>
      `<div class="kpi ${c.cls}"><div class="label">${c.label}</div>
        <div class="value">${c.value}</div><div class="sub">${c.sub}</div></div>`).join("");

    if (!M) { ["chart-gen-totals", "chart-gen-split", "chart-gen-expenses", "chart-gen-income", "chart-gen-top", "chart-gen-avg"].forEach(id => { if (charts[id]) charts[id].destroy(); }); return; }

    // Totales: ingresos / egresos / ahorro
    mk("chart-gen-totals", {
      type: "bar",
      data: {
        labels: ["Ingresos", "Egresos", "Ahorro"],
        datasets: [{ label: "Total período", data: [totIng, totEgr, totAho],
          backgroundColor: ["#5b8cff", "#f87171", "#34d399"] }]
      },
      options: baseOpts({ plugins: { legend: { display: false } } })
    });

    // Composición de egresos: fijos vs variables
    mk("chart-gen-split", {
      type: "doughnut",
      data: {
        labels: ["Gastos fijos", "Gastos variables"],
        datasets: [{ data: [totFix, totVar], backgroundColor: ["#a78bfa", "#fbbf24"], borderColor: "#161d2e", borderWidth: 2 }]
      },
      options: pieOpts()
    });

    // Gasto total por categoría (fijos + variables), todo el período
    const cats = [...state.fixed, ...state.variable]
      .map(r => ({ name: r.name, v: rowTotal(r) }))
      .filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    mk("chart-gen-expenses", {
      type: "doughnut",
      data: {
        labels: cats.map(x => x.name),
        datasets: [{ data: cats.map(x => x.v), backgroundColor: cats.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: "#161d2e", borderWidth: 2 }]
      },
      options: pieOpts("right", 10.5)
    });

    // Ingresos por fuente (período)
    const srcs = state.income.map(r => ({ name: r.name, v: rowTotal(r) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    mk("chart-gen-income", {
      type: "doughnut",
      data: {
        labels: srcs.map(x => x.name),
        datasets: [{ data: srcs.map(x => x.v), backgroundColor: srcs.map((_, i) => PALETTE[(i + 3) % PALETTE.length]), borderColor: "#161d2e", borderWidth: 2 }]
      },
      options: pieOpts()
    });

    // Top categorías del período (horizontal)
    const top = cats.slice(0, 10);
    mk("chart-gen-top", {
      type: "bar",
      data: {
        labels: top.map(x => x.name),
        datasets: [{ label: "Gasto del período", data: top.map(x => x.v), backgroundColor: top.map((_, i) => PALETTE[i % PALETTE.length]) }]
      },
      options: baseOpts({ indexAxis: "y", plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: TICK, callback: (v) => fmtNum.format(v) }, grid: { color: GRID } },
          y: { ticks: { color: TICK, font: { size: 11 } }, grid: { color: GRID } }
        } })
    });

    // Promedio mensual por categoría (fijos + variables)
    const avg = cats.map(x => ({ name: x.name, v: x.v / M })).sort((a, b) => b.v - a.v);
    mk("chart-gen-avg", {
      type: "bar",
      data: {
        labels: avg.map(x => x.name),
        datasets: [{ label: "Promedio mensual", data: avg.map(x => x.v), backgroundColor: avg.map((_, i) => PALETTE[i % PALETTE.length]) }]
      },
      options: baseOpts({ plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: TICK, font: { size: 10 }, maxRotation: 60, minRotation: 45 }, grid: { color: GRID } },
          y: { ticks: { color: TICK, callback: (v) => fmtNum.format(v) }, grid: { color: GRID } }
        } })
    });
  }

  function pieOpts(pos, fontSize) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: pos || "bottom", labels: { color: TICK, boxWidth: 12, font: { size: fontSize || 11 } } },
        tooltip: { callbacks: { label: (ctx) => {
          const data = ctx.dataset.data, tot = data.reduce((a, b) => a + b, 0);
          const p = tot ? (ctx.parsed / tot * 100).toFixed(1) : 0;
          return ` ${ctx.label}: ${money(ctx.parsed)} (${p}%)`;
        } } }
      }
    };
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
    renderSalaryConfig();
  }

  function renderSalaryConfig() {
    const sel = document.getElementById("cfg-principal");
    if (sel) {
      sel.innerHTML = state.income.map(r =>
        `<option value="${escapeAttr(r.name)}" ${r.name === state.meta.primaryIncome ? "selected" : ""}>${escapeHtml(r.name)}</option>`
      ).join("");
    }
    const list = document.getElementById("cfg-salary-list");
    if (list) {
      list.innerHTML = state.income.map((r, i) =>
        `<label class="salary-row"><input type="checkbox" data-salary="${i}" ${r.isSalary ? "checked" : ""}/> ${escapeHtml(r.name)}</label>`
      ).join("");
    }
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
    if (field === "name") {
      if (key === "income" && state.meta.primaryIncome === r.name) state.meta.primaryIncome = t.value;
      r.name = t.value;
    }
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
      const row = { name: key === "income" ? "Nuevo ingreso" : "Nueva categoría", values: new Array(state.months.length).fill(0) };
      if (key === "income") row.isSalary = true;
      state[key].push(row);
      save(); renderTables(); renderKpis(); renderCharts(); if (key === "income") renderSalaryConfig();
    }
    if (del) {
      const key = del.dataset.key, ri = parseInt(del.dataset.row, 10);
      state[key].splice(ri, 1);
      if (key === "income") normalize(state); // re-asegura primaryIncome válido
      save(); renderTables(); renderKpis(); renderCharts(); if (key === "income") renderSalaryConfig();
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
  document.getElementById("cfg-principal").addEventListener("change", (e) => { state.meta.primaryIncome = e.target.value; save(); renderKpis(); renderCharts(); });
  document.getElementById("cfg-salary-list").addEventListener("change", (e) => {
    const i = e.target.dataset.salary;
    if (i === undefined) return;
    state.income[i].isSalary = e.target.checked;
    save(); renderKpis(); renderCharts();
  });

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
