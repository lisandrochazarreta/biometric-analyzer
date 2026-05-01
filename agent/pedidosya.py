"""PedidosYa Market client.

PedidosYa no expone una API pública oficial. Este cliente usa los endpoints
públicos del BFF de groceries que sirven a la web (services.pedidosya.com).
Si los endpoints cambian, capturar las requests reales desde DevTools del
navegador y ajustar las constantes / funciones acá.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Iterator

import httpx

log = logging.getLogger(__name__)

BASE = "https://services.pedidosya.com"
WEB_ORIGIN = "https://www.pedidosya.com.ar"

# Nombre con el que figura PedidosYa Market (marca propia) en el feed.
MARKET_NAME_TOKENS = ("peya market", "pedidosya market")


def _headers(country: str, cookie: str | None = None, device_id: str | None = None) -> dict[str, str]:
    h = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
        "Origin": WEB_ORIGIN,
        "Referer": f"{WEB_ORIGIN}/",
        "Country": country,
        "X-FP-API-KEY": "web",
    }
    if cookie:
        h["Cookie"] = cookie
    if device_id:
        h["X-Device-Id"] = device_id
    return h


@dataclass(frozen=True)
class Vendor:
    id: str
    name: str
    raw: dict[str, Any]


@dataclass(frozen=True)
class DiscountedProduct:
    vendor_id: str
    vendor_name: str
    product_id: str
    name: str
    price: float
    original_price: float
    discount_pct: float
    url: str | None

    @property
    def dedupe_key(self) -> str:
        return f"{self.vendor_id}:{self.product_id}:{int(self.discount_pct)}:{int(self.price * 100)}"


class PedidosYaClient:
    def __init__(
        self,
        lat: float,
        lng: float,
        country: str = "AR",
        cookie: str | None = None,
        device_id: str | None = None,
        timeout: float = 20.0,
    ) -> None:
        self.lat = lat
        self.lng = lng
        self.country = country
        self._client = httpx.Client(
            headers=_headers(country, cookie, device_id),
            timeout=timeout,
            follow_redirects=True,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "PedidosYaClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def find_market_vendors(self) -> list[Vendor]:
        """Busca vendors de PedidosYa Market alcanzables desde la coord."""
        url = f"{BASE}/groceries-bff/v1/feeds/feed-discovery"
        params = {
            "point": f"{self.lat},{self.lng}",
            "country": self.country,
            "businessType": "GROCERIES",
        }
        try:
            r = self._client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPError as e:
            log.warning("feed-discovery failed (%s); trying fallback", e)
            return self._find_vendors_fallback()

        vendors: list[Vendor] = []
        for item in _walk_vendors(data):
            name = (item.get("name") or "").lower()
            if any(tok in name for tok in MARKET_NAME_TOKENS):
                vid = str(item.get("id") or item.get("vendorId") or "")
                if vid:
                    vendors.append(Vendor(id=vid, name=item.get("name", ""), raw=item))
        return vendors

    def _find_vendors_fallback(self) -> list[Vendor]:
        url = f"{BASE}/restaurants-feed/v1/feeds/feed-discovery"
        params = {
            "point": f"{self.lat},{self.lng}",
            "country": self.country,
            "businessType": "GROCERIES",
        }
        r = self._client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
        vendors: list[Vendor] = []
        for item in _walk_vendors(data):
            name = (item.get("name") or "").lower()
            if any(tok in name for tok in MARKET_NAME_TOKENS):
                vid = str(item.get("id") or item.get("vendorId") or "")
                if vid:
                    vendors.append(Vendor(id=vid, name=item.get("name", ""), raw=item))
        return vendors

    def iter_products(self, vendor_id: str) -> Iterator[dict[str, Any]]:
        """Itera el catálogo de un vendor con paginación."""
        url = f"{BASE}/groceries-bff/v1/vendors/{vendor_id}/products"
        page = 1
        page_size = 100
        while True:
            params = {
                "page": page,
                "pageSize": page_size,
                "point": f"{self.lat},{self.lng}",
                "country": self.country,
            }
            r = self._client.get(url, params=params)
            if r.status_code == 404:
                log.warning("vendor %s: products endpoint not found", vendor_id)
                return
            r.raise_for_status()
            data = r.json()
            items = _extract_products(data)
            if not items:
                return
            yield from items
            if len(items) < page_size:
                return
            page += 1
            if page > 200:
                log.warning("vendor %s: hit pagination safety limit", vendor_id)
                return

    def find_discounts(
        self,
        vendor: Vendor,
        threshold_pct: float,
    ) -> list[DiscountedProduct]:
        out: list[DiscountedProduct] = []
        for raw in self.iter_products(vendor.id):
            d = _normalize_product(raw, vendor)
            if d and d.discount_pct > threshold_pct:
                out.append(d)
        return out


def _walk_vendors(data: Any) -> Iterator[dict[str, Any]]:
    """Recorre estructuras anidadas y emite cualquier dict que parezca un vendor."""
    if isinstance(data, dict):
        if {"id", "name"} <= data.keys() and (
            "businessType" in data or "vertical" in data or "vendorType" in data
        ):
            yield data
        for v in data.values():
            yield from _walk_vendors(v)
    elif isinstance(data, list):
        for v in data:
            yield from _walk_vendors(v)


def _extract_products(data: Any) -> list[dict[str, Any]]:
    """Extrae la lista de productos de la respuesta (formato variable)."""
    if isinstance(data, dict):
        for key in ("products", "items", "results", "data"):
            v = data.get(key)
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
        # Anidado
        for v in data.values():
            if isinstance(v, dict):
                found = _extract_products(v)
                if found:
                    return found
    return []


def _normalize_product(raw: dict[str, Any], vendor: Vendor) -> DiscountedProduct | None:
    """Mapea distintos shapes posibles del JSON a DiscountedProduct."""
    pid = str(raw.get("id") or raw.get("productId") or raw.get("sku") or "")
    name = raw.get("name") or raw.get("title") or raw.get("description") or ""
    if not pid or not name:
        return None

    price_info = (
        raw.get("price")
        if isinstance(raw.get("price"), dict)
        else raw.get("productPriceInfo") or raw.get("priceInfo") or {}
    )

    final = _first_number(
        raw.get("finalPrice"),
        price_info.get("priceWithDiscount") if isinstance(price_info, dict) else None,
        price_info.get("finalPrice") if isinstance(price_info, dict) else None,
        raw.get("price") if not isinstance(raw.get("price"), dict) else None,
    )
    original = _first_number(
        raw.get("originalPrice"),
        price_info.get("originalPrice") if isinstance(price_info, dict) else None,
        price_info.get("price") if isinstance(price_info, dict) else None,
    )
    discount_pct = _first_number(
        raw.get("discountPercentage"),
        raw.get("discount"),
        price_info.get("discountPercentage") if isinstance(price_info, dict) else None,
        price_info.get("discount") if isinstance(price_info, dict) else None,
    )

    if final is None:
        return None

    if discount_pct is None:
        if original is not None and original > 0 and final is not None and final < original:
            discount_pct = round((1 - final / original) * 100, 2)
        else:
            return None
    if original is None:
        original = final / (1 - discount_pct / 100) if discount_pct < 100 else final

    url = raw.get("url") or raw.get("productUrl")
    if url and url.startswith("/"):
        url = WEB_ORIGIN + url

    return DiscountedProduct(
        vendor_id=vendor.id,
        vendor_name=vendor.name,
        product_id=pid,
        name=name,
        price=float(final),
        original_price=float(original),
        discount_pct=float(discount_pct),
        url=url,
    )


def _first_number(*values: Any) -> float | None:
    for v in values:
        if v is None:
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return None
