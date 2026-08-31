"""Persistencia en SQLite: carrito, tienda elegida e historial por usuario.

La clave de todo es el número de WhatsApp (formato E.164, sin el prefijo
`whatsapp:`). Cada usuario tiene un carrito por tienda.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id     TEXT PRIMARY KEY,
    store_key   TEXT NOT NULL,
    history     TEXT NOT NULL DEFAULT '[]',
    updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS cart_items (
    user_id     TEXT NOT NULL,
    store_key   TEXT NOT NULL,
    sku         TEXT NOT NULL,
    qty         INTEGER NOT NULL,
    name        TEXT NOT NULL,
    brand       TEXT NOT NULL DEFAULT '',
    price       REAL NOT NULL,
    seller      TEXT NOT NULL DEFAULT '1',
    url         TEXT NOT NULL DEFAULT '',
    added_at    REAL NOT NULL,
    PRIMARY KEY (user_id, store_key, sku)
);
CREATE TABLE IF NOT EXISTS processed (
    message_id  TEXT PRIMARY KEY,
    ts          REAL NOT NULL
);
"""

PROCESSED_TTL = 24 * 3600


@dataclass(frozen=True)
class CartItem:
    sku: str
    qty: int
    name: str
    brand: str
    price: float
    seller: str
    url: str

    @property
    def subtotal(self) -> float:
        return round(self.price * self.qty, 2)


class Storage:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        with self._cx() as cx:
            cx.executescript(SCHEMA)

    @contextmanager
    def _cx(self):
        """Una conexión por operación: el server contesta desde varios threads."""
        with self._lock:
            conn = sqlite3.connect(self.path, timeout=10)
            conn.row_factory = sqlite3.Row
            try:
                yield conn
                conn.commit()
            finally:
                conn.close()

    def close(self) -> None:  # nada que cerrar: las conexiones son por operación
        return None

    # ------------------------------------------------------------------ usuario

    def get_store(self, user_id: str, default: str) -> str:
        with self._cx() as cx:
            row = cx.execute(
                "SELECT store_key FROM users WHERE user_id = ?", (user_id,)
            ).fetchone()
        if row:
            return row["store_key"]
        self.set_store(user_id, default)
        return default

    def set_store(self, user_id: str, store_key: str) -> None:
        with self._cx() as cx:
            cx.execute(
                "INSERT INTO users (user_id, store_key, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET store_key = excluded.store_key, "
                "updated_at = excluded.updated_at",
                (user_id, store_key, time.time()),
            )

    # --------------------------------------------------------------- historial

    def get_history(self, user_id: str) -> list[dict]:
        with self._cx() as cx:
            row = cx.execute(
                "SELECT history FROM users WHERE user_id = ?", (user_id,)
            ).fetchone()
        if not row:
            return []
        try:
            data = json.loads(row["history"])
        except json.JSONDecodeError:
            return []
        return data if isinstance(data, list) else []

    def set_history(
        self, user_id: str, history: list[dict], max_messages: int, default_store: str = ""
    ) -> None:
        trimmed = history[-max_messages:] if max_messages > 0 else history
        # El historial siempre tiene que arrancar con un turno del usuario.
        while trimmed and trimmed[0].get("role") != "user":
            trimmed = trimmed[1:]
        blob = json.dumps(trimmed, ensure_ascii=False)
        with self._cx() as cx:
            cx.execute(
                "INSERT INTO users (user_id, store_key, history, updated_at) "
                "VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET "
                "history = excluded.history, updated_at = excluded.updated_at",
                (user_id, default_store, blob, time.time()),
            )

    def reset(self, user_id: str) -> None:
        with self._cx() as cx:
            cx.execute("UPDATE users SET history = '[]' WHERE user_id = ?", (user_id,))

    # ----------------------------------------------------------------- carrito

    def get_cart(self, user_id: str, store_key: str) -> list[CartItem]:
        with self._cx() as cx:
            rows = cx.execute(
                "SELECT sku, qty, name, brand, price, seller, url FROM cart_items "
                "WHERE user_id = ? AND store_key = ? ORDER BY added_at",
                (user_id, store_key),
            ).fetchall()
        return [
            CartItem(
                sku=r["sku"],
                qty=r["qty"],
                name=r["name"],
                brand=r["brand"],
                price=r["price"],
                seller=r["seller"],
                url=r["url"],
            )
            for r in rows
        ]

    def add_item(self, user_id: str, store_key: str, item: CartItem) -> CartItem:
        """Suma cantidad si el SKU ya estaba. Devuelve el item resultante."""
        existing = {i.sku: i for i in self.get_cart(user_id, store_key)}
        qty = item.qty + (existing[item.sku].qty if item.sku in existing else 0)
        qty = max(1, qty)
        with self._cx() as cx:
            cx.execute(
                "INSERT INTO cart_items (user_id, store_key, sku, qty, name, brand, price, "
                "seller, url, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(user_id, store_key, sku) DO UPDATE SET qty = excluded.qty, "
                "price = excluded.price, name = excluded.name, url = excluded.url",
                (
                    user_id, store_key, item.sku, qty, item.name, item.brand,
                    item.price, item.seller, item.url, time.time(),
                ),
            )
        return CartItem(item.sku, qty, item.name, item.brand, item.price, item.seller, item.url)

    def set_qty(self, user_id: str, store_key: str, sku: str, qty: int) -> bool:
        """qty <= 0 elimina el item. Devuelve False si el SKU no estaba."""
        with self._cx() as cx:
            row = cx.execute(
                "SELECT 1 FROM cart_items WHERE user_id = ? AND store_key = ? AND sku = ?",
                (user_id, store_key, sku),
            ).fetchone()
            if not row:
                return False
            if qty <= 0:
                cx.execute(
                    "DELETE FROM cart_items WHERE user_id = ? AND store_key = ? AND sku = ?",
                    (user_id, store_key, sku),
                )
            else:
                cx.execute(
                    "UPDATE cart_items SET qty = ? WHERE user_id = ? AND store_key = ? AND sku = ?",
                    (qty, user_id, store_key, sku),
                )
        return True

    def clear_cart(self, user_id: str, store_key: str) -> int:
        with self._cx() as cx:
            cur = cx.execute(
                "DELETE FROM cart_items WHERE user_id = ? AND store_key = ?",
                (user_id, store_key),
            )
            return cur.rowcount

    # ------------------------------------------------------- dedupe de webhooks

    def mark_processed(self, message_id: str) -> bool:
        """False si ese message_id ya se había procesado (webhook reintentado)."""
        if not message_id:
            return True
        with self._cx() as cx:
            cx.execute("DELETE FROM processed WHERE ts < ?", (time.time() - PROCESSED_TTL,))
            try:
                cx.execute(
                    "INSERT INTO processed (message_id, ts) VALUES (?, ?)",
                    (message_id, time.time()),
                )
            except sqlite3.IntegrityError:
                return False
        return True
