/*
 * Datos de ejemplo extraídos del Excel "FINANZAS PERSONALES - Junio".
 * Se cargan automáticamente la primera vez que abrís la app.
 * Podés editarlos, borrarlos o reemplazarlos por los tuyos sin tocar este archivo.
 *
 * Montos en pesos (ARS). El tipo de cambio (usdRate) se usa solo para mostrar
 * el equivalente en dólares; no afecta los cálculos en pesos.
 */
window.SEED_DATA = {
  meta: {
    titulo: "Finanzas Personales",
    moneda: "ARS",
    usdRate: 1450,        // ARS por USD (editable en Configuración)
    saldoInicial: 0,      // ahorro acumulado antes del primer mes
    // Ajustes manuales del ahorro acumulado, por nombre de mes. Si un mes tiene
    // un valor acá, el acumulado se fija en ese número (y los meses siguientes
    // siguen sumando a partir de él). Replica el valor cargado a mano en el
    // Excel para Abril; vacialo en Configuración para volver a la suma automática.
    accumOverrides: { "Abril": 13057025 }
  },
  months: ["Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio"],
  income: [
    { name: "Stefanini (USD)",   values: [2290400, 10400400, 10440000, 10440000, 11115000, 11422500] },
    { name: "Arpov (Pesos)",     values: [3842000, 4200000, 4200000, 5883825, 6368825, 3600000] },
    { name: "Préstamos a favor", values: [300000, 300000, 300000, 1095000, 0, 300000] }
  ],
  fixed: [
    { name: "Alquiler (750 USD)", values: [1083375, 1083375, 1061000, 1068750, 1068750, 1132500] },
    { name: "Expensas",           values: [310000, 310000, 310000, 371806, 371806, 371806] },
    { name: "GYM/Membresía",      values: [55000, 60000, 70000, 60000, 60000, 60000] },
    { name: "Internet/Teléfono",  values: [0, 95000, 95000, 106000, 100000, 100000] },
    { name: "AAAJ",               values: [45000, 45000, 66000, 78000, 42000, 42000] }
  ],
  variable: [
    { name: "Supermercado Pedidos Ya", values: [803716, 73858, 0, 0, 0, 0] },
    { name: "Supermercado",            values: [32823, 416278, 881865, 872304, 717875, 806073] },
    { name: "Compras Online",          values: [323722, 533301, 310000, 0, 0, 0] },
    { name: "Ropa/Accesorios",         values: [155400, 81242, 0, 0, 444984.75, 71181] },
    { name: "Hogar/Accesorios",        values: [194095, 81162, 36800, 126752, 205800, 20159] },
    { name: "Transporte (Uber)",       values: [206320, 0, 129504, 69726, 81366, 0] },
    { name: "Entretenimiento",         values: [342669, 18330, 185000, 0, 0, 0] },
    { name: "Farmacias",               values: [42052, 31180, 0, 28570, 0, 0] },
    { name: "Comida/Café",             values: [78787, 72667, 0, 55774, 129700, 116390] },
    { name: "Energía",                 values: [12800, 105776, 43287, 149750, 101000, 0] },
    { name: "Auto",                    values: [0, 0, 0, 0, 1440000, 0] },
    { name: "Tecnología",              values: [5967, 5967, 0, 0, 0, 0] },
    { name: "Suscripciones",           values: [74200, 188400, 181000, 281200, 226575, 18837] },
    { name: "Electrodomésticos",       values: [0, 1700000, 0, 0, 0, 60000] },
    { name: "Viaje",                   values: [0, 0, 0, 1731000, 0, 61321] },
    { name: "Tarjeta",                 values: [0, 0, 0, 440000, 1238455.25, 11399] }
  ]
};
