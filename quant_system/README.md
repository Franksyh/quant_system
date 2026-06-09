# Quant System Telegram 紙上交易版

這是一個 Telegram 控制的自動交易系統。預設使用紙上交易與模擬行情產生 `BUY` / `SELL` / `HOLD` 訊號，並用 `Executor` 記錄現金、持股、平均成本與風控狀態；需要券商 API 中介服務與真實行情設定後，才會送出 live 下單。

## 安裝

```powershell
python -m pip install -r requirements.txt
```

如果要使用專案內的虛擬環境：

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 設定 Telegram

在專案根目錄的 `.env.txt` 或 `.env` 填入：

```text
TELEGRAM_TOKEN=你的 Bot Token
TELEGRAM_CHAT_ID=你的 Chat ID
```

`UNI_ACCOUNT`、`UNI_API_KEY`、`UNI_API_SECRET` 不會直接送券商 API；live 模式目前透過 webhook 中介服務下單。

## 啟動

```powershell
python auto_trade.py
```

啟動後到 Telegram 對你的 bot 輸入指令。系統會啟動兩個背景執行緒：一個監聽 Telegram，一個每 60 秒自動檢查交易清單。

只想先跑一次檢查，可用：

```powershell
python auto_trade.py --once --symbols 2330 --strategy vcp --no-telegram
```

不啟動 Telegram、只用已保存清單持續跑：

```powershell
python auto_trade.py --no-telegram
```

## Telegram 指令

```text
/add 股票代號
/remove 股票代號
/balance 數字
/list
/positions
/status
/runonce
/strategy default|cross|short|long|rule35|vcp
/mode paper|live
/stoploss 1
/stoploss 0.5%
/takeprofit 35
/maxorder 1000
/blackswan on|off
/setposition 股票代號 股數 平均成本
/help
```

範例：

```text
/add 2330
/strategy rule35
/stoploss 1
/takeprofit 35
/maxorder 500
/status
```

交易清單、策略、持倉、資金與停損停利會保存到 `data/trading_state.json`。每次成功下單會寫入 `data/order_log.csv`。

## 行情來源

`.env.txt` 或 `.env` 可設定：

```text
MARKET_DATA_SOURCE=simulated
```

支援值：

- `simulated`：內建假資料，適合測試流程。
- `yahoo` / `real`：使用 Yahoo chart API 抓日 K；台股數字代號會自動嘗試 `.TW` 與 `.TWO`。
- `csv`：從 `MARKET_DATA_CSV_DIR` 讀取 `{股票代號}.csv`，欄位需包含 `close`，建議也提供 `open/high/low/volume/date`。

## 策略模式

- `default`：原始 MA20 / MA60 + RSI + MACD + 乖離率。
- `cross`：依照 `投資策略.txt` 的 MA5 / MA10 / MA20 黃金交叉與死亡交叉條件。
- `short`：短線 EMA5 / EMA10 / EMA20 + MACD + RSI。
- `long`：長線 SMA50 / SMA100 / SMA200 + 長週期 MACD。
- `rule35`：35 法則，包含 3/5 EMA 交叉、35 日高點帶量突破、3%~5% 拉回買點、3/5 EMA 死叉賣點、35% 停利。
- `vcp`：VCP 波動收縮型態，包含上升趨勢、2~4 段波動收縮、pivot 突破帶量買點、cheat entry、跌破 pivot / EMA / SMA 賣點。

可用 `/strategy 模式` 切換目前策略。

## 風控規則

- 初始資金預設為 `500000`。
- 每次訊號下單預設 `100` 股。
- 最大下單量預設 `1000` 股，可用 `/maxorder` 修改。
- 停損比例預設 `1%`，可用 `/stoploss` 修改。
- 35 法則停利比例預設 `35%`，可用 `/takeprofit` 修改。
- `BUY` 訊號只會在沒有持倉時買入，避免重複買。
- `SELL` 訊號只會在有持倉時賣出。
- 停損觸發時會優先賣出全部持倉。
- 硬停損賣出全部持倉時不受最大下單量限制。
- 35 法則停利觸發時會先賣出一半持倉。
- 黑天鵝模式開啟後會暫停一般賣出；硬停損會強制執行以保護本金。
- live 下單模式不會寫入狀態檔；程式重啟後需重新輸入 `/mode live`，避免意外實單啟動。

## 下單模式

預設是 `paper`，只做本機模擬：

```text
/mode paper
```

要切到證券帳戶自動下單，請先在 `.env.txt` 或 `.env` 加上：

```text
TRADING_MODE=live
ENABLE_LIVE_TRADING=true
BROKER_PROVIDER=webhook
BROKER_WEBHOOK_URL=https://你的下單服務/order
BROKER_WEBHOOK_TOKEN=你的WebhookToken
UNI_ACCOUNT=你的證券帳號
MARKET_DATA_SOURCE=yahoo
```

然後在 Telegram 輸入：

```text
/mode live
/status
```

live 模式會把下單資料送到 `BROKER_WEBHOOK_URL`。Webhook 需要由你的券商 API 中介服務接收，再用你的證券帳戶送單。送出的 JSON 格式：

```json
{
  "account": "你的證券帳號",
  "symbol": "2330",
  "action": "BUY",
  "qty": 100,
  "price": 500.0,
  "order_type": "ROD",
  "price_type": "LMT",
  "source": "quant_system"
}
```

切 live 前，如果帳戶已有持股，先用 `/setposition` 同步本機風控狀態：

```text
/setposition 2330 100 500
```

安全限制：若行情來源不是 `yahoo` / `real`，live 模式會自動跳過下單，避免用假行情送真單。Yahoo 日 K 可能延遲，不適合高頻或盤中精準成交；正式上線前建議改接券商或可信即時行情。

## 注意

請先用 `paper` 模式與 `/runonce` 驗證策略，再切 live。自動交易可能產生實際虧損，務必設定停損、最大下單量，並先用小部位測試。
