import argparse
import csv
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from core.signal_engine import VALID_STRATEGIES, calc_signal
from core.state_store import build_state, load_state, restore_state, save_state
from data.market_data import MarketDataError, create_market_data_provider
from execution.executor import Executor
from interface import telegram


PROJECT_ROOT = Path(__file__).resolve().parent


def _env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name, default):
    value = os.getenv(name)
    if value is None or str(value).strip() == "":
        return default
    return int(value)


def _env_float(name, default):
    value = os.getenv(name)
    if value is None or str(value).strip() == "":
        return default
    return float(value)


def _resolve_path(raw_path, default_relative):
    path = Path(raw_path or default_relative)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path


DEFAULT_BALANCE = _env_float("DEFAULT_BALANCE", 500000)
DEFAULT_ORDER_QTY = _env_int("DEFAULT_ORDER_QTY", 100)
TRADE_INTERVAL_SECONDS = _env_int("TRADE_INTERVAL_SECONDS", 60)
MARKET_DATA_SOURCE = os.getenv("MARKET_DATA_SOURCE", "simulated").strip().lower()
ALLOW_LIVE_WITH_SIM_DATA = _env_bool("ALLOW_LIVE_WITH_SIM_DATA")
STATE_PATH = _resolve_path(os.getenv("TRADING_STATE_FILE"), "data/trading_state.json")
ORDER_LOG_PATH = _resolve_path(os.getenv("ORDER_LOG_FILE"), "data/order_log.csv")

# 設定 Executor
executor = Executor(balance=DEFAULT_BALANCE)
telegram.executor = executor  # 傳給 telegram 模組
market_data_provider = create_market_data_provider(MARKET_DATA_SOURCE)


def get_stock_history(symbol):
    return market_data_provider.history(symbol)


def get_latest_price(df, default_price=100):
    if df.empty or "close" not in df.columns:
        return default_price
    return float(df["close"].iloc[-1])


def _record_skip(results, symbol, signal, reason, strategy):
    results.append(
        {
            "symbol": symbol,
            "signal": signal,
            "action": "SKIP",
            "reason": reason,
            "strategy": strategy,
        }
    )


