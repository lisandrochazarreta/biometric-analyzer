"""Exporta un fantasma (GPX de Garmin) al recurso JSON que carga el data-field.

El reloj tiene poca CPU/memoria, así que precomputamos todo lo posible acá:
  - coordenadas planas locales (x=este, y=norte, metros) para proyectar rápido
  - distancia acumulada y tiempo en cada punto
y downsampleamos la polilínea a un máximo de puntos.

    python -m ghost.export_ciq --gpx fantasma.gpx \
        --out connectiq/resources/data/ghost.json --name "10k del parque"

El JSON resultante lo levanta el data-field con Application.loadResource(Rez.JsonData.GhostData).
"""
from __future__ import annotations

import argparse
import json
import sys

from .geo import to_local_xy
from .track import Ghost, parse_gpx


def export(ghost: Ghost, name: str = "ghost", max_points: int = 400) -> dict:
    """Convierte un Ghost en el dict compacto que entiende el data-field."""
    lat0, lon0 = ghost.points[0].lat, ghost.points[0].lon
    n = len(ghost.points)
    # Paso mínimo de distancia para no pasarnos de max_points.
    min_step = max(3.0, ghost.total_distance / max(1, max_points - 1))

    pts: list[list[float]] = []
    last_cum = -1e9
    for i in range(n):
        cum = ghost._cum[i]
        keep = i == 0 or i == n - 1 or (cum - last_cum) >= min_step
        if not keep:
            continue
        x, y = to_local_xy(ghost.points[i].lat, ghost.points[i].lon, lat0, lon0)
        pts.append([round(x, 1), round(y, 1), round(cum, 1), round(ghost._elapsed[i], 1)])
        last_cum = cum

    return {
        "name": name,
        "lat0": round(lat0, 7),
        "lon0": round(lon0, 7),
        "totalDistance": round(ghost.total_distance, 1),
        "totalTime": round(ghost.total_time, 1),
        "pts": pts,
    }


def write_json(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))


def main() -> int:
    ap = argparse.ArgumentParser(description="Exporta un fantasma a recurso Connect IQ")
    ap.add_argument("--gpx", required=True, help="GPX de la corrida de referencia")
    ap.add_argument("--out", required=True, help="ruta del JSON de salida")
    ap.add_argument("--name", default="ghost", help="nombre a mostrar")
    ap.add_argument("--max-points", type=int, default=400)
    args = ap.parse_args()

    ghost = Ghost(parse_gpx(args.gpx))
    data = export(ghost, name=args.name, max_points=args.max_points)
    write_json(args.out, data)
    print(
        f"OK: {len(data['pts'])} puntos, {data['totalDistance']/1000:.2f} km, "
        f"{data['totalTime']:.0f}s -> {args.out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
