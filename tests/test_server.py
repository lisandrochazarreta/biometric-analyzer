"""Smoke tests del webhook con TestClient (sin red, sin Claude)."""
from __future__ import annotations

import os
import tempfile
import unittest

_TMP = tempfile.TemporaryDirectory()
os.environ.update(
    {
        "WHATSAPP_PROVIDER": "twilio",
        "TWILIO_ACCOUNT_SID": "ACtest",
        "TWILIO_AUTH_TOKEN": "12345",
        "TWILIO_WHATSAPP_FROM": "+14155238886",
        "PUBLIC_URL": "https://midominio.ngrok.app",
        "ALLOWED_NUMBERS": "+5491133334444",
        "CARRITO_DB": os.path.join(_TMP.name, "db.sqlite"),
        "ANTHROPIC_API_KEY": "sk-ant-dummy-para-tests",
    }
)

from fastapi.testclient import TestClient  # noqa: E402

from carrito.server import app  # noqa: E402
from carrito.whatsapp import TwilioProvider  # noqa: E402

def form(sid: str, **overrides) -> dict[str, str]:
    """Cada test usa su propio MessageSid: el dedupe vive en la misma DB."""
    base = {
        "From": "whatsapp:+5491133334444",
        "Body": "quiero leche",
        "MessageSid": sid,
        "NumMedia": "0",
    }
    base.update(overrides)
    return base


def _signature(form: dict[str, str]) -> str:
    return TwilioProvider("ACtest", "12345", "+1").expected_signature(
        "https://midominio.ngrok.app/webhook/twilio", form
    )


class _FakeAgent:
    def __init__(self):
        self.seen: list[tuple[str, str]] = []

    def handle(self, user_id: str, text: str) -> str:
        self.seen.append((user_id, text))
        return "respuesta de prueba"


class TestWebhook(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.__enter__()  # dispara el lifespan
        self.agent = _FakeAgent()
        app.state.agent = self.agent
        self.sent: list[tuple[str, str]] = []
        app.state.provider.send = lambda to, text: self.sent.append((to, text))

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_health(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

    def test_mensaje_valido_llega_al_agente_y_se_responde(self):
        f = form("SM-valido")
        r = self.client.post(
            "/webhook/twilio", data=f, headers={"X-Twilio-Signature": _signature(f)}
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.agent.seen, [("+5491133334444", "quiero leche")])
        self.assertEqual(self.sent, [("whatsapp:+5491133334444", "respuesta de prueba")])

    def test_firma_invalida_da_403(self):
        r = self.client.post(
            "/webhook/twilio", data=form("SM-mala"), headers={"X-Twilio-Signature": "mala"}
        )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.agent.seen, [])

    def test_numero_no_autorizado_se_ignora(self):
        f = form("SM-ajeno", **{"From": "whatsapp:+5491199998888"})
        r = self.client.post(
            "/webhook/twilio", data=f, headers={"X-Twilio-Signature": _signature(f)}
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.agent.seen, [])

    def test_mensaje_duplicado_se_procesa_una_sola_vez(self):
        f = form("SM-repetido")
        headers = {"X-Twilio-Signature": _signature(f)}
        self.client.post("/webhook/twilio", data=f, headers=headers)
        self.client.post("/webhook/twilio", data=f, headers=headers)
        self.assertEqual(len(self.agent.seen), 1)

    def test_audio_responde_que_solo_entiende_texto(self):
        f = form("SM-audio", Body="", NumMedia="1")
        self.client.post(
            "/webhook/twilio", data=f, headers={"X-Twilio-Signature": _signature(f)}
        )
        self.assertEqual(self.agent.seen, [])
        self.assertIn("solo entiendo texto", self.sent[0][1])

    def test_get_meta_con_proveedor_twilio_da_404(self):
        self.assertEqual(self.client.get("/webhook/meta").status_code, 404)


if __name__ == "__main__":
    unittest.main()
