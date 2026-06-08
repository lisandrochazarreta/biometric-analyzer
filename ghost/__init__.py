"""ghost — corré contra tu propio fantasma.

Motor que compara tu corrida en vivo contra una corrida pasada (el 'fantasma')
y te dice cuántos segundos vas ganando o perdiendo, listo para narrarse por voz.
"""
from .gap import GapEngine, GapResult, Narrator
from .track import Ghost, TrackPoint, parse_gpx

__all__ = ["GapEngine", "GapResult", "Narrator", "Ghost", "TrackPoint", "parse_gpx"]
