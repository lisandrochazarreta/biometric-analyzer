"""Cliente de los endpoints públicos de VTEX que usan las tiendas online.

Tres cosas nos importan:

1. **Catálogo** — `GET /api/catalog_system/pub/products/search`
   Busca productos por texto. Devuelve precios como float en pesos.
2. **Simulación** — `POST /api/checkout/pub/orderForms/simulation`
   Dada una lista de SKUs + cantidades, devuelve el total real con promos
   y qué items están sin stock. Ojo: acá los precios vienen en *centavos*.
3. **Link de carrito** — `GET /checkout/cart/add?sku=..&qty=..&seller=..`
   Abre la web de la tienda con los productos ya cargados en el carrito.
   Es el handoff al humano: nosotros armamos, la persona paga.

Ninguno de los tres requiere API key. Tampoco son un contrato estable: si una
cadena cambia su storefront, esto se rompe y hay que reajustarlo.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Iterable
from urllib.parse import urlencode

import httpx

from .stores import Store

log = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
MAX_SEARCH_RESULTS = 50  # VTEX no devuelve más de 50 por request


@dataclass(frozen=True)
class Product:
    store_key: str
    sku: str
    product_id: str
    name: str
    brand: str
    seller: str
    price: float
    list_price: float
    available: bool
    url: str
    image: str | None = None
    unit: str | None = None

    @property
    def discount_pct(self) -> float:
        if self.list_price > 0 and self.price < self.list_price:
            return round((1 - self.price / self.list_price) * 100)
        return 0.0


@dataclass(frozen=True)
class Simulation:
    total: float
    items_total: float
    discounts: float
    unavailable_skus: tuple[str, ...]


class VtexClient:
    """Un cliente HTTP compartido para todas las tiendas VTEX."""

    def __init__(self, timeout: float = 25.0) -> None:
        self._client = httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Accept-Language": "es-AR,es;q=0.9",
            },
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "VtexClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # ------------------------------------------------------------------ búsqueda

    def search(self, store: Store, term: str, limit: int = 6) -> list[Product]:
        limit = max(1, min(limit, MAX_SEARCH_RESULTS))
        params = {
            "ft": term,
            "_from": 0,
            "_to": limit - 1,
            "sc": store.sales_channel,
        }
        raw = self._get_json(store, "/api/catalog_system/pub/products/search", params)
        if not isinstance(raw, list):
            return []
        out = []
        for item in raw:
            p = _parse_product(item, store)
            if p:
                out.append(p)
        return out

    def get_by_sku(self, store: Store, sku: str) -> Product | None:
        params = {"fq": f"skuId:{sku}", "sc": store.sales_channel}
        raw = self._get_json(store, "/api/catalog_system/pub/products/search", params)
        if not isinstance(raw, list) or not raw:
            return None
        # El producto puede traer varios SKUs; nos quedamos con el pedido.
        return _parse_product(raw[0], store, prefer_sku=sku)

    def _get_json(self, store: Store, path: str, params: dict[str, Any]) -> Any:
        url = f"{store.base_url}{path}"
        try:
            r = self._client.get(url, params=params, headers={"Referer": store.base_url + "/"})
            r.raise_for_status()
            return r.json()
        except httpx.HTTPStatusError as e:
            log.warning("%s: %s devolvió %s", store.key, path, e.response.status_code)
        except httpx.HTTPError as e:
            log.warning("%s: falló %s (%s)", store.key, path, e)
        except ValueError:
            log.warning("%s: %s no devolvió JSON", store.key, path)
        return None

    # ---------------------------------------------------------------- simulación

    def simulate(
        self,
        store: Store,
        items: Iterable[tuple[str, int, str]],
        postal_code: str,
    ) -> Simulation | None:
        """items: iterable de (sku, cantidad, seller). Precios devueltos en pesos."""
        payload_items = [
            {"id": str(sku), "quantity": int(qty), "seller": str(seller or "1")}
            for sku, qty, seller in items
        ]
        if not payload_items:
            return None
        url = f"{store.base_url}/api/checkout/pub/orderForms/simulation"
        try:
            r = self._client.post(
                url,
                params={"sc": store.sales_channel},
                json={
                    "items": payload_items,
                    "country": store.country,
                    "postalCode": postal_code,
                },
                headers={
                    "Content-Type": "application/json",
                    "Referer": store.base_url + "/",
                },
            )
            r.raise_for_status()
            data = r.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("%s: falló la simulación (%s)", store.key, e)
            return None
        return _parse_simulation(data)

    # --------------------------------------------------------------------- link

    @staticmethod
    def cart_url(store: Store, items: Iterable[tuple[str, int, str]]) -> str:
        """Link que abre la tienda con los productos cargados en el carrito."""
        pairs: list[tuple[str, str]] = []
        for sku, qty, seller in items:
            pairs.append(("sku", str(sku)))
            pairs.append(("qty", str(int(qty))))
            pairs.append(("seller", str(seller or "1")))
        pairs.append(("sc", store.sales_channel))
        return f"{store.base_url}/checkout/cart/add?{urlencode(pairs)}"


# ------------------------------------------------------------------- parsing


def _parse_product(raw: Any, store: Store, prefer_sku: str | None = None) -> Product | None:
    if not isinstance(raw, dict):
        return None
    items = raw.get("items") or []
    if not isinstance(items, list) or not items:
        return None

    candidates = items
    if prefer_sku:
        exact = [i for i in items if str(i.get("itemId")) == str(prefer_sku)]
        candidates = exact or items

    chosen: tuple[dict, dict, dict] | None = None  # (item, seller, offer)
    for item in candidates:
        for seller in item.get("sellers") or []:
            offer = seller.get("commertialOffer") or {}
            if not isinstance(offer, dict):
                continue
            price = _num(offer.get("Price"))
            if price is None:
                continue
            available = _num(offer.get("AvailableQuantity")) or 0
            if chosen is None or (available > 0 and not chosen[2].get("_available")):
                offer = dict(offer, _available=available > 0)
                chosen = (item, seller, offer)
            if available > 0:
                break
        if chosen and chosen[2].get("_available"):
            break

    if chosen is None:
        return None

    item, seller, offer = chosen
    price = _num(offer.get("Price")) or 0.0
    list_price = _num(offer.get("ListPrice")) or price
    images = item.get("images") or []
    image = images[0].get("imageUrl") if images and isinstance(images[0], dict) else None
    link = raw.get("link")
    if not link:
        link_text = raw.get("linkText") or ""
        link = f"{store.base_url}/{link_text}/p" if link_text else store.base_url

    return Product(
        store_key=store.key,
        sku=str(item.get("itemId") or ""),
        product_id=str(raw.get("productId") or ""),
        name=str(item.get("nameComplete") or raw.get("productName") or item.get("name") or ""),
        brand=str(raw.get("brand") or ""),
        seller=str(seller.get("sellerId") or "1"),
        price=price,
        list_price=list_price,
        available=bool(offer.get("_available")),
        url=link,
        image=image,
        unit=item.get("measurementUnit"),
    )


def _parse_simulation(data: Any) -> Simulation | None:
    if not isinstance(data, dict):
        return None
    totals = {t.get("id"): _num(t.get("value")) or 0.0 for t in data.get("totals") or [] if isinstance(t, dict)}
    items_total = totals.get("Items", 0.0) / 100
    discounts = totals.get("Discounts", 0.0) / 100
    total = _num(data.get("value"))
    total = total / 100 if total is not None else items_total + discounts

    unavailable = []
    for it in data.get("items") or []:
        if not isinstance(it, dict):
            continue
        if it.get("availability") not in (None, "available"):
            unavailable.append(str(it.get("id") or ""))
    return Simulation(
        total=round(total, 2),
        items_total=round(items_total, 2),
        discounts=round(discounts, 2),
        unavailable_skus=tuple(s for s in unavailable if s),
    )


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
