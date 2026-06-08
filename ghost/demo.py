"""Demo end-to-end sin archivos: genera fantasma + corrida y muestra la carrera.

El fantasma corre parejo. Vos arrancás más lento (vas perdiendo), después
apretás y lo pasás sobre el final. Imprime lo que sonaría por los anteojos.

    python -m ghost.demo
"""
from __future__ import annotations

from .replay import _clock, replay
from .synth import make_route, run_route
from .track import Ghost


def main() -> int:
    route = make_route()

    # Fantasma: 3.0 m/s parejo (~5:33 / km).
    ghost_track = run_route(route, lambda prog: 3.0)
    ghost = Ghost(ghost_track)

    # Vos: arrancás a 2.85 (perdiendo) y acelerás hasta 3.4 (ganando) -> hay cruce.
    def runner_speed(prog: float) -> float:
        return 2.85 + 0.75 * prog

    runner = run_route(route, runner_speed, gps_noise=1.2e-5)

    print(f"Fantasma: {ghost.total_distance/1000:.2f} km en {_clock(ghost.total_time)} "
          f"({ghost.total_time/ (ghost.total_distance/1000):.0f} s/km)\n")
    print("Carrera (🔊 = lo que sonaría en los Ray-Ban):\n")
    final = replay(ghost, runner, every=15)

    print()
    if final.gap_seconds >= 0:
        print(f"🏁 Le ganaste a tu fantasma por {abs(final.gap_seconds):.1f}s")
    else:
        print(f"🏁 Tu fantasma te ganó por {abs(final.gap_seconds):.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
