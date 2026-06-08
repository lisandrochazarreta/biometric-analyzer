"""Replay: corre un track 'en vivo' contra un fantasma e imprime el gap + voz.

Sirve para testear el motor con dos GPX (exportados de Garmin) sin salir a
correr. Las líneas 🔊 son lo que sonaría por los Ray-Ban.
"""
from __future__ import annotations

import argparse
import sys

from .gap import GapEngine, GapResult, Narrator
from .track import Ghost, TrackPoint, parse_gpx


def replay(ghost: Ghost, run: list[TrackPoint], every: int = 10, quiet: bool = False) -> GapResult:
    """Reproduce ``run`` contra ``ghost``. Devuelve el GapResult final."""
    engine = GapEngine(ghost)
    narrator = Narrator()
    last: GapResult | None = None
    for i, p in enumerate(run):
        last = engine.update(p.lat, p.lon, p.t)
        phrase = narrator.narrate(last)
        if not quiet:
            if phrase:
                print(f"  [{_clock(p.t)}] 🔊 {phrase}")
            elif i % every == 0:
                sign = "+" if last.gap_seconds >= 0 else "-"
                print(
                    f"  [{_clock(p.t)}] {sign}{abs(last.gap_seconds):4.1f}s  "
                    f"{last.dist_along/1000:5.2f}km  ({last.progress*100:4.0f}%)"
                )
    assert last is not None
    return last


def _clock(secs: float) -> str:
    m, s = divmod(int(secs), 60)
    return f"{m:02d}:{s:02d}"


def main() -> int:
    ap = argparse.ArgumentParser(description="Corré contra tu fantasma (replay de GPX)")
    ap.add_argument("--ghost", required=True, help="GPX de la corrida de referencia")
    ap.add_argument("--run", required=True, help="GPX de la corrida a comparar")
    ap.add_argument("--every", type=int, default=10, help="cada cuántas muestras imprime el gap")
    args = ap.parse_args()

    ghost = Ghost(parse_gpx(args.ghost))
    run = parse_gpx(args.run)
    print(f"Fantasma: {ghost.total_distance/1000:.2f} km en {_clock(ghost.total_time)}")
    final = replay(ghost, run, every=args.every)
    verb = "Le ganaste por" if final.gap_seconds >= 0 else "Perdiste por"
    print(f"\n{verb} {abs(final.gap_seconds):.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
