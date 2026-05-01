# PedidosYa Market — Discount Agent

Agente que escanea el catálogo de **PedidosYa Market** alcanzable desde una
dirección dada (Av. Córdoba 4340, Villa Crespo por defecto) y avisa por
**ntfy.sh** cuando aparece un producto con descuento mayor al umbral configurado
(80 % por defecto).

Diseñado para correrse cada hora vía cron.

## Cómo funciona

1. Levanta config desde `.env` (coords, umbral, topic de ntfy).
2. Consulta el feed de groceries de PedidosYa cerca de tus coords.
3. Filtra los vendors cuyo nombre contenga `PeYa Market` / `PedidosYa Market`.
4. Recorre el catálogo paginado de cada vendor.
5. Para cada producto cuyo `discount_pct > umbral`, manda push por ntfy.
6. Persiste los IDs notificados en `.state/seen.json` con TTL de 7 días para
   no duplicar notificaciones.

## Setup

```bash
git clone <repo>
cd biometric-analyzer

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Editá .env si querés cambiar el topic de ntfy o el umbral
```

Suscribite al topic en tu celular instalando la app **ntfy** (Android/iOS) y
agregando el topic configurado en `.env`
(`pedidosya-mkt-descuentos-lis-x7k3m9q4` por defecto, en `https://ntfy.sh`).

## Probar manualmente

```bash
# Sin enviar push, solo loggea lo que detectaría:
python -m agent.main --dry-run -v

# Corrida real:
python -m agent.main
```

## Programar cada hora (cron)

```bash
crontab -e
```

Pegá (ajustando la ruta absoluta):

```
0 * * * * cd /ruta/al/proyecto && /ruta/al/proyecto/.venv/bin/python -m agent.main >> /ruta/al/proyecto/.state/agent.log 2>&1
```

Verificá con `crontab -l` y mirá `/ruta/al/proyecto/.state/agent.log`.

## Si los endpoints cambian / no encuentra productos

PedidosYa no tiene API pública oficial. Si la primera corrida loguea
`no PeYa Market vendors found` o falla al traer productos:

1. Abrí <https://www.pedidosya.com.ar/groceries/peya-market> en Chrome
   con la dirección **Av. Córdoba 4340** seteada.
2. Abrí DevTools → pestaña **Network** → filtrá por `Fetch/XHR`.
3. Buscá una request a `services.pedidosya.com` que devuelva la lista de
   productos. Anotá:
   - El `vendor_id` en la URL.
   - Headers `Cookie` y `X-Device-Id` (si los hay).
4. Pegalos en `.env`:

   ```
   PEYA_VENDOR_ID=<el_id>
   PEYA_COOKIE=<cookie completo>
   PEYA_DEVICE_ID=<device id>
   ```

5. Si la URL del endpoint difiere de la que asumimos (`groceries-bff/v1`),
   editá `agent/pedidosya.py` (`iter_products`) con la ruta correcta.

## Estructura

```
.
├── agent/
│   ├── config.py        # Carga .env
│   ├── pedidosya.py     # Cliente HTTP + parseo de productos
│   ├── notifier.py      # Cliente ntfy
│   ├── state.py         # Persistencia JSON con TTL
│   └── main.py          # Entry point
├── requirements.txt
├── .env.example
├── cron.example
└── README.md
```

## Limitaciones conocidas

- **No fue testeado en producción** desde el entorno donde se generó (sin
  acceso a internet a `pedidosya.com.ar`). La primera corrida en tu máquina es
  el verdadero smoke test.
- El parseo de productos es defensivo y prueba varios shapes de JSON
  (`price`, `productPriceInfo`, `priceInfo`...). Si PedidosYa cambia el
  contrato de respuesta, hay que ajustar `_normalize_product` en
  `agent/pedidosya.py`.
- Algunos endpoints pueden requerir cookies/headers de sesión. Si pasa,
  capturarlos del navegador y setearlos en `.env` (ver sección anterior).
