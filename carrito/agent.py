"""El cerebro: Claude con herramientas para armar el carrito.

Regla de oro: el agente **nunca compra ni paga**. Busca, arma el carrito y
devuelve un link a la tienda para que la persona revise, elija envío y pague.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import anthropic

from .config import Config
from .stores import Store, load_stores, resolve
from .storage import CartItem, Storage
from .vtex import Product, VtexClient

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
Sos un asistente de compras de supermercado que habla por WhatsApp con una \
persona en Argentina. Tu trabajo es entender qué necesita y armarle el carrito \
en la tienda online que tenga elegida.

Cómo trabajás:
- Español rioplatense, informal, directo. Nada de "¡Claro! Con gusto...".
- WhatsApp: mensajes cortos. Nada de tablas ni markdown; para negrita usá *asteriscos*.
- Cuando te piden varias cosas ("leche, pan y fideos"), buscá todo antes de responder.
- Si la búsqueda devuelve un solo candidato razonable o la persona ya dijo marca y \
tamaño, agregalo directo y avisá qué agregaste y a cuánto. No preguntes de más.
- Si hay varias opciones que difieren en algo que importa (marca, tamaño, precio muy \
distinto), mostrá 2 o 3 con precio y que elija. Numeralas 1, 2, 3.
- Precios siempre en pesos, con el formato $1.234,56.
- Si un producto no está o no hay stock, decilo y ofrecé la alternativa más parecida.
- Al final de un pedido, o cuando te lo pidan, usá finalizar_carrito y mandá el link.

Límites importantes, no los cruces:
- No comprás, no pagás y no confirmás pedidos. Armás el carrito y pasás el link; \
la persona revisa, elige envío y paga en la web de la tienda. Si te piden que \
compres directamente, explicá que hasta ahí llegás.
- Los precios y el stock son los que devuelven las herramientas en este momento; \
pueden cambiar cuando la persona abra el link. No inventes precios ni productos: \
si no lo devolvió una herramienta, no existe.
- No agregues nada al carrito que no te hayan pedido.
"""

