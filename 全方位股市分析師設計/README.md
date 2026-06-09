# 盤中飆股雷達

這是一個台股盤中量價訊號儀表板，並可選擇用 Telegram 在盤中推播候選名單。它不是保證獲利的薦股系統，而是把漲幅、日內位置、開盤後續強、量能與買賣盤壓力整理成可追蹤的訊號分數。

## 快速開始

```powershell
npm start
```

打開：

```text
http://localhost:3000
```

## Telegram 推播

複製 `.env.example` 成 `.env`，填入：

```text
TELEGRAM_BOT_TOKEN=你的 bot token
TELEGRAM_CHAT_ID=你的 chat id
```

重新啟動伺服器後，系統會在台北時間週一至週五 `09:00-13:30` 之間依 `SCAN_INTERVAL_MINUTES` 掃描，當分數高於 `ALERT_SCORE` 時推播前幾名。

## 語音或文字生成內容

網站上方有內容生成面板，可用文字輸入需求，也可在支援 Web Speech API 的瀏覽器中用語音輸入。生成內容會使用目前掃描排行，適合產生盤中摘要、Telegram 推播文案、表格排行或風險清單。

目前生成器是本機規則型版本，不需要 API Key。若要改成真正的 AI 模型，可以把 `server.js` 的 `/api/generate` 端點接到 OpenAI、Claude、Gemini 或自架模型。

## 股票池

可在 `.env` 的 `WATCHLIST` 或網站左側欄位調整。支援：

```text
2330
2330.TW
8069.TWO
tse_2330.tw
otc_8069.tw
```

只輸入四位數代號時，伺服器會同時查上市與上櫃。

## 風險提醒

目前資料來源是 TWSE MIS 公開行情端點，適合 MVP 與個人監控。若要做正式交易決策或大量用戶服務，建議改接券商 API、付費即時行情或自有資料庫，並加入假日行事曆、產業分類、新聞事件與籌碼資料。