def _sell_qty_for_reason(position, reason, order_qty):
    if reason == "take_profit":
        return max(1, position // 2)
    if reason == "stop_loss":
        return position
    return min(order_qty, position)


def _limit_order_qty(action, qty, force=False):
    if action == "SELL" and force:
        return int(qty)
    return min(int(qty), executor.max_order)


def _can_place_order():
    return (
        executor.order_mode != "live"
        or market_data_provider.live_compatible
        or ALLOW_LIVE_WITH_SIM_DATA
    )


def _live_market_data_skip_reason():
    return f"live_requires_real_market_data:{market_data_provider.source}"


def _build_runtime_state():
    return build_state(telegram.stock_list, telegram.strategy_mode, executor)


def persist_runtime_state():
    save_state(STATE_PATH, _build_runtime_state())


def restore_runtime_state():
    state = load_state(STATE_PATH)
    if not state:
        return False

    stock_list, strategy_mode = restore_state(state, executor)
    telegram.stock_list[:] = stock_list
    telegram.strategy_mode = strategy_mode
    return True


def _append_order_log(result):
    if result.get("action") not in {"BUY", "SELL", "FAILED"}:
        return

    ORDER_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "timestamp",
        "symbol",
        "signal",
        "action",
        "qty",
        "price",
        "strategy",
        "order_mode",
        "exit_reason",
        "stop_loss",
        "take_profit",
    ]
    row = {name: result.get(name, "") for name in fieldnames}
    row["timestamp"] = datetime.now(timezone.utc).isoformat()

    write_header = not ORDER_LOG_PATH.exists()
    with ORDER_LOG_PATH.open("a", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        if write_header:
            writer.writeheader()
        writer.writerow(row)


def _record_result(results, result):
    results.append(result)
    _append_order_log(result)


def run_trading_cycle(symbols=None, order_qty=DEFAULT_ORDER_QTY, notify=True):
    active_symbols = list(symbols) if symbols is not None else list(telegram.stock_list)
    strategy = telegram.strategy_mode
    results = []

    for symbol in active_symbols:
        try:
            df = get_stock_history(symbol)
        except MarketDataError as e:
            _record_skip(results, symbol, "ERROR", f"market_data_error:{e}", strategy)
            continue

        price = get_latest_price(df)
        signal = calc_signal(df, strategy=strategy)
        position = executor.get_position(symbol)
        stop_loss_triggered = executor.should_stop_loss(symbol, price)
        take_profit_triggered = strategy == "rule35" and executor.should_take_profit(symbol, price)
        exit_reason = None

        if stop_loss_triggered:
            signal = "SELL"
            exit_reason = "stop_loss"
        elif take_profit_triggered:
            signal = "SELL"
            exit_reason = "take_profit"

        if signal == "BUY":
            if position > 0:
                _record_skip(results, symbol, signal, "already_holding", strategy)
                continue
            qty = _limit_order_qty(signal, order_qty)
            if not _can_place_order():
                _record_skip(results, symbol, signal, _live_market_data_skip_reason(), strategy)
                continue
            success = executor.place_order(symbol, signal, qty, price=price)
        elif signal == "SELL":
            if position <= 0:
                _record_skip(results, symbol, signal, "no_position", strategy)
                continue
            qty = _sell_qty_for_reason(position, exit_reason, order_qty)
            qty = _limit_order_qty(signal, qty, force=stop_loss_triggered)
            if not _can_place_order():
                _record_skip(results, symbol, signal, _live_market_data_skip_reason(), strategy)
                continue
            success = executor.place_order(
                symbol,
                signal,
                qty,
                price=price,
                force=stop_loss_triggered,
            )
        else:
            _record_result(
                results,
                {
                    "symbol": symbol,
                    "signal": signal,
                    "action": "HOLD",
                    "reason": "no_signal",
                    "strategy": strategy,
                }
            )
            continue

        if success:
            persist_runtime_state()
            if stop_loss_triggered:
                prefix = "停損觸發，"
            elif take_profit_triggered:
                prefix = "35% 停利觸發，"
            else:
                prefix = ""
            if notify:
                telegram.send_telegram(
                    f"{prefix}{symbol} {signal} {qty}股 已下單，成交價 {price:.2f}，模式 {executor.order_mode}"
                )

        _record_result(
            results,
            {
                "symbol": symbol,
                "signal": signal,
                "action": signal if success else "FAILED",
                "qty": qty,
                "price": price,
                "strategy": strategy,
                "stop_loss": stop_loss_triggered,
                "take_profit": take_profit_triggered,
                "exit_reason": exit_reason,
                "order_mode": executor.order_mode,
            }
        )

    return results


# Telegram 長輪詢
def telegram_listener():
    offset = None
    while True:
        updates = telegram.get_updates(offset)
        for update in updates:
            offset = update["update_id"] + 1
            message = update.get("message", {})
            text = message.get("text")
            if text:
                telegram.handle_message(text)
        time.sleep(1)


# 自動交易主迴圈
def auto_trading_loop(
    interval_seconds=TRADE_INTERVAL_SECONDS,
    order_qty=DEFAULT_ORDER_QTY,
    notify=True,
):
    while True:
        run_trading_cycle(order_qty=order_qty, notify=notify)
        time.sleep(interval_seconds)


def _parse_symbols(raw_symbols):
    if not raw_symbols:
        return None
    symbols = []
    for raw_symbol in raw_symbols.replace("，", ",").split(","):
        symbol = raw_symbol.strip().upper()
        if symbol and symbol not in symbols:
            symbols.append(symbol)
    return symbols


def _format_cycle_results(results):
    if not results:
        return "本次沒有交易清單可檢查"

    lines = ["本次檢查結果:"]
    for result in results:
        symbol = result.get("symbol")
        action = result.get("action")
        signal = result.get("signal")
        reason = result.get("reason") or result.get("exit_reason") or ""
        qty = result.get("qty")
        price = result.get("price")
        if qty and price:
            lines.append(f"{symbol}: {action} {qty}股 @ {price:.2f} ({signal})")
        else:
            suffix = f" - {reason}" if reason else ""
            lines.append(f"{symbol}: {action} ({signal}){suffix}")
    return "\n".join(lines)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Quant System 自動交易程式")
    parser.add_argument("--once", action="store_true", help="只執行一次交易檢查")
    parser.add_argument("--symbols", help="逗號分隔股票代號，例如 2330,2317")
    parser.add_argument("--strategy", choices=sorted(VALID_STRATEGIES), help="本次使用策略")
    parser.add_argument("--qty", type=int, default=DEFAULT_ORDER_QTY, help="每次下單股數")
    parser.add_argument(
        "--interval",
        type=int,
        default=TRADE_INTERVAL_SECONDS,
        help="自動檢查秒數間隔",
    )
    parser.add_argument(
        "--no-telegram",
        action="store_true",
        help="不啟動 Telegram 監聽，也不傳送 Telegram 通知",
    )
    return parser.parse_args(argv)


def configure_runtime():
    restored = restore_runtime_state()
    telegram.state_saver = persist_runtime_state
    telegram.trade_runner = lambda: run_trading_cycle()
    return restored


def main(argv=None):
    args = parse_args(argv)
    restored = configure_runtime()

    symbols = _parse_symbols(args.symbols)
    if symbols is not None:
        telegram.stock_list[:] = symbols
        persist_runtime_state()
    if args.strategy is not None:
        telegram.strategy_mode = args.strategy
        persist_runtime_state()

    if args.once:
        results = run_trading_cycle(
            symbols=symbols,
            order_qty=args.qty,
            notify=not args.no_telegram,
        )
        print(_format_cycle_results(results))
        return

    if not args.no_telegram:
        telegram.require_telegram_config()

        # 啟動 Telegram 監聽
        listener_thread = threading.Thread(target=telegram_listener, daemon=True)
        listener_thread.start()

    # 啟動自動交易
    trading_thread = threading.Thread(
        target=auto_trading_loop,
        kwargs={
            "interval_seconds": args.interval,
            "order_qty": args.qty,
            "notify": not args.no_telegram,
        },
        daemon=True,
    )
    trading_thread.start()

    print("Quant System Started")
    print(f"Market data source: {market_data_provider.source}")
    print(f"State file: {STATE_PATH}")
    print(f"Order log: {ORDER_LOG_PATH}")
    print(f"Runtime state restored: {'yes' if restored else 'no'}")
    if args.no_telegram:
        print("Telegram listener disabled")
    else:
        print("Waiting for Telegram commands...")

    while True:
        time.sleep(1)


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        raise SystemExit(f"啟動失敗: {e}")
