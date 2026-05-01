"""Entry point: corre el scan, filtra descuentos > umbral y avisa por ntfy."""
from __future__ import annotations

import argparse
import logging
import sys

from . import config
from .notifier import NtfyNotifier
from .pedidosya import PedidosYaClient, Vendor
from .state import SeenState

log = logging.getLogger("peya-agent")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def run(dry_run: bool = False) -> int:
    cfg = config.load()
    state = SeenState(cfg.state_file)

    with PedidosYaClient(
        lat=cfg.lat,
        lng=cfg.lng,
        country=cfg.country,
        cookie=cfg.cookie,
        device_id=cfg.device_id,
    ) as client:
        if cfg.vendor_id:
            vendors = [Vendor(id=cfg.vendor_id, name="PeYa Market", raw={})]
        else:
            vendors = client.find_market_vendors()
            log.info("found %d PeYa Market vendor(s)", len(vendors))

        if not vendors:
            log.warning(
                "no PeYa Market vendors found for (%s,%s). "
                "Setear PEYA_VENDOR_ID en .env para forzar uno.",
                cfg.lat,
                cfg.lng,
            )
            return 0

        notifier = NtfyNotifier(cfg.ntfy_url) if not dry_run else None
        new_count = 0
        try:
            for v in vendors:
                log.info("scanning vendor %s (%s)", v.id, v.name)
                discounts = client.find_discounts(v, cfg.discount_threshold)
                log.info("  %d products over %.0f%%", len(discounts), cfg.discount_threshold)
                for d in discounts:
                    if state.has(d.dedupe_key):
                        continue
                    log.info("  NEW: %s (%.0f%% off, $%.2f)", d.name, d.discount_pct, d.price)
                    if notifier:
                        notifier.send(d)
                    state.add(d.dedupe_key)
                    new_count += 1
        finally:
            if notifier:
                notifier.close()
            state.prune_and_save()

        log.info("done. %d new notification(s)", new_count)
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="PedidosYa Market discount watcher")
    p.add_argument("--dry-run", action="store_true", help="No envía a ntfy, solo loguea")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()
    _setup_logging(args.verbose)
    try:
        return run(dry_run=args.dry_run)
    except KeyboardInterrupt:
        return 130
    except Exception:
        log.exception("scan failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
