"""Modelo de track y carga de GPX.

Un ``Ghost`` es una corrida pasada convertida en dos funciones útiles:
  - ``time_at_distance(d)``: a qué segundo el fantasma alcanzó la distancia ``d``.
  - ``project(lat, lon)``: dónde estás vos sobre la ruta del fantasma (distancia
    recorrida + cuán lejos de la ruta estás).

Con eso, el gap por distancia es trivial: en el punto de la ruta donde estás vos
ahora, ¿cuánto tardó el fantasma en llegar comparado con vos?
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from bisect import bisect_right
from dataclasses import dataclass

from .geo import haversine, project_point_to_segment, to_local_xy


@dataclass(frozen=True)
class TrackPoint:
    lat: float
    lon: float
    t: float  # segundos desde el inicio del track


@dataclass(frozen=True)
class Projection:
    dist_along: float  # metros recorridos sobre la ruta hasta el pie de proyección
    off_route: float   # distancia perpendicular a la ruta, metros
    seg_index: int     # índice de segmento donde cayó la proyección


def _gpx_local_name(tag: str) -> str:
    """Quita el namespace de un tag XML ('{...}trkpt' -> 'trkpt')."""
    return tag.rsplit("}", 1)[-1]


def parse_gpx(path: str) -> list[TrackPoint]:
    """Parsea un GPX y devuelve TrackPoints con tiempo relativo (segundos).

    Requiere que cada ``<trkpt>`` tenga ``<time>`` ISO-8601. Es lo que exporta
    Garmin Connect para una actividad.
    """
    root = ET.parse(path).getroot()
    pts: list[tuple[float, float, float]] = []  # lat, lon, epoch_seconds
    for el in root.iter():
        if _gpx_local_name(el.tag) != "trkpt":
            continue
        lat = float(el.attrib["lat"])
        lon = float(el.attrib["lon"])
        epoch = None
        for child in el:
            if _gpx_local_name(child.tag) == "time" and child.text:
                epoch = _iso_to_epoch(child.text.strip())
        if epoch is None:
            raise ValueError(f"trkpt sin <time> en {path}; el fantasma necesita tiempos")
        pts.append((lat, lon, epoch))
    if not pts:
        raise ValueError(f"no se encontraron trkpt en {path}")
    t0 = pts[0][2]
    return [TrackPoint(lat, lon, epoch - t0) for lat, lon, epoch in pts]


def _iso_to_epoch(s: str) -> float:
    from datetime import datetime, timezone

    # Soporta sufijo 'Z' y offsets explícitos.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


class Ghost:
    """Fantasma: una corrida de referencia sobre la que se compara en vivo."""

    def __init__(self, points: list[TrackPoint]):
        if len(points) < 2:
            raise ValueError("el fantasma necesita al menos 2 puntos")
        self.points = points
        lat0, lon0 = points[0].lat, points[0].lon
        # Coordenadas planas locales para proyección.
        self._xy = [to_local_xy(p.lat, p.lon, lat0, lon0) for p in points]
        # Distancia acumulada (haversine, más preciso que el plano) y tiempo.
        self._cum: list[float] = [0.0]
        self._elapsed: list[float] = [points[0].t]
        for i in range(1, len(points)):
            a, b = points[i - 1], points[i]
            self._cum.append(self._cum[-1] + haversine(a.lat, a.lon, b.lat, b.lon))
            self._elapsed.append(b.t)

    @property
    def total_distance(self) -> float:
        return self._cum[-1]

    @property
    def total_time(self) -> float:
        return self._elapsed[-1]

    def time_at_distance(self, d: float) -> float:
        """Segundos que tardó el fantasma en llegar a la distancia ``d`` (interp lineal)."""
        cum = self._cum
        if d <= cum[0]:
            return self._elapsed[0]
        if d >= cum[-1]:
            return self._elapsed[-1]
        i = bisect_right(cum, d)  # cum[i-1] <= d < cum[i]
        d0, d1 = cum[i - 1], cum[i]
        t0, t1 = self._elapsed[i - 1], self._elapsed[i]
        frac = (d - d0) / (d1 - d0) if d1 > d0 else 0.0
        return t0 + frac * (t1 - t0)

    def project(self, lat: float, lon: float, hint: int = 0, window: int = 40) -> Projection:
        """Proyecta una posición sobre la ruta del fantasma.

        Busca el segmento más cercano en una ventana alrededor de ``hint`` (el
        último índice conocido) para ser eficiente y evitar "saltar" a tramos
        lejanos cuando la ruta se cruza consigo misma. Si la mejor distancia
        encontrada es grande, hace un barrido completo como respaldo.
        """
        lat0, lon0 = self.points[0].lat, self.points[0].lon
        px, py = to_local_xy(lat, lon, lat0, lon0)

        best = self._scan_segments(px, py, max(0, hint - 2), min(len(self._xy) - 1, hint + window))
        # Respaldo: si quedó lejos, puede que el hint estuviera desfasado.
        if best[1] > 50.0:
            full = self._scan_segments(px, py, 0, len(self._xy) - 1)
            if full[1] < best[1]:
                best = full

        seg_index, off, t = best
        dist_along = self._cum[seg_index] + t * (self._cum[seg_index + 1] - self._cum[seg_index])
        return Projection(dist_along=dist_along, off_route=off, seg_index=seg_index)

    def _scan_segments(self, px: float, py: float, lo: int, hi: int) -> tuple[int, float, float]:
        """Mejor segmento en [lo, hi). Devuelve (seg_index, off_dist, t)."""
        best_i, best_off, best_t = lo, float("inf"), 0.0
        for i in range(lo, hi):
            ax, ay = self._xy[i]
            bx, by = self._xy[i + 1]
            t, off = project_point_to_segment(px, py, ax, ay, bx, by)
            if off < best_off:
                best_i, best_off, best_t = i, off, t
        return best_i, best_off, best_t
