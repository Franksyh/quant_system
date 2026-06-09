from __future__ import annotations

import json
from pathlib import Path

from core.signal_engine import VALID_STRATEGIES


STATE_VERSION = 1


def load_state(path):
    path = Path(path)
    if not path.exists():
        return {}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"交易狀態檔格式錯誤: {path}") from exc

    if not isinstance(data, dict):
        raise RuntimeError(f"交易狀態檔格式錯誤: {path}")
    return data


def save_state(path, state):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    temp_path.replace(path)


def build_state(stock_list, strategy_mode, executor):
    return {
        "version": STATE_VERSION,
        "stock_list": [str(symbol).upper() for symbol in stock_list],
        "strategy_mode": strategy_mode if strategy_mode in VALID_STRATEGIES else "default",
        "executor": {
            "balance": float(executor.balance),
            "max_order": int(executor.max_order),
            "stop_loss_pct": float(executor.stop_loss_pct),
            "take_profit_pct": float(executor.take_profit_pct),
            "positions": {
                str(symbol).upper(): int(qty)
                for symbol, qty in executor.positions.items()
            },
            "avg_prices": {
                str(symbol).upper(): float(price)
                for symbol, price in executor.avg_prices.items()
            },
            "black_swan": bool(executor.black_swan),
        },
    }


def restore_state(state, executor):
    raw_stock_list = state.get("stock_list", [])
    stock_list = []
    for symbol in raw_stock_list:
        text = str(symbol).strip().upper()
        if text and text not in stock_list:
            stock_list.append(text)

    strategy_mode = str(state.get("strategy_mode", "default")).lower()
    if strategy_mode not in VALID_STRATEGIES:
        strategy_mode = "default"

    executor_state = state.get("executor", {})
    if isinstance(executor_state, dict):
        executor.balance = float(executor_state.get("balance", executor.balance))
        executor.set_max_order(int(executor_state.get("max_order", executor.max_order)))
        executor.set_stop_loss_pct(
            float(executor_state.get("stop_loss_pct", executor.stop_loss_pct))
        )
        executor.set_take_profit_pct(
            float(executor_state.get("take_profit_pct", executor.take_profit_pct))
        )
        executor.black_swan = bool(executor_state.get("black_swan", False))

        executor.positions.clear()
        executor.avg_prices.clear()
        positions = executor_state.get("positions", {})
        avg_prices = executor_state.get("avg_prices", {})
        if isinstance(positions, dict):
            for symbol, qty in positions.items():
                avg_price = avg_prices.get(symbol, 0) if isinstance(avg_prices, dict) else 0
                executor.set_position(str(symbol).upper(), int(qty), float(avg_price))

    return stock_list, strategy_mode
