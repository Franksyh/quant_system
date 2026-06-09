from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import requests


class MarketDataError(RuntimeError):
    """Raised when a market data provider cannot return usable OHLCV data."""


def _to_float_series(values):
    return pd.to_numeric(pd.Series(values), errors="coerce")


def _normalize_ohlcv(frame):
    if frame is None or frame.empty or "close" not in frame.columns:
        raise MarketDataError("行情資料缺少 close 欄位")

    prepared = frame.copy()
    prepared["close"] = pd.to_numeric(prepared["close"], errors="coerce")
    for column in ("open", "high", "low"):
        if column not in prepared.columns:
            prepared[column] = prepared["close"]
        prepared[column] = pd.to_numeric(prepared[column], errors="coerce").fillna(
            prepared["close"]
        )

    if "volume" not in prepared.columns:
        prepared["volume"] = 0
    prepared["volume"] = pd.to_numeric(prepared["volume"], errors="coerce").fillna(0)
    prepared = prepared.dropna(subset=["close"])

    if prepared.empty:
        raise MarketDataError("行情資料沒有有效收盤價")

    return prepared


def _simulated_history(length=220):
    close = [500 + i * 0.1 for i in range(length)]
    return pd.DataFrame(
        {
            "open": close,
            "high": [price * 1.01 for price in close],
            "low": [price * 0.99 for price in close],
            "close": close,
            "volume": [1000 + i * 10 for i in range(length)],
        }
    )


def _symbol_candidates(symbol):
    text = str(symbol).strip().upper()
    if "." in text or not text.isdigit():
        return [text]
    return [f"{text}.TW", f"{text}.TWO", text]


@dataclass
class MarketDataProvider:
    source: str = "simulated"
    csv_dir: Path | None = None
    yahoo_range: str = "1y"
    yahoo_interval: str = "1d"
    timeout: int = 10
    user_agent: str = "Mozilla/5.0"

    @property
    def live_compatible(self):
        return self.source in {"yahoo", "real"}

    def history(self, symbol):
        if self.source == "simulated":
            return _simulated_history()
        if self.source == "csv":
            return self._csv_history(symbol)
        if self.source in {"yahoo", "real"}:
            return self._yahoo_history(symbol)
        raise MarketDataError(f"不支援的行情來源: {self.source}")

    def _csv_history(self, symbol):
        if self.csv_dir is None:
            raise MarketDataError("缺少 MARKET_DATA_CSV_DIR")

        for candidate in _symbol_candidates(symbol):
            path = self.csv_dir / f"{candidate}.csv"
            if path.exists():
                frame = pd.read_csv(path)
                if "date" in frame.columns:
                    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
                    frame = frame.sort_values("date")
                return _normalize_ohlcv(frame)

        raise MarketDataError(f"找不到 {symbol} 的 CSV 行情檔")

    def _yahoo_history(self, symbol):
        errors = []
        for candidate in _symbol_candidates(symbol):
            try:
                return self._fetch_yahoo_candidate(candidate)
            except MarketDataError as exc:
                errors.append(f"{candidate}: {exc}")

        raise MarketDataError("; ".join(errors))

    def _fetch_yahoo_candidate(self, candidate):
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{candidate}"
        response = requests.get(
            url,
            params={"range": self.yahoo_range, "interval": self.yahoo_interval},
            headers={"User-Agent": self.user_agent},
            timeout=self.timeout,
        )
        if response.status_code >= 400:
            raise MarketDataError(f"Yahoo HTTP {response.status_code}")

        payload = response.json()
        chart = payload.get("chart", {})
        result = chart.get("result") or []
        if not result:
            error = chart.get("error") or {}
            raise MarketDataError(error.get("description") or "Yahoo 無資料")

        data = result[0]
        timestamps = data.get("timestamp") or []
        quotes = data.get("indicators", {}).get("quote") or []
        if not timestamps or not quotes:
            raise MarketDataError("Yahoo 回傳資料缺少 K 線")

        quote = quotes[0]
        frame = pd.DataFrame(
            {
                "date": pd.to_datetime(timestamps, unit="s", utc=True).tz_convert(
                    "Asia/Taipei"
                ),
                "open": _to_float_series(quote.get("open", [])),
                "high": _to_float_series(quote.get("high", [])),
                "low": _to_float_series(quote.get("low", [])),
                "close": _to_float_series(quote.get("close", [])),
                "volume": _to_float_series(quote.get("volume", [])),
            }
        )
        return _normalize_ohlcv(frame)


def create_market_data_provider(source=None):
    source = (source or os.getenv("MARKET_DATA_SOURCE", "simulated")).strip().lower()
    if source == "real":
        source = "yahoo"

    csv_dir = os.getenv("MARKET_DATA_CSV_DIR")
    if csv_dir:
        csv_dir = Path(csv_dir)

    return MarketDataProvider(
        source=source,
        csv_dir=csv_dir,
        yahoo_range=os.getenv("YAHOO_RANGE", "1y"),
        yahoo_interval=os.getenv("YAHOO_INTERVAL", "1d"),
        timeout=int(os.getenv("MARKET_DATA_TIMEOUT", "10")),
        user_agent=os.getenv("MARKET_DATA_USER_AGENT", "Mozilla/5.0"),
    )
