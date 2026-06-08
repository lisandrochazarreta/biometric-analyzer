"""Tests del motor de gap. Corré: python -m pytest -q  (o python tests/test_gap.py)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ghost.gap import GapEngine, Narrator  # noqa: E402
from ghost.synth import make_route, run_route  # noqa: E402
from ghost.track import Ghost  # noqa: E402


def _final_gap(ghost: Ghost, runner) -> float:
    engine = GapEngine(ghost)
    last = None
    for p in runner:
        last = engine.update(p.lat, p.lon, p.t)
    assert last is not None
    return last.gap_seconds


def test_identical_runner_is_near_zero():
    route = make_route()
    track = run_route(route, lambda prog: 3.0)
    ghost = Ghost(track)
    # Mismo track => gap ~0 en todo momento.
    assert abs(_final_gap(ghost, track)) < 1.0


def test_faster_runner_wins():
    route = make_route()
    ghost = Ghost(run_route(route, lambda prog: 3.0))
    faster = run_route(route, lambda prog: 3.3)  # uniformemente más rápido
    assert _final_gap(ghost, faster) > 5.0  # termina bastante arriba


def test_slower_runner_loses():
    route = make_route()
    ghost = Ghost(run_route(route, lambda prog: 3.0))
    slower = run_route(route, lambda prog: 2.7)
    assert _final_gap(ghost, slower) < -5.0


def test_gap_is_monotonic_for_constant_speed_diff():
    # Con diferencia de velocidad constante, la ventaja debe crecer en el tiempo.
    route = make_route()
    ghost = Ghost(run_route(route, lambda prog: 3.0))
    faster = run_route(route, lambda prog: 3.3)
    engine = GapEngine(ghost)
    gaps = [engine.update(p.lat, p.lon, p.t).gap_seconds for p in faster]
    # Comparar inicio vs final (el suavizado puede meter ruido punto a punto).
    assert gaps[-1] > gaps[5] > -1.0


def test_off_route_detection():
    route = make_route()
    ghost = Ghost(run_route(route, lambda prog: 3.0))
    engine = GapEngine(ghost)
    # Un punto lejísimos de la ruta (otro barrio).
    r = engine.update(-34.55, -58.45, 10.0)
    assert r.is_off_route


def test_narrator_announces_sign_change():
    route = make_route()
    ghost = Ghost(run_route(route, lambda prog: 3.0))

    def runner_speed(prog: float) -> float:
        return 2.8 + 0.8 * prog  # empieza perdiendo, termina ganando

    runner = run_route(route, runner_speed)
    engine, narrator = GapEngine(ghost), Narrator()
    phrases = []
    for p in runner:
        ph = narrator.narrate(engine.update(p.lat, p.lon, p.t))
        if ph:
            phrases.append(ph)
    assert any("Pasaste al fantasma" in p for p in phrases)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} tests passed")
