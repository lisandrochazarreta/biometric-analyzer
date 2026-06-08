"""Motor de gap + narración.

``GapEngine`` toma la posición/tiempo del corredor en vivo y devuelve cuántos
segundos va ganando o perdiendo contra el fantasma. ``Narrator`` decide *cuándo*
vale la pena decir algo por voz (los Ray-Ban como auriculares BT), para no
saturar con un número cada segundo.

Convención de signo: ``gap_seconds > 0`` = vas GANANDO (llegaste a este punto
de la ruta antes que el fantasma).
"""
from __future__ import annotations

from dataclasses import dataclass

from .track import Ghost


@dataclass(frozen=True)
class GapResult:
    gap_seconds: float      # >0 ganando, <0 perdiendo (segundos sobre el fantasma)
    dist_along: float       # metros recorridos sobre la ruta
    off_route: float        # distancia a la ruta, metros
    is_off_route: bool
    ghost_time: float       # seg que tardó el fantasma hasta dist_along
    runner_time: float      # seg que llevás vos
    progress: float         # fracción [0,1] de la ruta completada
    finished: bool


class GapEngine:
    """Calcula el gap contra el fantasma a partir de muestras GPS en vivo."""

    def __init__(self, ghost: Ghost, off_route_threshold: float = 25.0, smoothing: float = 0.4):
        self.ghost = ghost
        self.off_route_threshold = off_route_threshold
        self.smoothing = smoothing  # EMA: 0 = sin suavizado, 1 = congelado
        self._hint = 0
        self._gap_ema: float | None = None

    def update(self, lat: float, lon: float, runner_elapsed: float) -> GapResult:
        """Procesa una muestra (posición + segundos desde la largada)."""
        proj = self.ghost.project(lat, lon, hint=self._hint)
        self._hint = proj.seg_index

        ghost_time = self.ghost.time_at_distance(proj.dist_along)
        raw_gap = ghost_time - runner_elapsed

        # Suavizado exponencial para que la voz no oscile por ruido de GPS.
        if self._gap_ema is None:
            self._gap_ema = raw_gap
        else:
            a = self.smoothing
            self._gap_ema = a * self._gap_ema + (1 - a) * raw_gap

        total = self.ghost.total_distance
        progress = min(1.0, proj.dist_along / total) if total > 0 else 0.0
        return GapResult(
            gap_seconds=self._gap_ema,
            dist_along=proj.dist_along,
            off_route=proj.off_route,
            is_off_route=proj.off_route > self.off_route_threshold,
            ghost_time=ghost_time,
            runner_time=runner_elapsed,
            progress=progress,
            finished=progress >= 0.999,
        )


def _fmt_secs(gap: float) -> str:
    s = int(round(abs(gap)))
    if s < 60:
        return f"{s} segundo" + ("s" if s != 1 else "")
    m, s = divmod(s, 60)
    return f"{m}:{s:02d} minutos"


class Narrator:
    """Decide cuándo hablar. Devuelve una frase (es-AR) o ``None`` si no toca.

    Reglas:
      * Cambio de signo (te pasó / lo pasaste) -> siempre avisa.
      * El gap se mueve >= ``step`` segundos respecto del último anuncio.
      * Entrás/salís de ruta.
      * Resumen cada ``summary_km`` km.
    """

    def __init__(self, step: float = 5.0, summary_km: float = 1.0, deadband: float = 2.0):
        self.step = step
        self.summary_m = summary_km * 1000.0
        self.deadband = deadband  # |gap| < deadband => "empate", no anuncia cruces ni jitter
        self._last_spoken_gap: float | None = None
        self._last_sign: int | None = None  # -1/0/+1; 0 = dentro de la banda muerta
        self._next_summary = self.summary_m
        self._was_off_route = False
        self._finished_spoken = False

    def narrate(self, r: GapResult) -> str | None:
        # Fuera de ruta: avisar al entrar y al volver.
        if r.is_off_route and not self._was_off_route:
            self._was_off_route = True
            return "Te saliste de la ruta del fantasma."
        if not r.is_off_route and self._was_off_route:
            self._was_off_route = False
            self._last_spoken_gap = r.gap_seconds
            return "Volviste a la ruta."
        if r.is_off_route:
            return None

        if r.finished:
            if self._finished_spoken:
                return None
            self._finished_spoken = True
            verb = "Le ganaste al fantasma por" if r.gap_seconds >= 0 else "El fantasma te ganó por"
            return f"Llegada. {verb} {_fmt_secs(r.gap_seconds)}."

        # Banda muerta: cerca de cero lo tratamos como empate (sign 0) para no
        # parpadear "te pasó / lo pasaste" con el ruido del GPS.
        in_band = abs(r.gap_seconds) < self.deadband
        sign = 0 if in_band else (1 if r.gap_seconds > 0 else -1)
        estado = {1: "arriba", -1: "abajo", 0: "parejo"}[sign]
        msg: str | None = None

        # Cruce real: de ganar a perder (o viceversa), saliendo de la banda muerta.
        if sign != 0 and self._last_sign not in (None, 0, sign):
            msg = (
                f"Pasaste al fantasma, vas {_fmt_secs(r.gap_seconds)} arriba."
                if sign > 0
                else f"Te pasó el fantasma, vas {_fmt_secs(r.gap_seconds)} abajo."
            )
        # Resumen cada km (siempre, aunque vayas parejo).
        elif r.dist_along >= self._next_summary:
            km = int(self._next_summary // 1000)
            self._next_summary += self.summary_m
            cola = "vas parejo con el fantasma" if sign == 0 else f"vas {_fmt_secs(r.gap_seconds)} {estado}"
            msg = f"Kilómetro {km}. {cola.capitalize()}."
        # Movimiento significativo del gap (solo fuera de la banda muerta).
        elif not in_band and (
            self._last_spoken_gap is None or abs(r.gap_seconds - self._last_spoken_gap) >= self.step
        ):
            msg = f"Vas {_fmt_secs(r.gap_seconds)} {estado}."

        # Solo registramos signo fuera de la banda, así el cruce se detecta una vez.
        if sign != 0:
            self._last_sign = sign
        if msg is not None:
            self._last_spoken_gap = r.gap_seconds
        return msg