TOOLS: list[dict[str, Any]] = [
    {
        "name": "buscar_producto",
        "description": (
            "Busca productos en el catálogo del supermercado activo. Usala siempre "
            "antes de agregar algo: el SKU que devuelve es lo único que sirve para "
            "agregar al carrito. Buscá términos cortos ('leche entera', 'yerba')."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "consulta": {"type": "string", "description": "Qué buscar, ej. 'leche entera 1l'"},
                "max_resultados": {
                    "type": "integer",
                    "description": "Cuántos resultados traer. Usá 6 salvo que necesites más.",
                },
            },
            "required": ["consulta", "max_resultados"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "name": "agregar_al_carrito",
        "description": (
            "Agrega un producto al carrito por SKU. Si el SKU ya estaba, suma la "
            "cantidad. El SKU tiene que venir de buscar_producto."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sku": {"type": "string"},
                "cantidad": {"type": "integer", "description": "Unidades a agregar (mínimo 1)."},
            },
            "required": ["sku", "cantidad"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "name": "ver_carrito",
        "description": "Devuelve el carrito actual con cantidades, precios y subtotal.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "name": "modificar_cantidad",
        "description": "Fija la cantidad de un SKU que ya está en el carrito. Con cantidad 0 lo saca.",
        "input_schema": {
            "type": "object",
            "properties": {
                "sku": {"type": "string"},
                "cantidad": {"type": "integer"},
            },
            "required": ["sku", "cantidad"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "name": "vaciar_carrito",
        "description": "Vacía el carrito del supermercado activo. Confirmá con la persona antes de usarla.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "name": "finalizar_carrito",
        "description": (
            "Cierra el armado: simula el total real en la tienda (con promos y stock) "
            "y devuelve el link para que la persona abra el carrito, elija envío y pague. "
            "No compra nada."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "name": "listar_supermercados",
        "description": "Lista los supermercados disponibles y marca cuál está activo.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "name": "cambiar_supermercado",
        "description": (
            "Cambia el supermercado activo. Cada supermercado tiene su propio carrito: "
            "lo que había en el anterior queda guardado ahí."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"tienda": {"type": "string", "description": "Key o nombre, ej. 'coto'"}},
            "required": ["tienda"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]


def fmt_money(v: float) -> str:
    s = f"{v:,.2f}"
    return "$" + s.replace(",", "_").replace(".", ",").replace("_", ".")


class ShoppingAgent:
    def __init__(
        self,
        cfg: Config,
        storage: Storage,
        vtex: VtexClient | None = None,
        client: Any | None = None,
    ) -> None:
        self.cfg = cfg
        self.storage = storage
        self.stores = load_stores(cfg.stores_file)
        if cfg.default_store not in self.stores:
            log.warning(
                "DEFAULT_STORE=%s no existe; uso %s",
                cfg.default_store,
                next(iter(self.stores)),
            )
        self.vtex = vtex or VtexClient(timeout=cfg.http_timeout)
        self.client = client or anthropic.Anthropic()
        self._fallbacks_ok = True
        # Cache de productos vistos por usuario, para no re-consultar al agregar.
        self._seen: dict[str, dict[str, Product]] = {}

    # ------------------------------------------------------------------ público

    def handle(self, user_id: str, text: str) -> str:
        """Procesa un mensaje entrante y devuelve la respuesta a mandar."""
        text = (text or "").strip()
        if not text:
            return "No me llegó texto. Escribime qué necesitás comprar."
        if text.lower() in {"/reset", "reset", "empezar de nuevo"}:
            self.storage.reset(user_id)
            self._seen.pop(user_id, None)
            return "Listo, arranco de cero. ¿Qué necesitás?"

        history = self.storage.get_history(user_id)
        messages: list[dict[str, Any]] = [*history, {"role": "user", "content": text}]

        reply = ""
        for _ in range(self.cfg.max_tool_iterations):
            response = self._create(messages)

            if response.stop_reason == "refusal":
                reply = "Perdón, con eso no puedo ayudarte. ¿Seguimos con la compra?"
                break

            messages.append({"role": "assistant", "content": _to_params(response.content)})

            if response.stop_reason != "tool_use":
                reply = _text_of(response.content)
                break

            results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                out = self._dispatch(user_id, block.name, block.input or {})
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": out,
                    }
                )
            # Todos los tool_result van en UN solo mensaje de usuario.
            messages.append({"role": "user", "content": results})
        else:
            log.warning("user %s: corté el loop en %d iteraciones", user_id, self.cfg.max_tool_iterations)
            reply = (
                "Me estoy enredando con esta búsqueda. ¿Me la decís más simple, "
                "producto por producto?"
            )

        reply = reply.strip() or "Listo."
        self.storage.set_history(
            user_id,
            [*history, {"role": "user", "content": text}, {"role": "assistant", "content": reply}],
            self.cfg.history_turns * 2,
            default_store=self._store_of(user_id).key,
        )
        return reply

    # ------------------------------------------------------------------- Claude

    def _create(self, messages: list[dict[str, Any]]) -> Any:
        kwargs: dict[str, Any] = {
            "model": self.cfg.model,
            "max_tokens": self.cfg.max_tokens,
            "system": [
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": self.cfg.effort},
            "tools": TOOLS,
            "messages": messages,
        }
        if self._fallbacks_ok:
            try:
                return self.client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                    **kwargs,
                )
            except (TypeError, anthropic.BadRequestError) as e:
                log.warning("fallbacks del lado del servidor no disponibles (%s); sigo sin eso", e)
                self._fallbacks_ok = False
        return self.client.messages.create(**kwargs)

    # ------------------------------------------------------------ herramientas

    def _store_of(self, user_id: str) -> Store:
        key = self.storage.get_store(user_id, self.cfg.default_store)
        return self.stores.get(key) or next(iter(self.stores.values()))

    def _dispatch(self, user_id: str, name: str, args: dict[str, Any]) -> str:
        try:
            fn = getattr(self, f"_tool_{name}", None)
            if fn is None:
                return json.dumps({"error": f"herramienta desconocida: {name}"})
            return fn(user_id, args)
        except Exception as e:  # noqa: BLE001 - el modelo tiene que poder seguir
            log.exception("herramienta %s falló", name)
            return json.dumps({"error": f"la herramienta falló: {e}"}, ensure_ascii=False)

    def _tool_buscar_producto(self, user_id: str, args: dict[str, Any]) -> str:
        store = self._store_of(user_id)
        limit = max(1, min(int(args.get("max_resultados") or 6), 20))
        products = self.vtex.search(store, str(args.get("consulta", "")), limit)
        cache = self._seen.setdefault(user_id, {})
        for p in products:
            cache[p.sku] = p
        if not products:
            return json.dumps(
                {
                    "tienda": store.name,
                    "resultados": [],
                    "nota": "Sin resultados. Probá con otro término o menos palabras.",
                },
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "tienda": store.name,
                "resultados": [
                    {
                        "sku": p.sku,
                        "nombre": p.name,
                        "marca": p.brand,
                        "precio": p.price,
                        "precio_lista": p.list_price,
                        "descuento_pct": p.discount_pct,
                        "hay_stock": p.available,
                    }
                    for p in products
                ],
            },
            ensure_ascii=False,
        )

    def _lookup(self, user_id: str, store: Store, sku: str) -> Product | None:
        cached = self._seen.get(user_id, {}).get(sku)
        if cached and cached.store_key == store.key:
            return cached
        found = self.vtex.get_by_sku(store, sku)
        if found:
            self._seen.setdefault(user_id, {})[sku] = found
        return found

    def _tool_agregar_al_carrito(self, user_id: str, args: dict[str, Any]) -> str:
        store = self._store_of(user_id)
        sku = str(args.get("sku", "")).strip()
        qty = max(1, int(args.get("cantidad") or 1))
        product = self._lookup(user_id, store, sku)
        if not product:
            return json.dumps(
                {"error": f"no encontré el SKU {sku} en {store.name}. Buscá de nuevo."},
                ensure_ascii=False,
            )
        item = self.storage.add_item(
            user_id,
            store.key,
            CartItem(
                sku=product.sku,
                qty=qty,
                name=product.name,
                brand=product.brand,
                price=product.price,
                seller=product.seller,
                url=product.url,
            ),
        )
        return json.dumps(
            {
                "agregado": {
                    "sku": item.sku,
                    "nombre": item.name,
                    "cantidad_total": item.qty,
                    "precio_unitario": item.price,
                    "subtotal": item.subtotal,
                    "hay_stock": product.available,
                },
                "items_en_carrito": len(self.storage.get_cart(user_id, store.key)),
            },
            ensure_ascii=False,
        )

    def _cart_payload(self, user_id: str, store: Store) -> dict[str, Any]:
        items = self.storage.get_cart(user_id, store.key)
        return {
            "tienda": store.name,
            "items": [
                {
                    "sku": i.sku,
                    "nombre": i.name,
                    "cantidad": i.qty,
                    "precio_unitario": i.price,
                    "subtotal": i.subtotal,
                }
                for i in items
            ],
            "subtotal_estimado": round(sum(i.subtotal for i in items), 2),
        }

    def _tool_ver_carrito(self, user_id: str, _args: dict[str, Any]) -> str:
        return json.dumps(self._cart_payload(user_id, self._store_of(user_id)), ensure_ascii=False)

    def _tool_modificar_cantidad(self, user_id: str, args: dict[str, Any]) -> str:
        store = self._store_of(user_id)
        sku = str(args.get("sku", "")).strip()
        qty = int(args.get("cantidad", 0))
        ok = self.storage.set_qty(user_id, store.key, sku, qty)
        if not ok:
            return json.dumps({"error": f"el SKU {sku} no está en el carrito"}, ensure_ascii=False)
        payload = self._cart_payload(user_id, store)
        payload["accion"] = "eliminado" if qty <= 0 else f"cantidad ajustada a {qty}"
        return json.dumps(payload, ensure_ascii=False)

    def _tool_vaciar_carrito(self, user_id: str, _args: dict[str, Any]) -> str:
        store = self._store_of(user_id)
        n = self.storage.clear_cart(user_id, store.key)
        return json.dumps({"eliminados": n, "tienda": store.name}, ensure_ascii=False)

    def _tool_finalizar_carrito(self, user_id: str, _args: dict[str, Any]) -> str:
        store = self._store_of(user_id)
        items = self.storage.get_cart(user_id, store.key)
        if not items:
            return json.dumps({"error": "el carrito está vacío"}, ensure_ascii=False)

        triples = [(i.sku, i.qty, i.seller) for i in items]
        estimated = round(sum(i.subtotal for i in items), 2)
        sim = self.vtex.simulate(store, triples, self.cfg.postal_code)

        payload: dict[str, Any] = {
            "tienda": store.name,
            "cantidad_items": len(items),
            "subtotal_estimado": estimated,
            "link_carrito": self.vtex.cart_url(store, triples),
            "nota": (
                "El link agrega estos productos al carrito de la tienda. La persona "
                "tiene que revisar, elegir envío y pagar ahí. Vos no comprás nada."
            ),
        }
        if sim:
            payload["total_simulado"] = sim.total
            payload["descuentos"] = sim.discounts
            if sim.unavailable_skus:
                payload["sin_stock"] = list(sim.unavailable_skus)
        else:
            payload["aviso_total"] = (
                "No pude simular el total en la tienda; el subtotal es la suma de precios "
                "de catálogo, sin promos ni envío."
            )
        return json.dumps(payload, ensure_ascii=False)

    def _tool_listar_supermercados(self, user_id: str, _args: dict[str, Any]) -> str:
        active = self._store_of(user_id)
        return json.dumps(
            {
                "activo": active.key,
                "disponibles": [
                    {"key": s.key, "nombre": s.name} for s in self.stores.values()
                ],
            },
            ensure_ascii=False,
        )

    def _tool_cambiar_supermercado(self, user_id: str, args: dict[str, Any]) -> str:
        target = resolve(self.stores, str(args.get("tienda", "")))
        if not target:
            return json.dumps(
                {
                    "error": "no reconozco ese supermercado",
                    "disponibles": [s.key for s in self.stores.values()],
                },
                ensure_ascii=False,
            )
        self.storage.set_store(user_id, target.key)
        cart = self.storage.get_cart(user_id, target.key)
        return json.dumps(
            {"activo": target.key, "nombre": target.name, "items_en_ese_carrito": len(cart)},
            ensure_ascii=False,
        )


# ------------------------------------------------------------------- helpers


def _to_params(content: Any) -> list[dict[str, Any]]:
    """Serializa los bloques de la respuesta para poder reenviarlos."""
    out = []
    for block in content:
        if hasattr(block, "model_dump"):
            out.append(block.model_dump(mode="json", exclude_none=True))
        elif isinstance(block, dict):
            out.append(block)
    return out


def _text_of(content: Any) -> str:
    parts = []
    for block in content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "\n".join(p for p in parts if p).strip()
