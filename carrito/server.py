"""Webhook de WhatsApp.

Contesta 200 al toque y procesa el mensaje en background: armar un carrito
puede tardar varios segundos y tanto Twilio como Meta reintentan si el webhook
no responde rápido.

    uvicorn carrito.server:app --port 8000
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import BackgroundTasks, FastAPI, Request, Response

from . import config
from .agent import ShoppingAgent
from .storage import Storage
from .whatsapp import InboundMessage, MetaProvider, TwilioProvider

log = logging.getLogger("carrito.server")

UNSUPPORTED_REPLY = (
    "Por ahora solo entiendo texto. Escribime qué querés comprar, "
    "por ejemplo: 'leche, pan y 2 kg de papa'."
)


def build_provider(cfg: config.Config):
    if cfg.provider == "twilio":
        missing = [
            n for n, v in (
                ("TWILIO_ACCOUNT_SID", cfg.twilio_account_sid),
                ("TWILIO_AUTH_TOKEN", cfg.twilio_auth_token),
                ("TWILIO_WHATSAPP_FROM", cfg.twilio_from),
            ) if not v
        ]
        if missing:
            raise RuntimeError(f"faltan variables de entorno para Twilio: {', '.join(missing)}")
        return TwilioProvider(
            account_sid=cfg.twilio_account_sid,
            auth_token=cfg.twilio_auth_token,
            from_number=cfg.twilio_from,
            public_url=cfg.public_url,
            validate_signature=cfg.validate_twilio_signature,
            timeout=cfg.http_timeout,
        )
    if cfg.provider == "meta":
        missing = [
            n for n, v in (
                ("META_TOKEN", cfg.meta_token),
                ("META_PHONE_NUMBER_ID", cfg.meta_phone_number_id),
            ) if not v
        ]
        if missing:
            raise RuntimeError(f"faltan variables de entorno para Meta: {', '.join(missing)}")
        return MetaProvider(
            token=cfg.meta_token,
            phone_number_id=cfg.meta_phone_number_id,
            verify_token=cfg.meta_verify_token,
            app_secret=cfg.meta_app_secret,
            api_version=cfg.meta_api_version,
            timeout=cfg.http_timeout,
        )
    raise RuntimeError(f"WHATSAPP_PROVIDER desconocido: {cfg.provider!r} (usá 'twilio' o 'meta')")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    cfg = config.load()
    app.state.cfg = cfg
    app.state.storage = Storage(cfg.db_path)
    app.state.agent = ShoppingAgent(cfg, app.state.storage)
    app.state.provider = build_provider(cfg)
    if not cfg.allowed_numbers:
        log.warning(
            "ALLOWED_NUMBERS está vacío: voy a rechazar todos los mensajes. "
            "Mandá un mensaje al bot y copiá el número que loguee acá abajo a .env."
        )
    log.info(
        "listo. proveedor=%s tienda por defecto=%s números habilitados=%d",
        cfg.provider, cfg.default_store, len(cfg.allowed_numbers),
    )
    try:
        yield
    finally:
        app.state.storage.close()


app = FastAPI(title="Agente de carrito por WhatsApp", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    cfg: config.Config = app.state.cfg
    return {"ok": True, "provider": cfg.provider, "default_store": cfg.default_store}


def _process(msg: InboundMessage) -> None:
    """Corre en background: genera la respuesta y la manda por el proveedor."""
    cfg: config.Config = app.state.cfg
    provider = app.state.provider
    try:
        if msg.kind != "text":
            provider.send(msg.reply_to, UNSUPPORTED_REPLY)
            return
        reply = app.state.agent.handle(msg.user_id, msg.text)
        provider.send(msg.reply_to, reply)
    except Exception:  # noqa: BLE001
        log.exception("falló el procesamiento del mensaje de %s", msg.user_id)
        try:
            provider.send(
                msg.reply_to,
                "Se me rompió algo procesando eso. Probá de nuevo en un minuto.",
            )
        except Exception:  # noqa: BLE001
            log.exception("tampoco pude avisar del error")


async def _handle_webhook(request: Request, tasks: BackgroundTasks) -> Response:
    cfg: config.Config = app.state.cfg
    provider = app.state.provider
    storage: Storage = app.state.storage

    body = await request.body()
    form: dict[str, str] = {}
    json_body: Any = None
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            json_body = await request.json()
        except ValueError:
            json_body = None
    else:
        json_body = None
        form = {k: v for k, v in (await request.form()).multi_items() if isinstance(v, str)}

    url = cfg.public_url.rstrip("/") + request.url.path if cfg.public_url else str(request.url)
    headers = {k.lower(): v for k, v in request.headers.items()}
    if not provider.verify(url=url, body=body, form=form, headers=headers):
        log.warning("firma inválida en %s", url)
        return Response(status_code=403)

    for msg in provider.parse(body=body, form=form, json_body=json_body):
        if cfg.allowed_numbers and msg.user_id not in cfg.allowed_numbers:
            log.warning("número no autorizado: %s (agregalo a ALLOWED_NUMBERS)", msg.user_id)
            continue
        if not cfg.allowed_numbers:
            log.warning("mensaje de %s rechazado: ALLOWED_NUMBERS está vacío", msg.user_id)
            continue
        if not storage.mark_processed(msg.message_id):
            log.info("mensaje %s duplicado, lo ignoro", msg.message_id)
            continue
        tasks.add_task(_process, msg)

    return Response(status_code=200)


@app.post("/webhook/twilio")
async def twilio_webhook(request: Request, tasks: BackgroundTasks) -> Response:
    return await _handle_webhook(request, tasks)


@app.post("/webhook/meta")
async def meta_webhook(request: Request, tasks: BackgroundTasks) -> Response:
    return await _handle_webhook(request, tasks)


@app.get("/webhook/meta")
async def meta_verify(request: Request) -> Response:
    """Handshake de verificación del webhook de Meta."""
    provider = app.state.provider
    challenge = getattr(provider, "challenge", None)
    if challenge is None:
        return Response(status_code=404)
    result = challenge(dict(request.query_params))
    if result is None:
        return Response(status_code=403)
    return Response(content=result, media_type="text/plain")
