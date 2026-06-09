from execution.broker import create_broker


class Executor:
    def __init__(
        self,
        balance=0,
        max_order=1000,
        stop_loss_pct=0.01,
        take_profit_pct=0.35,
        order_mode="paper",
    ):
        self.balance = balance
        self.max_order = max_order
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct
        self.positions = {}  # 紀錄持股 {symbol: qty}
        self.avg_prices = {}  # 紀錄平均成本 {symbol: price}
        self.black_swan = False  # 黑天鵝事件開關
        self.order_mode = None
        self.broker = None
        self.set_order_mode(order_mode)

    def set_order_mode(self, mode):
        self.broker = create_broker(mode)
        self.order_mode = self.broker.mode

    def set_max_order(self, max_order):
        if max_order <= 0:
            raise ValueError("max_order must be positive")
        self.max_order = int(max_order)

    def set_stop_loss_pct(self, stop_loss_pct):
        if stop_loss_pct < 0:
            raise ValueError("stop_loss_pct must be non-negative")
        self.stop_loss_pct = float(stop_loss_pct)

    def set_take_profit_pct(self, take_profit_pct):
        if take_profit_pct < 0:
            raise ValueError("take_profit_pct must be non-negative")
        self.take_profit_pct = float(take_profit_pct)

    def set_position(self, symbol, qty, avg_price):
        qty = int(qty)
        avg_price = float(avg_price)
        if qty < 0 or avg_price < 0:
            raise ValueError("position and average price must be non-negative")

        if qty == 0:
            self.positions.pop(symbol, None)
            self.avg_prices.pop(symbol, None)
            return

        self.positions[symbol] = qty
        self.avg_prices[symbol] = avg_price

    def get_position(self, symbol):
        return self.positions.get(symbol, 0)

    def get_average_price(self, symbol):
        return self.avg_prices.get(symbol, 0)

    def should_stop_loss(self, symbol, price):
        qty = self.get_position(symbol)
        avg_price = self.get_average_price(symbol)
        if qty <= 0 or avg_price <= 0 or self.stop_loss_pct <= 0:
            return False
        return price <= avg_price * (1 - self.stop_loss_pct)

    def should_take_profit(self, symbol, price):
        qty = self.get_position(symbol)
        avg_price = self.get_average_price(symbol)
        if qty <= 0 or avg_price <= 0 or self.take_profit_pct <= 0:
            return False
        return price >= avg_price * (1 + self.take_profit_pct)

    def _send_order(self, symbol, action, qty, price):
        result = self.broker.place_order(symbol, action, qty, price)
        if not result.get("ok"):
            print(f"[下單失敗] {symbol} {action} {qty}股: {result.get('message')}")
            return False
        return True

    def place_order(self, symbol, action, qty, price=100, force=False):
        action = action.upper()
        qty = int(qty)
        price = float(price)

        if action not in {"BUY", "SELL"}:
            print(f"[風控] 不支援的下單方向 {action}")
            return False
        if qty <= 0 or price <= 0:
            print(f"[風控] 下單數量或價格不正確: qty={qty}, price={price}")
            return False
        if self.black_swan and action == "SELL" and not force:
            print(f"[風控] 黑天鵝事件，暫停賣出 {symbol}")
            return False
        if qty > self.max_order and not (action == "SELL" and force):
            print(f"[風控] {symbol} 下單量超過最大值 {self.max_order}")
            qty = self.max_order

        cost = qty * price
        if action == "BUY":
            if self.balance < cost:
                print(f"[風控] 資金不足，無法買入 {symbol}")
                return False
            if not self._send_order(symbol, action, qty, price):
                return False

            old_qty = self.positions.get(symbol, 0)
            old_avg = self.avg_prices.get(symbol, 0)
            new_qty = old_qty + qty
            new_avg = ((old_qty * old_avg) + cost) / new_qty

            self.balance -= cost
            self.positions[symbol] = new_qty
            self.avg_prices[symbol] = new_avg
            print(f"[BUY] {symbol} {qty}股 成功下單, 成交價 {price}, 剩餘資金 {self.balance}")
            return True

        if self.positions.get(symbol, 0) < qty:
            print(f"[風控] 持股不足，無法賣出 {symbol}")
            return False
        if not self._send_order(symbol, action, qty, price):
            return False

        self.positions[symbol] -= qty
        self.balance += cost
        if self.positions[symbol] == 0:
            del self.positions[symbol]
            self.avg_prices.pop(symbol, None)
        print(f"[SELL] {symbol} {qty}股 成功下單, 成交價 {price}, 現有資金 {self.balance}")
        return True
