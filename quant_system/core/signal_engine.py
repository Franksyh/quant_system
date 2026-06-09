import numpy as np
import pandas as pd

VALID_STRATEGIES = {"default", "cross", "short", "long", "rule35", "vcp"}
STRATEGY_NAMES = {
    "default": "原始 MA20/MA60 + RSI + MACD + BIAS",
    "cross": "MA5/MA10/MA20 黃金/死亡交叉",
    "short": "短線 EMA + MACD + RSI",
    "long": "長線 SMA50/100/200 + MACD",
    "rule35": "35法則 3/5 EMA + 35日突破/停利",
    "vcp": "VCP 波動收縮型態",
}


def _prepare(df):
    if df is None or df.empty or "close" not in df.columns:
        return pd.DataFrame(columns=["close", "high", "low", "volume"])
    prepared = df.copy()
    prepared["close"] = pd.to_numeric(prepared["close"], errors="coerce")
    if "high" not in prepared.columns:
        prepared["high"] = prepared["close"]
    if "low" not in prepared.columns:
        prepared["low"] = prepared["close"]
    if "volume" not in prepared.columns:
        prepared["volume"] = 0
    prepared["high"] = pd.to_numeric(prepared["high"], errors="coerce").fillna(prepared["close"])
    prepared["low"] = pd.to_numeric(prepared["low"], errors="coerce").fillna(prepared["close"])
    prepared["volume"] = pd.to_numeric(prepared["volume"], errors="coerce").fillna(0)
    return prepared.dropna(subset=["close"])


def _rsi(close, period=14):
    delta = close.diff()
    up = delta.clip(lower=0)
    down = -delta.clip(upper=0)
    avg_gain = up.rolling(period).mean()
    avg_loss = down.rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - 100 / (1 + rs)
    rsi[(avg_loss == 0) & (avg_gain > 0)] = 100
    rsi[(avg_gain == 0) & (avg_loss > 0)] = 0
    rsi[(avg_gain == 0) & (avg_loss == 0)] = 50
    return rsi.fillna(50)


