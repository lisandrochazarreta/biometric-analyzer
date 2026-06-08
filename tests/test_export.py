"""Tests del exportador a recurso Connect IQ."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ghost.export_ciq import export  # noqa: E402
from ghost.synth import make_route, run_route  # noqa: E402
from ghost.track import Ghost  # noqa: E402


def _ghost() -> Ghost:
    return Ghost(run_route(make_route(), lambda prog: 3.0))


def test_export_shape_and_keys():
    d = export(_ghost(), name="x")
    assert d["name"] == "x"
    for k in ("lat0", "lon0", "totalDistance", "totalTime", "pts"):
        assert k in d
    assert len(d["pts"][0]) == 4  # [x, y, cum, t]


def test_export_respects_max_points():
    d = export(_ghost(), max_points=50)
    assert len(d["pts"]) <= 50


def test_export_keeps_endpoints_and_is_monotonic():
    g = _ghost()
    d = export(g, max_points=80)
    pts = d["pts"]
    # primer y último punto preservados
    assert pts[0][2] == 0.0
    assert abs(pts[-1][2] - g.total_distance) < 1.0
    # distancia y tiempo acumulados monótonos
    for i in range(1, len(pts)):
        assert pts[i][2] >= pts[i - 1][2]
        assert pts[i][3] >= pts[i - 1][3]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} tests passed")
