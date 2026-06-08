// GhostModel — port a Monkey C del motor de gap (ver ghost/ en Python).
//
// La lógica es idéntica al motor Python testeado (ghost/geo.py, track.py,
// gap.py): proyección de la posición sobre la polilínea del fantasma, gap por
// distancia (segundos que el fantasma tardó en llegar a tu distancia actual
// menos tu tiempo), suavizado EMA, y un narrador que decide cuándo hablar.
//
// Convención: gap > 0 => vas GANANDO.

using Toybox.Math;
using Toybox.Lang;

module GhostModel {

    const EARTH_R = 6371000.0d;

    // ---- Geodesia -----------------------------------------------------------

    function projectPointToSegment(px, py, ax, ay, bx, by) {
        // Devuelve [t (0..1 sobre A->B), distPerpendicular].
        var abx = bx - ax;
        var aby = by - ay;
        var segLen2 = abx * abx + aby * aby;
        if (segLen2 == 0.0) {
            var dx0 = px - ax;
            var dy0 = py - ay;
            return [0.0, Math.sqrt(dx0 * dx0 + dy0 * dy0)];
        }
        var t = ((px - ax) * abx + (py - ay) * aby) / segLen2;
        if (t < 0.0) { t = 0.0; }
        if (t > 1.0) { t = 1.0; }
        var fx = ax + t * abx;
        var fy = ay + t * aby;
        var dx = px - fx;
        var dy = py - fy;
        return [t, Math.sqrt(dx * dx + dy * dy)];
    }

    // ---- Fantasma -----------------------------------------------------------

    class Ghost {
        public var totalDistance;
        public var totalTime;
        private var mLat0, mLon0;
        private var mXs, mYs, mCum, mElapsed, mN;

        // data: el dict cargado de Rez.JsonData.GhostData
        function initialize(data) {
            mLat0 = data["lat0"].toDouble();
            mLon0 = data["lon0"].toDouble();
            totalDistance = data["totalDistance"].toDouble();
            totalTime = data["totalTime"].toDouble();
            var pts = data["pts"];
            mN = pts.size();
            mXs = new [mN];
            mYs = new [mN];
            mCum = new [mN];
            mElapsed = new [mN];
            for (var i = 0; i < mN; i++) {
                var p = pts[i];
                mXs[i] = p[0].toDouble();
                mYs[i] = p[1].toDouble();
                mCum[i] = p[2].toDouble();
                mElapsed[i] = p[3].toDouble();
            }
        }

        function size() { return mN; }

        function toLocalXY(lat, lon) {
            var x = EARTH_R * (lon - mLon0) * Math.PI / 180.0 * Math.cos(mLat0 * Math.PI / 180.0);
            var y = EARTH_R * (lat - mLat0) * Math.PI / 180.0;
            return [x, y];
        }

        function timeAtDistance(d) {
            if (d <= mCum[0]) { return mElapsed[0]; }
            if (d >= mCum[mN - 1]) { return mElapsed[mN - 1]; }
            // Búsqueda binaria: cum[lo] <= d < cum[hi].
            var lo = 0;
            var hi = mN - 1;
            while (hi - lo > 1) {
                var mid = (lo + hi) / 2;
                if (mCum[mid] <= d) { lo = mid; } else { hi = mid; }
            }
            var d0 = mCum[lo];
            var d1 = mCum[hi];
            var frac = (d1 > d0) ? (d - d0) / (d1 - d0) : 0.0;
            return mElapsed[lo] + frac * (mElapsed[hi] - mElapsed[lo]);
        }

        // Devuelve [distAlong, offRoute, segIndex].
        function project(lat, lon, hint) {
            var xy = toLocalXY(lat, lon);
            var px = xy[0];
            var py = xy[1];

            var lo = hint - 2;
            if (lo < 0) { lo = 0; }
            var hi = hint + 40;
            if (hi > mN - 1) { hi = mN - 1; }
            var best = scanSegments(px, py, lo, hi);
            if (best[1] > 50.0) {
                var full = scanSegments(px, py, 0, mN - 1);
                if (full[1] < best[1]) { best = full; }
            }

            var seg = best[0];
            var t = best[2];
            var distAlong = mCum[seg] + t * (mCum[seg + 1] - mCum[seg]);
            return [distAlong, best[1], seg];
        }

        // Mejor segmento en [lo, hi). Devuelve [segIndex, off, t].
        private function scanSegments(px, py, lo, hi) {
            var bestI = lo;
            var bestOff = 1.0e12;
            var bestT = 0.0;
            for (var i = lo; i < hi; i++) {
                var r = projectPointToSegment(px, py, mXs[i], mYs[i], mXs[i + 1], mYs[i + 1]);
                if (r[1] < bestOff) {
                    bestI = i;
                    bestOff = r[1];
                    bestT = r[0];
                }
            }
            return [bestI, bestOff, bestT];
        }
    }

