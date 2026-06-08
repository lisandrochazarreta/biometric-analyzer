package com.lis.ghostgap;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.garmin.android.connectiq.ConnectIQ;
import com.garmin.android.connectiq.IQApp;
import com.garmin.android.connectiq.IQDevice;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Companion del data-field "Fantasma".
 *
 * Escucha los mensajes que manda el reloj ({"say": "Vas 9 segundos arriba"}) vía
 * el Connect IQ Mobile SDK y los dice por TextToSpeech. El audio sale por los
 * Ray-Ban Meta conectados como auriculares Bluetooth.
 *
 * El SDK de Garmin (connectiq.aar) NO está en Maven: descargalo del Connect IQ
 * Mobile SDK y agregalo como módulo/lib (ver README de companion-android).
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "GhostGap";
    // Debe coincidir con el id del manifest del data-field.
    private static final String APP_ID = "a3f1c2d4e5b647289a0c1d2e3f405162";

    private ConnectIQ mConnectIQ;
    private IQApp mApp;
    private TextToSpeech mTts;
    private TextView mStatus;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        mStatus = findViewById(R.id.status);

        mTts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                mTts.setLanguage(new Locale("es", "AR"));
            }
        });

        mApp = new IQApp(APP_ID);
        mConnectIQ = ConnectIQ.getInstance(this, ConnectIQ.IQConnectType.WIRELESS);
        mConnectIQ.initialize(this, true, new ConnectIQ.ConnectIQListener() {
            @Override public void onSdkReady() { registerDevices(); }
            @Override public void onInitializeError(ConnectIQ.IQSdkErrorStatus s) {
                setStatus("Error de SDK: " + s);
            }
            @Override public void onSdkShutDown() { }
        });
    }

    private void registerDevices() {
        try {
            List<IQDevice> devices = mConnectIQ.getKnownDevices();
            if (devices == null || devices.isEmpty()) {
                setStatus("Sin relojes Garmin emparejados");
                return;
            }
            for (IQDevice device : devices) {
                mConnectIQ.registerForAppEvents(device, mApp,
                    (dev, app, message, status) -> onWatchMessage(message));
            }
            setStatus("Escuchando al reloj… corré y hablo el gap.");
        } catch (Exception e) {
            setStatus("No se pudo registrar: " + e.getMessage());
        }
    }

    /** El reloj manda un dict {"say": "..."}, que acá llega como List<Map>. */
    private void onWatchMessage(List<Object> message) {
        if (message == null) { return; }
        for (Object item : message) {
            if (item instanceof Map) {
                Object phrase = ((Map<?, ?>) item).get("say");
                if (phrase != null) { speak(phrase.toString()); }
            }
        }
    }

    private void speak(String text) {
        Log.i(TAG, "speak: " + text);
        setStatus(text);
        if (mTts != null) {
            mTts.speak(text, TextToSpeech.QUEUE_ADD, null, "ghost");
        }
    }

    private void setStatus(String s) {
        runOnUiThread(() -> mStatus.setText(s));
    }

    @Override
    protected void onDestroy() {
        if (mTts != null) { mTts.shutdown(); }
        try { mConnectIQ.shutdown(this); } catch (Exception ignored) { }
        super.onDestroy();
    }
}
