import os

import requests


def _env_enabled(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class PaperBroker:
    mode = "paper"

    def place_order(self, symbol, action, qty, price, **kwargs):
        return {
            "ok": True,
            "mode": self.mode,
            "symbol": symbol,
            "action": action,
            "qty": qty,
            "price": price,
            "message": "paper order accepted",
        }


class WebhookBroker:
    mode = "live"

    def __init__(self, url, token=None, account=None, timeout=10):
        if not url:
            raise RuntimeError("缺少 BROKER_WEBHOOK_URL，無法啟用 live 下單")
        self.url = url
        self.token = token
        self.account = account
        self.timeout = timeout

    def place_order(self, symbol, action, qty, price, **kwargs):
        payload = {
            "account": self.account,
            "symbol": symbol,
            "action": action,
            "qty": int(qty),
            "price": float(price),
            "order_type": kwargs.get("order_type", "ROD"),
            "price_type": kwargs.get("price_type", "LMT"),
            "source": "quant_system",
        }
        headers = {}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        response = requests.post(
            self.url,
            json=payload,
            headers=headers,
            timeout=self.timeout,
        )
        if response.status_code >= 400:
            return {
                "ok": False,
                "mode": self.mode,
                "status_code": response.status_code,
                "message": response.text,
            }

        try:
            data = response.json()
        except ValueError:
            data = {"message": response.text}

        data.setdefault("ok", True)
        data.setdefault("mode", self.mode)
        return data


def create_broker(mode=None):
    mode = (mode or os.getenv("TRADING_MODE", "paper")).strip().lower()
    if mode == "paper":
        return PaperBroker()
    if mode != "live":
        raise RuntimeError("TRADING_MODE 只能是 paper 或 live")

    if not _env_enabled("ENABLE_LIVE_TRADING"):
        raise RuntimeError("live 下單未啟用，請先設定 ENABLE_LIVE_TRADING=true")

    provider = os.getenv("BROKER_PROVIDER", "webhook").strip().lower()
    if provider != "webhook":
        raise RuntimeError("目前 live 僅支援 BROKER_PROVIDER=webhook")

    return WebhookBroker(
        url=os.getenv("BROKER_WEBHOOK_URL"),
        token=os.getenv("BROKER_WEBHOOK_TOKEN"),
        account=os.getenv("UNI_ACCOUNT") or os.getenv("BROKER_ACCOUNT"),
    )
