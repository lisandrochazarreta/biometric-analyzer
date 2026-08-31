"""Registro de supermercados soportados.

Todos los que están acá corren su e-commerce sobre **VTEX**, que expone
endpoints públicos (sin API key) para buscar en el catálogo, simular precios
y armar un link de carrito. No son APIs "oficiales para terceros": son los
mismos endpoints que usa la web de cada cadena.

Si una cadena cambia de host o de plataforma, no hace falta tocar código:
apuntá `STORES_FILE` en `.env` a un JSON con la misma forma que
`DEFAULT_STORES` y sobreescribe/agrega tiendas.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, replace
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Store:
    key: str
    name: str
    host: str
    sales_channel: str = "1"
    platform: str = "vtex"
    country: str = "ARG"
    note: str = ""

    @property
    def base_url(self) -> str:
        return f"https://{self.host}"


DEFAULT_STORES: tuple[Store, ...] = (
    Store(
        key="coto",
        name="Coto Digital",
        host="www.cotodigital.com.ar",
        note=(
            "Coto no publica una API para terceros. Estos son los endpoints "
            "públicos de su tienda VTEX. Si migró de host o de plataforma, "
            "corré `python -m carrito.cli probe` y ajustá STORES_FILE."
        ),
    ),
    Store(key="jumbo", name="Jumbo", host="www.jumbo.com.ar"),
    Store(key="disco", name="Disco", host="www.disco.com.ar"),
    Store(key="vea", name="Vea", host="www.vea.com.ar"),
    Store(key="carrefour", name="Carrefour", host="www.carrefour.com.ar"),
    Store(key="dia", name="Supermercados DIA", host="diaonline.supermercadosdia.com.ar"),
    Store(key="masonline", name="ChangoMás / Mas Online", host="www.masonline.com.ar"),
)


def load_stores(stores_file: Path | None = None) -> dict[str, Store]:
    """Devuelve el registro de tiendas, con overrides opcionales de un JSON."""
    stores = {s.key: s for s in DEFAULT_STORES}
    if not stores_file:
        return stores
    try:
        raw = json.loads(Path(stores_file).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        log.warning("no pude leer STORES_FILE=%s (%s); uso los defaults", stores_file, e)
        return stores

    for key, patch in raw.items():
        key = key.lower()
        if not isinstance(patch, dict):
            continue
        fields = {k: v for k, v in patch.items() if k in Store.__dataclass_fields__ and k != "key"}
        if key in stores:
            stores[key] = replace(stores[key], **fields)
        elif "host" in fields:
            stores[key] = Store(key=key, name=fields.pop("name", key.title()), **fields)
    return stores


def resolve(stores: dict[str, Store], query: str) -> Store | None:
    """Busca una tienda por key o por nombre (tolerante a mayúsculas/parciales)."""
    q = (query or "").strip().lower()
    if not q:
        return None
    if q in stores:
        return stores[q]
    for s in stores.values():
        if q == s.name.lower():
            return s
    matches = [s for s in stores.values() if q in s.name.lower() or q in s.key]
    return matches[0] if len(matches) == 1 else None
