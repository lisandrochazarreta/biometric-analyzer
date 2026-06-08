"""Geodesia mínima: distancias y proyección punto→ruta en metros locales.

Para distancias de running (pocos km) alcanza con haversine para medir largo de
ruta y una proyección equirectangular local (plano tangente) para proyectar la
posición del corredor sobre la polilínea del fantasma. El error de la
aproximación plana es despreciable en estas escalas.
"""
from __future__ import annotations

import math

EARTH_R = 6_371_000.0  # radio medio terrestre, metros


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia sobre la esfera entre dos puntos (lat/lon en grados), en metros."""
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(a)))


def to_local_xy(lat: float, lon: float, lat0: float, lon0: float) -> tuple[float, float]:
    """Proyecta lat/lon a metros locales (x=este, y=norte) respecto de un origen.

    Equirectangular alrededor de ``lat0``. Suficiente para proyectar sobre la ruta.
    """
    x = EARTH_R * math.radians(lon - lon0) * math.cos(math.radians(lat0))
    y = EARTH_R * math.radians(lat - lat0)
    return x, y


def project_point_to_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> tuple[float, float]:
    """Proyecta P sobre el segmento A→B (coords planas en metros).

    Devuelve ``(t, dist)`` donde ``t`` ∈ [0,1] es la fracción a lo largo de A→B
    del pie de la proyección, y ``dist`` es la distancia perpendicular de P al
    segmento (metros).
    """
    abx, aby = bx - ax, by - ay
    seg_len2 = abx * abx + aby * aby
    if seg_len2 == 0.0:
        # Segmento degenerado: A y B coinciden.
        return 0.0, math.hypot(px - ax, py - ay)
    t = ((px - ax) * abx + (py - ay) * aby) / seg_len2
    t = max(0.0, min(1.0, t))
    fx, fy = ax + t * abx, ay + t * aby
    return t, math.hypot(px - fx, py - fy)
