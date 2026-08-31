"""Proveedores de WhatsApp: Twilio y la Cloud API de Meta.

Los dos hacen lo mismo desde el punto de vista del agente:
- parsean el webhook entrante a un `InboundMessage`,
- validan la firma del request,
- y mandan la respuesta por su API REST.

Se responde por API (no con TwiML) para no pelear con el timeout del webhook:
contestamos 200 enseguida y el mensaje sale cuando el agente terminó.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx

log = logging.getLogger(__name__)

TWILIO_MAX_CHARS = 1500
META_MAX_CHARS = 4000


@dataclass(frozen=True)
class InboundMessage:
    user_id: str          # E.164 sin prefijos, ej. +5491133334444
    text: str
    message_id: str
    reply_to: str         # a dónde contestar (formato del proveedor)
    kind: str = "text"    # text | unsupported


class WhatsAppProvider(Protocol):
    max_chars: int

    def parse(self, *, body: bytes, form: dict[str, str], json_body: Any) -> list[InboundMessage]: ...
    def verify(self, *, url: str, body: bytes, form: dict[str, str], headers: dict[str, str]) -> bool: ...
    def send(self, to: str, text: str) -> None: ...


def split_message(text: str, limit: int) -> list[str]:
    """Parte un texto largo en chunks que entren en un mensaje de WhatsApp."""
    text = text.strip()
    if len(text) <= limit:
        return [text] if text else []
    chunks: list[str] = []
    remaining = text
    while len(remaining) > limit:
        window = remaining[:limit]
        cut = max(window.rfind("\n"), window.rfind(". "))
        if cut < limit // 2:
            cut = window.rfind(" ")
        if cut <= 0:
            cut = limit
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


def normalize_number(raw: str) -> str:
    """'whatsapp:+5491133334444' -> '+5491133334444'; '54911...' -> '+54911...'."""
    n = (raw or "").strip()
    if n.startswith("whatsapp:"):
        n = n[len("whatsapp:"):]
    n = n.replace(" ", "").replace("-", "")
    if n and not n.startswith("+"):
        n = "+" + n
    return n


# ------------------------------------------------------------------- Twilio


class TwilioProvider:
    max_chars = TWILIO_MAX_CHARS

    def __init__(
        self,
        account_sid: str,
        auth_token: str,
        from_number: str,
        public_url: str | None = None,
        validate_signature: bool = True,
        timeout: float = 20.0,
    ) -> None:
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.from_number = from_number if from_number.startswith("whatsapp:") else f"whatsapp:{from_number}"
        self.public_url = public_url
        self.validate_signature = validate_signature
        self._client = httpx.Client(timeout=timeout, auth=(account_sid, auth_token))

    def parse(self, *, body: bytes, form: dict[str, str], json_body: Any) -> list[InboundMessage]:
        sender = form.get("From", "")
        if not sender:
            return []
        text = form.get("Body", "") or ""
        num_media = form.get("NumMedia", "0")
        kind = "text" if text or num_media in ("", "0") else "unsupported"
        return [
            InboundMessage(
                user_id=normalize_number(sender),
                text=text,
                message_id=form.get("MessageSid", "") or form.get("SmsMessageSid", ""),
                reply_to=sender,
                kind=kind,
            )
        ]

    def verify(self, *, url: str, body: bytes, form: dict[str, str], headers: dict[str, str]) -> bool:
        if not self.validate_signature:
            return True
        signature = headers.get("x-twilio-signature", "")
        if not signature:
            log.warning("request sin X-Twilio-Signature")
            return False
        expected = self.expected_signature(url, form)
        return hmac.compare_digest(expected, signature)

    def expected_signature(self, url: str, form: dict[str, str]) -> str:
        payload = url + "".join(f"{k}{form[k]}" for k in sorted(form))
        digest = hmac.new(
            self.auth_token.encode("utf-8"), payload.encode("utf-8"), hashlib.sha1
        ).digest()
        return base64.b64encode(digest).decode("ascii")

    def send(self, to: str, text: str) -> None:
        to = to if to.startswith("whatsapp:") else f"whatsapp:{normalize_number(to)}"
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json"
        for chunk in split_message(text, self.max_chars):
            try:
                r = self._client.post(
                    url,
                    content=urlencode({"From": self.from_number, "To": to, "Body": chunk}),
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                r.raise_for_status()
            except httpx.HTTPStatusError as e:
                log.error("Twilio rechazó el envío (%s): %s", e.response.status_code, e.response.text[:300])
            except httpx.HTTPError as e:
                log.error("no pude mandar por Twilio: %s", e)


# --------------------------------------------------------------- Meta Cloud


class MetaProvider:
    max_chars = META_MAX_CHARS

    def __init__(
        self,
        token: str,
        phone_number_id: str,
        verify_token: str | None = None,
        app_secret: str | None = None,
        api_version: str = "v22.0",
        timeout: float = 20.0,
    ) -> None:
        self.token = token
        self.phone_number_id = phone_number_id
        self.verify_token = verify_token
        self.app_secret = app_secret
        self.api_version = api_version
        self._client = httpx.Client(
            timeout=timeout, headers={"Authorization": f"Bearer {token}"}
        )

    def parse(self, *, body: bytes, form: dict[str, str], json_body: Any) -> list[InboundMessage]:
        out: list[InboundMessage] = []
        if not isinstance(json_body, dict):
            return out
        for entry in json_body.get("entry") or []:
            for change in (entry or {}).get("changes") or []:
                value = (change or {}).get("value") or {}
                for msg in value.get("messages") or []:
                    sender = msg.get("from", "")
                    if not sender:
                        continue
                    if msg.get("type") == "text":
                        text = ((msg.get("text") or {}).get("body")) or ""
                        kind = "text"
                    else:
                        text, kind = "", "unsupported"
                    out.append(
                        InboundMessage(
                            user_id=normalize_number(sender),
                            text=text,
                            message_id=msg.get("id", ""),
                            reply_to=sender,
                            kind=kind,
                        )
                    )
        return out

    def verify(self, *, url: str, body: bytes, form: dict[str, str], headers: dict[str, str]) -> bool:
        if not self.app_secret:
            return True  # sin app secret configurado no se puede validar
        header = headers.get("x-hub-signature-256", "")
        if not header.startswith("sha256="):
            log.warning("request sin X-Hub-Signature-256")
            return False
        expected = hmac.new(self.app_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, header[len("sha256="):])

    def challenge(self, params: dict[str, str]) -> str | None:
        """Responde el handshake de verificación del webhook de Meta."""
        if params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == self.verify_token:
            return params.get("hub.challenge")
        return None

    def send(self, to: str, text: str) -> None:
        url = f"https://graph.facebook.com/{self.api_version}/{self.phone_number_id}/messages"
        dest = normalize_number(to).lstrip("+")
        for chunk in split_message(text, self.max_chars):
            try:
                r = self._client.post(
                    url,
                    json={
                        "messaging_product": "whatsapp",
                        "recipient_type": "individual",
                        "to": dest,
                        "type": "text",
                        "text": {"preview_url": True, "body": chunk},
                    },
                )
                r.raise_for_status()
            except httpx.HTTPStatusError as e:
                log.error("Meta rechazó el envío (%s): %s", e.response.status_code, e.response.text[:300])
            except httpx.HTTPError as e:
                log.error("no pude mandar por Meta: %s", e)