def _macd(close, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd = ema_fast - ema_slow
    signal_line = macd.ewm(span=signal, adjust=False).mean()
    return macd, signal_line


def calc_default_signal(df):
    prepared = _prepare(df)
    if len(prepared) < 60:
        return "HOLD"

    close = prepared["close"]
    fast_ma = close.rolling(20).mean()
    slow_ma = close.rolling(60).mean()
    rsi = _rsi(close)
    macd, signal_line = _macd(close)
    bias = (close - slow_ma) / slow_ma * 100

    last = prepared.index[-1]
    if (
        fast_ma.loc[last] > slow_ma.loc[last]
        and rsi.loc[last] > 55
        and macd.loc[last] > signal_line.loc[last]
        and bias.loc[last] < 10
    ):
        return "BUY"
    if (
        fast_ma.loc[last] < slow_ma.loc[last]
        and rsi.loc[last] < 45
        and macd.loc[last] < signal_line.loc[last]
        and bias.loc[last] > -10
    ):
        return "SELL"
    return "HOLD"


def calc_cross_signal(df):
    prepared = _prepare(df)
    if len(prepared) < 20:
        return "HOLD"

    close = prepared["close"]
    ma5 = close.rolling(5).mean().iloc[-1]
    ma10 = close.rolling(10).mean().iloc[-1]
    ma20 = close.rolling(20).mean().iloc[-1]
    price = close.iloc[-1]

    # 依照文件「投資策略.txt」：MA5 > MA10 > MA20 且收盤價低於所有均線。
    if ma5 > ma10 > ma20 and price < ma5 and price < ma10 and price < ma20:
        return "BUY"
    if ma5 < ma10 < ma20 and price > ma5 and price > ma10 and price > ma20:
        return "SELL"
    return "HOLD"


def calc_short_signal(df):
    prepared = _prepare(df)
    if len(prepared) < 26:
        return "HOLD"

    close = prepared["close"]
    ema5 = close.ewm(span=5, adjust=False).mean().iloc[-1]
    ema10 = close.ewm(span=10, adjust=False).mean().iloc[-1]
    ema20 = close.ewm(span=20, adjust=False).mean().iloc[-1]
    macd, signal_line = _macd(close)
    rsi = _rsi(close).iloc[-1]
    price = close.iloc[-1]

    if price > ema5 > ema10 > ema20 and macd.iloc[-1] > signal_line.iloc[-1] and rsi < 70:
        return "BUY"
    if price < ema5 < ema10 < ema20 or macd.iloc[-1] < signal_line.iloc[-1] or rsi > 70:
        return "SELL"
    return "HOLD"


def calc_long_signal(df):
    prepared = _prepare(df)
    if len(prepared) < 200:
        return "HOLD"

    close = prepared["close"]
    sma50 = close.rolling(50).mean().iloc[-1]
    sma100 = close.rolling(100).mean().iloc[-1]
    sma200 = close.rolling(200).mean().iloc[-1]
    macd, signal_line = _macd(close, fast=26, slow=52, signal=9)
    price = close.iloc[-1]

    if price > sma200 and sma50 > sma100 > sma200 and macd.iloc[-1] > signal_line.iloc[-1]:
        return "BUY"
    if price < sma50 or macd.iloc[-1] < signal_line.iloc[-1]:
        return "SELL"
    return "HOLD"


def calc_rule35_signal(df):
    prepared = _prepare(df)
    if len(prepared) < 35:
        return "HOLD"

    close = prepared["close"]
    high = prepared["high"]
    volume = prepared["volume"]
    ema3 = close.ewm(span=3, adjust=False).mean()
    ema5 = close.ewm(span=5, adjust=False).mean()
    ema10 = close.ewm(span=10, adjust=False).mean()
    ema20 = close.ewm(span=20, adjust=False).mean()
    ma35 = close.rolling(35).mean()
    rsi = _rsi(close)

    price = close.iloc[-1]
    prev_price = close.iloc[-2]
    avg_volume20 = volume.shift(1).rolling(20).mean().iloc[-1]
    prev_high35 = high.shift(1).rolling(35).max().iloc[-1]
    swing_high20 = high.shift(1).rolling(20).max().iloc[-1]
    bias20 = (price - ema20.iloc[-1]) / ema20.iloc[-1] * 100

    cross_up = ema3.iloc[-2] <= ema5.iloc[-2] and ema3.iloc[-1] > ema5.iloc[-1]
    cross_down = ema3.iloc[-2] >= ema5.iloc[-2] and ema3.iloc[-1] < ema5.iloc[-1]
    volume_confirmed = avg_volume20 > 0 and volume.iloc[-1] >= avg_volume20 * 1.5
    trend_confirmed = price > ema20.iloc[-1] and price > ma35.iloc[-1]
    not_overextended = bias20 <= 8

    breakout_buy = price > prev_high35 and volume_confirmed and not_overextended
    ema_cross_buy = cross_up and trend_confirmed and not_overextended

    drawdown = (swing_high20 - price) / swing_high20 if swing_high20 > 0 else 0
    support_distance = min(
        abs(price - ema5.iloc[-1]) / ema5.iloc[-1],
        abs(price - ema10.iloc[-1]) / ema10.iloc[-1],
    )
    retracement_buy = (
        ema3.iloc[-1] > ema5.iloc[-1] > ema20.iloc[-1]
        and 0.03 <= drawdown <= 0.05
        and support_distance <= 0.015
        and (avg_volume20 == 0 or volume.iloc[-1] < avg_volume20)
    )

    overbought_exit = rsi.iloc[-1] > 70 and (cross_down or price < prev_price)
    high_bias_exit = bias20 >= 12 and price < prev_price

    if cross_down or overbought_exit or high_bias_exit:
        return "SELL"
    if ema_cross_buy or breakout_buy or retracement_buy:
        return "BUY"
    return "HOLD"


def _range_pct(chunk):
    high = chunk["high"].max()
    low = chunk["low"].min()
    if high <= 0:
        return 0
    return (high - low) / high


def _split_chunks(frame, chunks):
    size = len(frame)
    chunk_size = max(1, size // chunks)
    result = []
    for index in range(chunks):
        start = index * chunk_size
        end = size if index == chunks - 1 else (index + 1) * chunk_size
        result.append(frame.iloc[start:end])
    return result


def calc_vcp_signal(df):
    prepared = _prepare(df)
    if len(prepared) < 60:
        return "HOLD"

    close = prepared["close"]
    high = prepared["high"]
    low = prepared["low"]
    volume = prepared["volume"]
    price = close.iloc[-1]
    avg_volume20 = volume.shift(1).rolling(20).mean().iloc[-1]
    sma50 = close.rolling(50).mean().iloc[-1]
    ema10 = close.ewm(span=10, adjust=False).mean().iloc[-1]
    ema20 = close.ewm(span=20, adjust=False).mean().iloc[-1]
    rsi = _rsi(close).iloc[-1]

    if len(prepared) >= 200:
        sma200 = close.rolling(200).mean().iloc[-1]
        trend_confirmed = price > sma50 and price > sma200
    else:
        trend_confirmed = price > sma50

    contraction_window = prepared.tail(48)
    chunks = _split_chunks(contraction_window, 4)
    ranges = [_range_pct(chunk) for chunk in chunks if len(chunk) > 0]
    decreasing_count = sum(ranges[i] >= ranges[i + 1] * 0.8 for i in range(len(ranges) - 1))
    contractions = len(ranges) >= 3 and decreasing_count >= 2 and ranges[-1] <= 0.08

    pivot_high = high.shift(1).rolling(10).max().iloc[-1]
    pivot_low = low.shift(1).rolling(10).min().iloc[-1]
    last5 = prepared.tail(5)
    pivot_range = _range_pct(last5)
    volume_dry = avg_volume20 == 0 or last5["volume"].mean() <= avg_volume20 * 0.5
    volume_breakout = avg_volume20 > 0 and volume.iloc[-1] >= avg_volume20 * 1.5

    pivot_breakout = (
        trend_confirmed
        and contractions
        and price > pivot_high
        and volume_breakout
    )
    cheat_entry = (
        trend_confirmed
        and contractions
        and pivot_range <= 0.05
        and volume_dry
        and price >= pivot_low
    )

    trend_exit = price < ema10 or price < ema20 or price < sma50
    pivot_stop = price < pivot_low
    overbought_exit = rsi > 70 and price < close.iloc[-2]

    if pivot_stop or trend_exit or overbought_exit:
        return "SELL"
    if pivot_breakout or cheat_entry:
        return "BUY"
    return "HOLD"


def calc_signal(df, strategy="default"):
    strategy = (strategy or "default").lower()
    if strategy not in VALID_STRATEGIES:
        raise ValueError(f"Unknown strategy: {strategy}")

    if strategy == "cross":
        return calc_cross_signal(df)
    if strategy == "short":
        return calc_short_signal(df)
    if strategy == "long":
        return calc_long_signal(df)
    if strategy == "rule35":
        return calc_rule35_signal(df)
    if strategy == "vcp":
        return calc_vcp_signal(df)
    return calc_default_signal(df)
