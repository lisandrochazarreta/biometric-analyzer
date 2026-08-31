"""Herramientas de línea de comandos.

    python -m carrito.cli probe                # ¿qué tiendas responden hoy?
    python -m carrito.cli buscar leche --tienda coto
    python -m carrito.cli chat                 # hablarle al agente sin WhatsApp
"""
from __future__ import annotations

import argparse
import logging
import sys

from . import config
from .agent import ShoppingAgent, fmt_money
from .storage import Storage
from .stores import load_stores, resolve
from .vtex import VtexClient

log = logging.getLogger("carrito.cli")

LOCAL_USER = "+000000000000"


def cmd_probe(args: argparse.Namespace) -> int:
    """Chequea, tienda por tienda, si los endpoints públicos siguen andando."""
    cfg = config.load()
    stores = load_stores(cfg.stores_file)
    term = args.termino
    ok_count = 0

    with VtexClient(timeout=cfg.http_timeout) as vtex:
        for store in stores.values():
            print(f"\n=== {store.name} ({store.key}) — {store.host}")
            try:
                products = vtex.search(store, term, limit=3)
            except Exception as e:  # noqa: BLE001
                print(f"  catálogo: ERROR ({e})")
                continue
            if not products:
                print(f"  catálogo: sin resultados para '{term}' (o el endpoint cambió)")
                if store.note:
                    print(f"  nota: {store.note}")
                continue

            ok_count += 1
            print(f"  catálogo: OK, {len(products)} resultado(s)")
            for p in products:
                stock = "" if p.available else "  [sin stock]"
                print(f"    - {p.name[:60]:60s} {fmt_money(p.price):>12s}  sku={p.sku}{stock}")

            first = products[0]
            sim = vtex.simulate(store, [(first.sku, 1, first.seller)], cfg.postal_code)
            if sim:
                print(f"  simulación: OK, total {fmt_money(sim.total)} (CP {cfg.postal_code})")
            else:
                print("  simulación: falló (el agente va a usar precios de catálogo)")
            print(f"  link carrito: {vtex.cart_url(store, [(first.sku, 1, first.seller)])}")

    print(f"\n{ok_count}/{len(stores)} tiendas respondieron.")
    return 0 if ok_count else 1


def cmd_buscar(args: argparse.Namespace) -> int:
    cfg = config.load()
    stores = load_stores(cfg.stores_file)
    store = resolve(stores, args.tienda or cfg.default_store)
    if not store:
        print(f"no conozco la tienda '{args.tienda}'. Opciones: {', '.join(stores)}")
        return 1
    with VtexClient(timeout=cfg.http_timeout) as vtex:
        products = vtex.search(store, " ".join(args.termino), limit=args.limite)
    if not products:
        print("sin resultados")
        return 1
    for p in products:
        stock = "" if p.available else "  [sin stock]"
        off = f"  -{p.discount_pct:.0f}%" if p.discount_pct else ""
        print(f"{fmt_money(p.price):>12s}  {p.name[:60]:60s}  sku={p.sku}{off}{stock}")
    return 0


def cmd_chat(args: argparse.Namespace) -> int:
    """REPL local contra el mismo agente que atiende WhatsApp."""
    cfg = config.load()
    storage = Storage(cfg.db_path)
    agent = ShoppingAgent(cfg, storage)
    user = args.usuario or LOCAL_USER
    print(f"Chat local (usuario {user}). Ctrl-C o 'salir' para terminar.\n")
    try:
        while True:
            try:
                text = input("vos > ").strip()
            except EOFError:
                break
            if text.lower() in {"salir", "exit", "quit"}:
                break
            if not text:
                continue
            print(f"\nbot > {agent.handle(user, text)}\n")
    except KeyboardInterrupt:
        print()
    finally:
        storage.close()
    return 0


def cmd_carrito(args: argparse.Namespace) -> int:
    cfg = config.load()
    storage = Storage(cfg.db_path)
    stores = load_stores(cfg.stores_file)
    user = args.usuario or LOCAL_USER
    store_key = storage.get_store(user, cfg.default_store)
    store = stores.get(store_key)
    items = storage.get_cart(user, store_key)
    print(f"Carrito de {user} en {store.name if store else store_key}:")
    if not items:
        print("  (vacío)")
        return 0
    for i in items:
        print(f"  {i.qty:>3d} x {i.name[:55]:55s} {fmt_money(i.subtotal):>12s}")
    print(f"  {'TOTAL':>62s} {fmt_money(sum(i.subtotal for i in items)):>12s}")
    if store:
        with VtexClient(timeout=cfg.http_timeout) as vtex:
            print("\n" + vtex.cart_url(store, [(i.sku, i.qty, i.seller) for i in items]))
    storage.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="carrito", description="Agente de carrito de super")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("probe", help="Chequea qué tiendas responden hoy")
    p.add_argument("--termino", default="leche", help="Término de prueba (default: leche)")
    p.set_defaults(func=cmd_probe)

    p = sub.add_parser("buscar", help="Busca productos en una tienda")
    p.add_argument("termino", nargs="+")
    p.add_argument("--tienda", default=None)
    p.add_argument("--limite", type=int, default=8)
    p.set_defaults(func=cmd_buscar)

    p = sub.add_parser("chat", help="Chat local con el agente (sin WhatsApp)")
    p.add_argument("--usuario", default=None, help="ID de usuario a usar (default: local)")
    p.set_defaults(func=cmd_chat)

    p = sub.add_parser("carrito", help="Muestra el carrito guardado de un usuario")
    p.add_argument("--usuario", default=None)
    p.set_defaults(func=cmd_carrito)

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
