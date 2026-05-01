"""Estado persistente para deduplicar productos ya notificados."""
from __future__ import annotations

import json
import time
from pathlib import Path

# Una entrada vista expira después de este TTL para que un descuento
# que reaparece días después vuelva a notificar.
TTL_SECONDS = 7 * 24 * 3600


class SeenState:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._data: dict[str, float] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            self._data = json.loads(self.path.read_text())
        except (json.JSONDecodeError, OSError):
            self._data = {}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(self._data))
        tmp.replace(self.path)

    def has(self, key: str) -> bool:
        ts = self._data.get(key)
        if ts is None:
            return False
        if time.time() - ts > TTL_SECONDS:
            self._data.pop(key, None)
            return False
        return True

    def add(self, key: str) -> None:
        self._data[key] = time.time()

    def prune_and_save(self) -> None:
        cutoff = time.time() - TTL_SECONDS
        self._data = {k: t for k, t in self._data.items() if t >= cutoff}
        self._save()
