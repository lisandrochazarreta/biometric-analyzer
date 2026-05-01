import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    lat: float
    lng: float
    country: str
    discount_threshold: float
    ntfy_server: str
    ntfy_topic: str
    state_file: Path
    vendor_id: str | None
    cookie: str | None
    device_id: str | None

    @property
    def ntfy_url(self) -> str:
        return f"{self.ntfy_server.rstrip('/')}/{self.ntfy_topic}"


def load() -> Config:
    return Config(
        lat=float(os.environ["PEYA_LAT"]),
        lng=float(os.environ["PEYA_LNG"]),
        country=os.environ.get("PEYA_COUNTRY", "AR"),
        discount_threshold=float(os.environ.get("DISCOUNT_THRESHOLD", "80")),
        ntfy_server=os.environ.get("NTFY_SERVER", "https://ntfy.sh"),
        ntfy_topic=os.environ["NTFY_TOPIC"],
        state_file=Path(os.environ.get("STATE_FILE", ".state/seen.json")),
        vendor_id=os.environ.get("PEYA_VENDOR_ID") or None,
        cookie=os.environ.get("PEYA_COOKIE") or None,
        device_id=os.environ.get("PEYA_DEVICE_ID") or None,
    )
