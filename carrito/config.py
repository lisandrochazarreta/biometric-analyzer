"""Configuración del agente de carrito (se lee de .env)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _csv(name: str) -> frozenset[str]:
    raw = os.environ.get(name, "")
    return frozenset(p.strip() for p in raw.split(",") if p.strip())


@dataclass(frozen=True)
class Config:
    # --- Claude ---
    model: str = "claude-opus-5"
    effort: str = "low"
    max_tokens: int = 4096
    max_tool_iterations: int = 12
    history_turns: int = 10

    # --- Tiendas ---
    default_store: str = "coto"
    postal_code: str = "1414"
    stores_file: Path | None = None

    # --- Persistencia ---
    db_path: Path = Path(".state/carrito.db")

    # --- WhatsApp ---
    provider: str = "twilio"
    allowed_numbers: frozenset[str] = field(default_factory=frozenset)

    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from: str | None = None
    public_url: str | None = None
    validate_twilio_signature: bool = True

    meta_token: str | None = None
    meta_phone_number_id: str | None = None
    meta_verify_token: str | None = None
    meta_app_secret: str | None = None
    meta_api_version: str = "v22.0"

    http_timeout: float = 25.0


def load() -> Config:
    stores_file = os.environ.get("STORES_FILE") or None
    return Config(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-opus-5"),
        effort=os.environ.get("CLAUDE_EFFORT", "low"),
        max_tokens=int(os.environ.get("CLAUDE_MAX_TOKENS", "4096")),
        max_tool_iterations=int(os.environ.get("MAX_TOOL_ITERATIONS", "12")),
        history_turns=int(os.environ.get("HISTORY_TURNS", "10")),
        default_store=os.environ.get("DEFAULT_STORE", "coto").lower(),
        postal_code=os.environ.get("POSTAL_CODE", "1414"),
        stores_file=Path(stores_file) if stores_file else None,
        db_path=Path(os.environ.get("CARRITO_DB", ".state/carrito.db")),
        provider=os.environ.get("WHATSAPP_PROVIDER", "twilio").lower(),
        allowed_numbers=_csv("ALLOWED_NUMBERS"),
        twilio_account_sid=os.environ.get("TWILIO_ACCOUNT_SID") or None,
        twilio_auth_token=os.environ.get("TWILIO_AUTH_TOKEN") or None,
        twilio_from=os.environ.get("TWILIO_WHATSAPP_FROM") or None,
        public_url=os.environ.get("PUBLIC_URL") or None,
        validate_twilio_signature=os.environ.get("VALIDATE_TWILIO_SIGNATURE", "1") != "0",
        meta_token=os.environ.get("META_TOKEN") or None,
        meta_phone_number_id=os.environ.get("META_PHONE_NUMBER_ID") or None,
        meta_verify_token=os.environ.get("META_VERIFY_TOKEN") or None,
        meta_app_secret=os.environ.get("META_APP_SECRET") or None,
        meta_api_version=os.environ.get("META_API_VERSION", "v22.0"),
        http_timeout=float(os.environ.get("HTTP_TIMEOUT", "25")),
    )
