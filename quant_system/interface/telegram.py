import os
from pathlib import Path

import requests
from dotenv import load_dotenv

from core.signal_engine import STRATEGY_NAMES, VALID_STRATEGIES
from execution.executor import Executor

stock_list = []
executor: Executor = None  # 由 auto_trade.py 設定
strategy_mode = "default"
state_saver = None
trade_runner = None

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env.txt")
load_dotenv(PROJECT_ROOT / ".env")

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
BASE_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}" if TELEGRAM_TOKEN else None

HELP_TEXT = """可用指令：
/add 股票代號
/remove 股票代號
/balance 數字
/list
/positions
/status
/runonce
/strategy default|cross|short|long|rule35|vcp
/mode paper|live
/stoploss 1 或 /stoploss 0.5%
/takeprofit 35
/maxorder 1000
/blackswan on|off
/setposition 股票代號 股數 平均成本
/help"""


def has_telegram_config():
    return bool(TELEGRAM_TOKEN and TELEGRAM_CHAT_ID)


def require_telegram_config():
    if not has_telegram_config():
        raise RuntimeError(
            "缺少 Telegram 設定，請在 .env.txt 或 .env 填入 TELEGRAM_TOKEN 和 TELEGRAM_CHAT_ID"
        )


def send_telegram(message):
    if not has_telegram_config():
        print("Telegram Error: 缺少 TELEGRAM_TOKEN 或 TELEGRAM_CHAT_ID")
        return False

    try:
        response = requests.post(
            f"{BASE_URL}/sendMessage",
            data={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": message,
            },
            timeout=10,
        )
        if response.status_code != 200:
            print(f"Telegram Error: HTTP {response.status_code} {response.text}")
            return False
        return True
    except Exception as e:
        print("Telegram Error:", e)
        return False


def get_updates(offset=None):
    require_telegram_config()

    params = {"timeout": 30}
    if offset is not None:
        params["offset"] = offset

    try:
        response = requests.get(f"{BASE_URL}/getUpdates", params=params, timeout=35)
        if response.status_code == 200:
            return response.json().get("result", [])
        print(f"Telegram Error: HTTP {response.status_code} {response.text}")
    except Exception as e:
        print("Telegram Error:", e)
    return []


def _format_percent(value):
    return f"{value * 100:.2f}%"


def _parse_percent(raw_value):
    text = raw_value.strip()
    has_percent = text.endswith("%")
    if has_percent:
        text = text[:-1]

    value = float(text)
    if value < 0:
        raise ValueError("percentage must be non-negative")

    if has_percent or value > 0.2:
        value = value / 100
    if value > 0.5:
        raise ValueError("percentage is too high")
    return value


def _format_positions():
    if executor is None or not executor.positions:
        return "目前沒有持倉"

    lines = ["目前持倉："]
    for symbol, qty in sorted(executor.positions.items()):
        avg_price = executor.avg_prices.get(symbol, 0)
        lines.append(f"{symbol}: {qty}股，平均成本 {avg_price:.2f}")
    return "\n".join(lines)


def _format_status():
    if executor is None:
        return "交易執行器尚未初始化"

    stocks = ", ".join(stock_list) if stock_list else "空"
    return "\n".join(
        [
            f"可用資金: {executor.balance:.2f}",
            f"交易清單: {stocks}",
            f"策略: {strategy_mode} - {STRATEGY_NAMES[strategy_mode]}",
            f"下單模式: {executor.order_mode}",
            f"最大下單量: {executor.max_order}股",
            f"停損比例: {_format_percent(executor.stop_loss_pct)}",
            f"停利比例: {_format_percent(executor.take_profit_pct)}",
            f"黑天鵝模式: {'ON' if executor.black_swan else 'OFF'}",
            _format_positions(),
        ]
    )


def _require_executor():
    if executor is None:
        send_telegram("交易執行器尚未初始化")
        return False
    return True


def _save_state():
    if callable(state_saver):
        state_saver()


def _format_cycle_results(results):
    if not results:
        return "本次沒有交易清單可檢查"

    lines = ["本次檢查結果："]
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


