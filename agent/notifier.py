"""Cliente ntfy para enviar notificaciones push."""
from __future__ import annotations

import logging

import httpx

from .pedidosya import DiscountedProduct

log = logging.getLogger(__name__)


class NtfyNotifier:
    def __init__(self, url: str, timeout: float = 10.0) -> None:
        self.url = url
        self._client = httpx.Client(timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def send(self, product: DiscountedProduct) -> None:
        title = f"PeYa Market: {int(product.discount_pct)}% off"
        body = (
            f"{product.name}\n"
            f"${product.price:.2f}  (antes ${product.original_price:.2f})\n"
            f"Tienda: {product.vendor_name}"
        )
        headers = {
            "Title": _ascii_safe(title),
            "Priority": "high",
            "Tags": "shopping_cart,fire",
        }
        if product.url:
            headers["Click"] = product.url
        try:
            r = self._client.post(self.url, content=body.encode("utf-8"), headers=headers)
            r.raise_for_status()
            log.info("ntfy sent: %s (%.0f%%)", product.name, product.discount_pct)
        except httpx.HTTPError as e:
            log.error("ntfy failed for %s: %s", product.name, e)


def _ascii_safe(s: str) -> str:
    """ntfy headers deben ser ASCII; reemplazamos no-ASCII."""
    return s.encode("ascii", errors="replace").decode("ascii")
