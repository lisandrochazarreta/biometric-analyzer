// Entry point del data-field.
using Toybox.Application;
using Toybox.WatchUi;

class GhostGapApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() {
        return [ new GhostGapView() ];
    }
}
