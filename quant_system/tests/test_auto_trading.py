import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import auto_trade
from core.state_store import build_state, load_state, restore_state, save_state
from data.market_data import create_market_data_provider
from execution.executor import Executor


class MarketDataTests(unittest.TestCase):
    def test_simulated_provider_returns_ohlcv(self):
        provider = create_market_data_provider("simulated")

        frame = provider.history("2330")

        self.assertGreaterEqual(len(frame), 200)
        self.assertTrue({"open", "high", "low", "close", "volume"}.issubset(frame))


class StateStoreTests(unittest.TestCase):
    def test_state_round_trip_restores_executor_and_watchlist(self):
        source_executor = Executor(balance=123456)
        source_executor.set_max_order(500)
        source_executor.set_stop_loss_pct(0.005)
        source_executor.set_take_profit_pct(0.35)
        source_executor.set_position("2330", 100, 500)
        source_executor.black_swan = True

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "state.json"
            save_state(path, build_state(["2330"], "vcp", source_executor))
            loaded = load_state(path)

        restored_executor = Executor(balance=0)
        stock_list, strategy = restore_state(loaded, restored_executor)

        self.assertEqual(stock_list, ["2330"])
        self.assertEqual(strategy, "vcp")
        self.assertEqual(restored_executor.balance, 123456)
        self.assertEqual(restored_executor.max_order, 500)
        self.assertEqual(restored_executor.get_position("2330"), 100)
        self.assertEqual(restored_executor.get_average_price("2330"), 500)
        self.assertTrue(restored_executor.black_swan)


class TradingCycleTests(unittest.TestCase):
    def test_simulated_default_cycle_buys_then_skips_existing_position(self):
        test_executor = Executor(balance=1_000_000)
        provider = create_market_data_provider("simulated")

        with (
            patch.object(auto_trade, "executor", test_executor),
            patch.object(auto_trade, "market_data_provider", provider),
            patch.object(auto_trade, "persist_runtime_state", lambda: None),
            patch.object(auto_trade, "_append_order_log", lambda result: None),
            patch.object(auto_trade.telegram, "executor", test_executor),
            patch.object(auto_trade.telegram, "stock_list", ["2330"]),
            patch.object(auto_trade.telegram, "strategy_mode", "default"),
            patch.object(auto_trade.telegram, "send_telegram", lambda message: True),
        ):
            first = auto_trade.run_trading_cycle(order_qty=100, notify=False)
            second = auto_trade.run_trading_cycle(order_qty=100, notify=False)

        self.assertEqual(first[0]["action"], "BUY")
        self.assertEqual(test_executor.get_position("2330"), 100)
        self.assertEqual(second[0]["action"], "SKIP")
        self.assertEqual(second[0]["reason"], "already_holding")

    def test_stop_loss_sells_full_position_even_above_max_order(self):
        test_executor = Executor(balance=0, max_order=1000, stop_loss_pct=0.01)
        test_executor.set_position("2330", 2000, 600)
        provider = create_market_data_provider("simulated")

        with (
            patch.object(auto_trade, "executor", test_executor),
            patch.object(auto_trade, "market_data_provider", provider),
            patch.object(auto_trade, "persist_runtime_state", lambda: None),
            patch.object(auto_trade, "_append_order_log", lambda result: None),
            patch.object(auto_trade.telegram, "executor", test_executor),
            patch.object(auto_trade.telegram, "stock_list", ["2330"]),
            patch.object(auto_trade.telegram, "strategy_mode", "default"),
            patch.object(auto_trade.telegram, "send_telegram", lambda message: True),
        ):
            result = auto_trade.run_trading_cycle(order_qty=100, notify=False)

        self.assertEqual(result[0]["action"], "SELL")
        self.assertEqual(result[0]["qty"], 2000)
        self.assertEqual(result[0]["exit_reason"], "stop_loss")
        self.assertEqual(test_executor.get_position("2330"), 0)


if __name__ == "__main__":
    unittest.main()
