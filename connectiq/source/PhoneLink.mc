// PhoneLink — manda las frases a hablar a la companion app del celular.
//
// Usa Communications.transmit (Connect IQ Mobile SDK). La companion app Android
// recibe el dict {"say": "..."} y lo dice por TextToSpeech, que suena por los
// Ray-Ban Meta (auriculares Bluetooth).
using Toybox.Communications;
using Toybox.System;

class PhoneLink {
    private var mPending;   // cola simple por si llega otra frase mientras transmite
    private var mBusy;

    function initialize() {
        mPending = [];
        mBusy = false;
    }

    // Encola una frase para hablar en el celular.
    function say(phrase) {
        mPending.add(phrase);
        flush();
    }

    private function flush() {
        if (mBusy || mPending.size() == 0) { return; }
        mBusy = true;
        var phrase = mPending[0];
        mPending = mPending.slice(1, mPending.size());
        var payload = { "say" => phrase };
        Communications.transmit(payload, null, new TransmitListener(self));
    }

    function onComplete() {
        mBusy = false;
        flush();
    }

    function onError() {
        // No reintentamos frases viejas: en una carrera, el dato fresco manda.
        mBusy = false;
        mPending = [];
    }
}

class TransmitListener extends Communications.ConnectionListener {
    private var mOwner;

    function initialize(owner) {
        Communications.ConnectionListener.initialize();
        mOwner = owner;
    }

    function onComplete() {
        mOwner.onComplete();
    }

    function onError() {
        mOwner.onError();
    }
}