def handle_message(text):
    global stock_list, executor, strategy_mode
    text = text.strip()
    parts = text.split()

    if not parts:
        send_telegram("未知指令，請輸入 /help 查看可用指令")
        return

    command = parts[0].lower()

    if command == "/add":
        if len(parts) != 2:
            send_telegram("請輸入股票代號，例如 /add 2330")
            return

        symbol = parts[1].upper()
        if symbol not in stock_list:
            stock_list.append(symbol)
            _save_state()
            send_telegram(f"{symbol} 已加入交易清單")
        else:
            send_telegram(f"{symbol} 已在交易清單中")
    elif command == "/remove":
        if len(parts) != 2:
            send_telegram("請輸入股票代號，例如 /remove 2330")
            return

        symbol = parts[1].upper()
        if symbol in stock_list:
            stock_list.remove(symbol)
            _save_state()
            send_telegram(f"{symbol} 已從清單移除")
        else:
            send_telegram(f"{symbol} 不在交易清單中")
    elif command == "/balance":
        if not _require_executor():
            return
        if len(parts) != 2:
            send_telegram("請輸入正確金額，例如 /balance 500000")
            return

        try:
            amount = float(parts[1])
            if amount < 0:
                raise ValueError("balance must be non-negative")
            executor.balance = amount
            _save_state()
            send_telegram(f"可用資金更新為 {amount:.2f} 元")
        except ValueError:
            send_telegram("請輸入正確金額，例如 /balance 500000")
    elif command == "/strategy":
        if len(parts) == 1:
            options = ", ".join(sorted(VALID_STRATEGIES))
            send_telegram(f"目前策略: {strategy_mode}\n可用策略: {options}")
            return
        if len(parts) != 2 or parts[1].lower() not in VALID_STRATEGIES:
            options = ", ".join(sorted(VALID_STRATEGIES))
            send_telegram(f"請輸入策略，例如 /strategy rule35，可用: {options}")
            return
        strategy_mode = parts[1].lower()
        _save_state()
        send_telegram(f"策略已切換為 {strategy_mode} - {STRATEGY_NAMES[strategy_mode]}")
    elif command == "/mode":
        if not _require_executor():
            return
        if len(parts) != 2 or parts[1].lower() not in {"paper", "live"}:
            send_telegram("請輸入 /mode paper 或 /mode live")
            return
        try:
            executor.set_order_mode(parts[1].lower())
            send_telegram(f"下單模式已切換為 {executor.order_mode}")
        except RuntimeError as e:
            send_telegram(f"無法切換下單模式: {e}")
    elif command == "/stoploss":
        if not _require_executor():
            return
        if len(parts) != 2:
            send_telegram("請輸入停損比例，例如 /stoploss 1 或 /stoploss 0.5%")
            return
        try:
            stop_loss_pct = _parse_percent(parts[1])
            executor.set_stop_loss_pct(stop_loss_pct)
            _save_state()
            send_telegram(f"停損比例已更新為 {_format_percent(stop_loss_pct)}")
        except ValueError:
            send_telegram("請輸入合理停損比例，例如 /stoploss 1 或 /stoploss 0.5%")
    elif command == "/takeprofit":
        if not _require_executor():
            return
        if len(parts) != 2:
            send_telegram("請輸入停利比例，例如 /takeprofit 35")
            return
        try:
            take_profit_pct = _parse_percent(parts[1])
            executor.set_take_profit_pct(take_profit_pct)
            _save_state()
            send_telegram(f"停利比例已更新為 {_format_percent(take_profit_pct)}")
        except ValueError:
            send_telegram("請輸入合理停利比例，例如 /takeprofit 35")
    elif command == "/maxorder":
        if not _require_executor():
            return
        if len(parts) != 2:
            send_telegram("請輸入最大下單量，例如 /maxorder 1000")
            return
        try:
            max_order = int(parts[1])
            executor.set_max_order(max_order)
            _save_state()
            send_telegram(f"最大下單量已更新為 {max_order}股")
        except ValueError:
            send_telegram("請輸入正確最大下單量，例如 /maxorder 1000")
    elif command == "/blackswan":
        if not _require_executor():
            return
        if len(parts) != 2 or parts[1].lower() not in {"on", "off"}:
            send_telegram("請輸入 /blackswan on 或 /blackswan off")
            return
        executor.black_swan = parts[1].lower() == "on"
        _save_state()
        send_telegram(f"黑天鵝模式已切換為 {'ON' if executor.black_swan else 'OFF'}")
    elif command == "/setposition":
        if not _require_executor():
            return
        if len(parts) != 4:
            send_telegram("請輸入 /setposition 股票代號 股數 平均成本，例如 /setposition 2330 100 500")
            return
        try:
            symbol = parts[1].upper()
            qty = int(parts[2])
            avg_price = float(parts[3])
            executor.set_position(symbol, qty, avg_price)
            _save_state()
            send_telegram(f"{symbol} 持倉已同步為 {qty}股，平均成本 {avg_price:.2f}")
        except ValueError:
            send_telegram("請輸入正確持倉，例如 /setposition 2330 100 500")
    elif command == "/runonce" and len(parts) == 1:
        if not callable(trade_runner):
            send_telegram("交易檢查器尚未初始化")
            return
        try:
            results = trade_runner()
            send_telegram(_format_cycle_results(results))
        except Exception as e:
            send_telegram(f"單次檢查失敗: {e}")
    elif command == "/list" and len(parts) == 1:
        send_telegram(f"目前交易清單: {stock_list}")
    elif command == "/positions" and len(parts) == 1:
        send_telegram(_format_positions())
    elif command == "/status" and len(parts) == 1:
        send_telegram(_format_status())
    elif command == "/help" and len(parts) == 1:
        send_telegram(HELP_TEXT)
    else:
        send_telegram("未知指令，請輸入 /help 查看可用指令")
