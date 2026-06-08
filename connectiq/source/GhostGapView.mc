// GhostGapView — el data-field que ves en la muñeca durante la corrida.
//
// Cada segundo: toma el GPS del reloj, calcula el gap contra el fantasma, lo
// dibuja grande (verde = ganando, rojo = perdiendo) y, en los eventos clave,
// le manda la frase al celular para que la diga por voz.
using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Application;
using Toybox.Activity;

class GhostGapView extends WatchUi.DataField {

    private var mEngine;
    private var mNarrator;
    private var mPhone;
    private var mState;       // último dict de GapEngine.update, o null
    private var mReady;       // fantasma cargado ok

    function initialize() {
        DataField.initialize();
        mState = null;
        mReady = false;
        mPhone = new PhoneLink();
        mNarrator = new GhostModel.Narrator();
        try {
            var data = Application.loadResource(Rez.JsonData.GhostData);
            var ghost = new GhostModel.Ghost(data);
            mEngine = new GhostModel.GapEngine(ghost);
            mReady = true;
        } catch (e) {
            mReady = false;
        }
    }

    // Se llama ~1 Hz con los datos de la actividad.
    function compute(info) {
        if (!mReady) { return 0; }
        if (info.currentLocation == null) {
            return 0;  // todavía sin fix de GPS
        }
        var deg = info.currentLocation.toDegrees();   // [lat, lon] en grados
        var elapsedMs = (info.elapsedTime != null) ? info.elapsedTime : 0;
        var elapsedSec = elapsedMs / 1000.0;

        mState = mEngine.update(deg[0], deg[1], elapsedSec);

        var phrase = mNarrator.narrate(mState);
        if (phrase != null) {
            mPhone.say(phrase);
        }
        return mState["gap"];
    }

    function onUpdate(dc) {
        var bg = getBackgroundColor();
        var fg = (bg == Graphics.COLOR_BLACK) ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        dc.setColor(bg, bg);
        dc.clear();

        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        if (!mReady) {
            _center(dc, fg, "sin fantasma", Graphics.FONT_SMALL, cx, h / 2);
            return;
        }
        if (mState == null) {
            _center(dc, fg, "buscando GPS", Graphics.FONT_SMALL, cx, h / 2);
            return;
        }

        if (mState["isOffRoute"]) {
            dc.setColor(Graphics.COLOR_ORANGE, bg);
            _center(dc, Graphics.COLOR_ORANGE, "fuera de ruta", Graphics.FONT_SMALL, cx, h / 2);
            return;
        }

        var gap = mState["gap"];
        var color = fg;
        if (gap >= 2.0) { color = Graphics.COLOR_GREEN; }
        else if (gap <= -2.0) { color = Graphics.COLOR_RED; }

        var sign = (gap >= 0) ? "+" : "-";
        var txt = sign + GhostModel.fmtSecs(gap);

        // Etiqueta arriba, gap grande al medio.
        _center(dc, fg, "FANTASMA", Graphics.FONT_XTINY, cx, h / 2 - dc.getFontHeight(Graphics.FONT_NUMBER_MEDIUM) / 2 - 4);
        _center(dc, color, txt, Graphics.FONT_NUMBER_MEDIUM, cx, h / 2);
    }

    private function _center(dc, color, text, font, x, y) {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, font, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
