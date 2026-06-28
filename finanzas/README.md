# 💰 Finanzas Personales — App web

App de una sola página (HTML + JS, sin servidor ni internet) generada a partir
del Excel *FINANZAS PERSONALES – Junio*. Reemplaza la planilla por un panel con
gráficos y tablas editables.

## Cómo usarla

1. Abrí **`index.html`** con doble clic (cualquier navegador moderno).
2. Ya viene cargada con los datos del Excel (Febrero → Julio) para que veas todo
   funcionando.
3. Para cargar lo tuyo, andá a la pestaña **✏️ Cargar datos** y editá las celdas.

> Los datos se guardan automáticamente en tu navegador (localStorage). No se
> suben a ningún lado. Si cambiás de navegador o computadora, usá **Exportar /
> Importar** para llevarte el respaldo.

## Qué incluye

**Pestaña Resumen** (mes seleccionable):
- Tarjetas con Ingresos, Egresos, Ahorro neto, Tasa de ahorro, Gastos fijos,
  Gastos variables y Ahorro acumulado (con equivalente en USD).
- Ingresos · Egresos · Ahorro por mes
- Ahorro acumulado en el tiempo
- Gastos fijos vs variables (apilado)
- Distribución de gastos del mes (dona)
- Top categorías de gasto del mes
- Tasa de ahorro sobre ingresos (%)

**Pestaña Cargar datos:**
- Tres tablas editables: Ingresos, Gastos fijos, Gastos variables.
- `＋ Categoría` agrega una fila, `✕` elimina, `＋ Mes` agrega una columna.
- Los totales y los gráficos se recalculan solos.

**Pestaña Configuración:**
- Título, tipo de cambio (ARS por USD) y saldo inicial / ahorro previo.

**Barra superior:**
- **Importar / Exportar** respaldo `.json`
- **CSV** del resumen mensual (para abrir en Excel/Sheets)
- **Ejemplo** vuelve a los datos del Excel · **Vaciar** deja la app en blanco

## Cómo se calcula

- `Egresos = Gastos fijos + Gastos variables`
- `Ahorro neto = Ingresos − Egresos`
- `Ahorro acumulado = saldo inicial + suma de ahorros netos`
- `Tasa de ahorro = Ahorro neto / Ingresos`
- El USD es solo para mostrar; todos los cálculos son en pesos.

## Archivos

```
finanzas/
├── index.html              # estructura de la app
├── styles.css              # estilos
├── app.js                  # lógica, cálculos y gráficos
├── seed.js                 # datos de ejemplo (extraídos del Excel)
└── vendor/chart.umd.min.js # Chart.js 4.4.3 (incluido, funciona offline)
```
