"""Generador de tracks sintéticos para testear el motor sin salir a correr.

Construye una ruta ondulada y la "corre" con distintos perfiles de velocidad,
produciendo TrackPoints (y opcionalmente GPX) que alimentan ``GapEngine``.
"""
from __future__ import annotations

import math
from typing import Callable

from .geo import EARTH_R
from .track import TrackPoint

START_LAT, START_LON = -34.6037, -58.3816  # Buenos Aires, da igual


def make_route(steps: int = 250, step_len: float = 8.0) -> list[tuple[float, float]]:
    """Ruta ondulada de ~``steps*step_len`` metros como lista de (lat, lon)."""
    lat, lon = START_LAT, START_LON
    pts = [(lat, lon)]
    for i in range(steps):
        # Rumbo que ondula: prueba la proyección sobre curvas.
        bearing = math.radians(45 + 35 * math.sin(i / 18.0))
        dlat = (step_len * math.cos(bearing)) / EARTH_R
        dlon = (step_len * math.sin(bearing)) / (EARTH_R * math.cos(math.radians(lat)))
        lat += math.degrees(dlat)
        lon += math.degrees(dlon)
        pts.append((lat, lon))
    return pts


def _route_cumdist(route: list[tuple[float, float]]) -> list[float]:
    from .geo import haversine

    cum = [0.0]
    for i in range(1, len(route)):
        a, b = route[i - 1], route[i]
        cum.append(cum[-1] + haversine(a[0], a[1], b[0], b[1]))
    return cum


def _point_at(route, cum, d: float) -> tuple[float, float]:
    """Interpola (lat, lon) a la distancia ``d`` sobre la ruta."""
    from bisect import bisect_right

    if d <= 0:
        return route[0]
    if d >= cum[-1]:
        return route[-1]
    i = bisect_right(cum, d)
    d0, d1 = cum[i - 1], cum[i]
    frac = (d - d0) / (d1 - d0) if d1 > d0 else 0.0
    (la0, lo0), (la1, lo1) = route[i - 1], route[i]
    return la0 + frac * (la1 - la0), lo0 + frac * (lo1 - lo0)


def run_route(
    route: list[tuple[float, float]],
    speed_fn: Callable[[float], float],
    dt: float = 1.0,
    gps_noise: float = 0.0,
) -> list[TrackPoint]:
    """Corre la ruta a la velocidad ``speed_fn(progress)`` m/s, muestreando cada ``dt`` s.

    ``progress`` es la fracción [0,1] de ruta recorrida. ``gps_noise`` agrega
    jitter en grados (~1e-5 ≈ 1 m) para simular error de GPS.
    """
    import random

    cum = _route_cumdist(route)
    total = cum[-1]
    out: list[TrackPoint] = []
    d, t = 0.0, 0.0
    while d <= total:
        lat, lon = _point_at(route, cum, d)
        if gps_noise:
            lat += random.uniform(-gps_noise, gps_noise)
            lon += random.uniform(-gps_noise, gps_noise)
        out.append(TrackPoint(lat, lon, t))
        v = max(0.1, speed_fn(d / total))
        d += v * dt
        t += dt
    return out


def write_gpx(path: str, points: list[TrackPoint], start_iso: str = "2026-06-08T12:00:00Z") -> None:
    from datetime import datetime, timedelta, timezone

    t0 = datetime.fromisoformat(start_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="ghost.synth" xmlns="http://www.topografix.com/GPX/1/1">',
        "<trk><name>synthetic</name><trkseg>",
    ]
    for p in points:
        ts = (t0 + timedelta(seconds=p.t)).strftime("%Y-%m-%dT%H:%M:%SZ")
        lines.append(f'<trkpt lat="{p.lat:.7f}" lon="{p.lon:.7f}"><time>{ts}</time></trkpt>')
    lines += ["</trkseg></trk>", "</gpx>"]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