    // ---- Motor de gap -------------------------------------------------------

    class GapEngine {
        private var mGhost;
        private var mOffThresh;
        private var mSmoothing;
        private var mHint;
        private var mGapEma;       // null hasta la primera muestra

        function initialize(ghost) {
            mGhost = ghost;
            mOffThresh = 25.0;
            mSmoothing = 0.4;
            mHint = 0;
            mGapEma = null;
        }

        // runnerElapsed en segundos. Devuelve un dict con el estado de la carrera.
        function update(lat, lon, runnerElapsed) {
            var proj = mGhost.project(lat, lon, mHint);
            var distAlong = proj[0];
            var offRoute = proj[1];
            mHint = proj[2];

            var ghostTime = mGhost.timeAtDistance(distAlong);
            var rawGap = ghostTime - runnerElapsed;
            if (mGapEma == null) {
                mGapEma = rawGap;
            } else {
                mGapEma = mSmoothing * mGapEma + (1.0 - mSmoothing) * rawGap;
            }

            var total = mGhost.totalDistance;
            var progress = (total > 0) ? distAlong / total : 0.0;
            if (progress > 1.0) { progress = 1.0; }

            return {
                "gap" => mGapEma,
                "distAlong" => distAlong,
                "offRoute" => offRoute,
                "isOffRoute" => offRoute > mOffThresh,
                "ghostTime" => ghostTime,
                "runnerTime" => runnerElapsed,
                "progress" => progress,
                "finished" => progress >= 0.999
            };
        }
    }

    // ---- Narrador (qué decir por voz, cuándo) --------------------------------

    function fmtSecs(gap) {
        var s = (gap < 0 ? -gap : gap) + 0.5;
        var si = s.toNumber();
        if (si < 60) {
            return si.toString() + (si == 1 ? " segundo" : " segundos");
        }
        var m = si / 60;
        var r = si % 60;
        var rs = (r < 10) ? "0" + r.toString() : r.toString();
        return m.toString() + ":" + rs + " minutos";
    }

    class Narrator {
        private var mStep;
        private var mSummaryM;
        private var mDeadband;
        private var mLastSpokenGap;   // null
        private var mLastSign;        // null / -1 / 0 / 1
        private var mNextSummary;
        private var mWasOffRoute;
        private var mFinishedSpoken;

        function initialize() {
            mStep = 5.0;
            mSummaryM = 1000.0;
            mDeadband = 2.0;
            mLastSpokenGap = null;
            mLastSign = null;
            mNextSummary = mSummaryM;
            mWasOffRoute = false;
            mFinishedSpoken = false;
        }

        // Devuelve la frase a hablar (String) o null si no toca.
        function narrate(r) {
            var gap = r["gap"];

            if (r["isOffRoute"] && !mWasOffRoute) {
                mWasOffRoute = true;
                return "Te saliste de la ruta del fantasma.";
            }
            if (!r["isOffRoute"] && mWasOffRoute) {
                mWasOffRoute = false;
                mLastSpokenGap = gap;
                return "Volviste a la ruta.";
            }
            if (r["isOffRoute"]) { return null; }

            if (r["finished"]) {
                if (mFinishedSpoken) { return null; }
                mFinishedSpoken = true;
                var verb = (gap >= 0) ? "Le ganaste al fantasma por " : "El fantasma te ganó por ";
                return "Llegada. " + verb + fmtSecs(gap) + ".";
            }

            var inBand = (gap < 0 ? -gap : gap) < mDeadband;
            var sign = inBand ? 0 : (gap > 0 ? 1 : -1);
            var estado = (sign > 0) ? "arriba" : "abajo";
            var msg = null;

            if (sign != 0 && mLastSign != null && mLastSign != 0 && mLastSign != sign) {
                msg = (sign > 0)
                    ? "Pasaste al fantasma, vas " + fmtSecs(gap) + " arriba."
                    : "Te pasó el fantasma, vas " + fmtSecs(gap) + " abajo.";
            } else if (r["distAlong"] >= mNextSummary) {
                var km = (mNextSummary / 1000).toNumber();
                mNextSummary += mSummaryM;
                var cola = (sign == 0)
                    ? "vas parejo con el fantasma"
                    : "vas " + fmtSecs(gap) + " " + estado;
                // Capitalizar primera letra de la cola.
                cola = cola.substring(0, 1).toUpper() + cola.substring(1, cola.length());
                msg = "Kilómetro " + km.toString() + ". " + cola + ".";
            } else if (!inBand &&
                       (mLastSpokenGap == null ||
                        (gap - mLastSpokenGap < 0 ? mLastSpokenGap - gap : gap - mLastSpokenGap) >= mStep)) {
                msg = "Vas " + fmtSecs(gap) + " " + estado + ".";
            }

            if (sign != 0) { mLastSign = sign; }
            if (msg != null) { mLastSpokenGap = gap; }
            return msg;
        }
    }
}
