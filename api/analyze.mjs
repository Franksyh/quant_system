const STRATEGY_NAMES = {
  default: "原始 MA20/MA60 + RSI + MACD + BIAS",
  cross: "MA5/MA10/MA20 黃金/死亡交叉",
  short: "短線 EMA + MACD + RSI",
  long: "長線 SMA50/100/200 + MACD",
  rule35: "35法則 3/5 EMA + 35日突破/停利",
  vcp: "VCP 波動收縮型態"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => {
      const close = toNumber(row.close, NaN);
      if (!Number.isFinite(close)) return null;
      return {
        date: row.date || String(index + 1),
        open: toNumber(row.open, close),
        high: toNumber(row.high, close),
        low: toNumber(row.low, close),
        close,
        volume: toNumber(row.volume, 0)
      };
    })
    .filter(Boolean);
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return Number(value).toFixed(digits);
}

function pct(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function avg(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return NaN;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sma(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return NaN;
    return avg(values.slice(index + 1 - period, index + 1));
  });
}

function ema(values, period) {
  const alpha = 2 / (period + 1);
  const result = [];
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      result.push(index ? result[index - 1] : NaN);
      return;
    }
    if (!index || !Number.isFinite(result[index - 1])) {
      result.push(value);
    } else {
      result.push(value * alpha + result[index - 1] * (1 - alpha));
    }
  });
  return result;
}

function rsi(values, period = 14) {
  return values.map((_, index) => {
    if (index < period) return 50;
    let gain = 0;
    let loss = 0;
    for (let i = index - period + 1; i <= index; i += 1) {
      const diff = values[i] - values[i - 1];
      if (diff > 0) gain += diff;
      if (diff < 0) loss -= diff;
    }
    const avgGain = gain / period;
    const avgLoss = loss / period;
    if (avgLoss === 0 && avgGain > 0) return 100;
    if (avgGain === 0 && avgLoss > 0) return 0;
    if (avgGain === 0 && avgLoss === 0) return 50;
    return 100 - 100 / (1 + avgGain / avgLoss);
  });
}

function macd(values, fast = 12, slow = 26, signal = 9) {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const macdLine = values.map((_, index) => fastLine[index] - slowLine[index]);
  const signalLine = ema(macdLine, signal);
  return { macdLine, signalLine };
}

function rollingMax(values, period, indexOffset = 0) {
  const index = values.length - 1 - indexOffset;
  if (index < 0) return NaN;
  return Math.max(...values.slice(Math.max(0, index - period + 1), index + 1));
}

function rollingMin(values, period, indexOffset = 0) {
  const index = values.length - 1 - indexOffset;
  if (index < 0) return NaN;
  return Math.min(...values.slice(Math.max(0, index - period + 1), index + 1));
}

function rangePct(rows) {
  const high = Math.max(...rows.map((row) => row.high));
  const low = Math.min(...rows.map((row) => row.low));
  if (!Number.isFinite(high) || high <= 0) return 0;
  return (high - low) / high;
}

function splitChunks(rows, count) {
  const chunkSize = Math.max(1, Math.floor(rows.length / count));
  const chunks = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * chunkSize;
    const end = index === count - 1 ? rows.length : (index + 1) * chunkSize;
    chunks.push(rows.slice(start, end));
  }
  return chunks;
}

function series(rows) {
  return {
    close: rows.map((row) => row.close),
    high: rows.map((row) => row.high),
    low: rows.map((row) => row.low),
    volume: rows.map((row) => row.volume)
  };
}

function metric(label, value) {
  return { label, value };
}

function check(label, pass, detail = "") {
  return { label, pass: Boolean(pass), detail };
}

function resultShell(rows, strategy) {
  return {
    strategy,
    strategyName: STRATEGY_NAMES[strategy],
    signal: "HOLD",
    checks: [],
    metrics: [],
    summary: "",
    rows,
    source: "netlify-function"
  };
}

function calcDefault(rows) {
  const result = resultShell(rows, "default");
  if (rows.length < 60) {
    result.summary = "至少需要 60 根資料";
    return result;
  }
  const { close } = series(rows);
  const last = close.length - 1;
  const ma20 = sma(close, 20);
  const ma60 = sma(close, 60);
  const rsiLine = rsi(close);
  const { macdLine, signalLine } = macd(close);
  const bias = (close[last] - ma60[last]) / ma60[last] * 100;
  const buy = ma20[last] > ma60[last] && rsiLine[last] > 55 && macdLine[last] > signalLine[last] && bias < 10;
  const sell = ma20[last] < ma60[last] && rsiLine[last] < 45 && macdLine[last] < signalLine[last] && bias > -10;
  result.signal = sell ? "SELL" : buy ? "BUY" : "HOLD";
  result.metrics = [
    metric("收盤", round(close[last])),
    metric("MA20 / MA60", `${round(ma20[last])} / ${round(ma60[last])}`),
    metric("RSI / BIAS", `${round(rsiLine[last])} / ${round(bias)}%`)
  ];
  result.checks = [
    check("MA20 > MA60", ma20[last] > ma60[last], "多頭趨勢"),
    check("RSI > 55", rsiLine[last] > 55, "動能轉強"),
    check("MACD > Signal", macdLine[last] > signalLine[last], "指標金叉"),
    check("BIAS < 10%", bias < 10, "避免追高")
  ];
  result.summary = `${STRATEGY_NAMES.default}：${result.signal}`;
  return result;
}

function calcCross(rows) {
  const result = resultShell(rows, "cross");
  if (rows.length < 20) {
    result.summary = "至少需要 20 根資料";
    return result;
  }
  const { close } = series(rows);
  const last = close.length - 1;
  const ma5 = sma(close, 5)[last];
  const ma10 = sma(close, 10)[last];
  const ma20 = sma(close, 20)[last];
  const price = close[last];
  const buy = ma5 > ma10 && ma10 > ma20 && price < ma5 && price < ma10 && price < ma20;
  const sell = ma5 < ma10 && ma10 < ma20 && price > ma5 && price > ma10 && price > ma20;
  result.signal = sell ? "SELL" : buy ? "BUY" : "HOLD";
  result.metrics = [
    metric("收盤", round(price)),
    metric("MA5 / MA10", `${round(ma5)} / ${round(ma10)}`),
    metric("MA20", round(ma20))
  ];
  result.checks = [
    check("MA5 > MA10 > MA20", ma5 > ma10 && ma10 > ma20, "黃金交叉候選"),
    check("Close < MA5/10/20", price < ma5 && price < ma10 && price < ma20, "低檔觀察買點"),
    check("MA5 < MA10 < MA20", ma5 < ma10 && ma10 < ma20, "死亡交叉候選"),
    check("Close > MA5/10/20", price > ma5 && price > ma10 && price > ma20, "高檔觀察賣點")
  ];
  result.summary = `${STRATEGY_NAMES.cross}：${result.signal}`;
  return result;
}

function calcShort(rows) {
  const result = resultShell(rows, "short");
  if (rows.length < 26) {
    result.summary = "至少需要 26 根資料";
    return result;
  }
  const { close } = series(rows);
  const last = close.length - 1;
  const ema5 = ema(close, 5)[last];
  const ema10 = ema(close, 10)[last];
  const ema20 = ema(close, 20)[last];
  const { macdLine, signalLine } = macd(close);
  const rsiNow = rsi(close)[last];
  const price = close[last];
  const buy = price > ema5 && ema5 > ema10 && ema10 > ema20 && macdLine[last] > signalLine[last] && rsiNow < 70;
  const sell = (price < ema5 && ema5 < ema10 && ema10 < ema20) || macdLine[last] < signalLine[last] || rsiNow > 70;
  result.signal = sell ? "SELL" : buy ? "BUY" : "HOLD";
  result.metrics = [
    metric("收盤", round(price)),
    metric("EMA5/10/20", `${round(ema5)} / ${round(ema10)} / ${round(ema20)}`),
    metric("RSI", round(rsiNow))
  ];
  result.checks = [
    check("Close > EMA5 > EMA10 > EMA20", price > ema5 && ema5 > ema10 && ema10 > ema20, "短線順勢"),
    check("MACD > Signal", macdLine[last] > signalLine[last], "動能確認"),
    check("RSI < 70", rsiNow < 70, "未進入過熱區"),
    check("停損 0.5%~1%", true, "短線風控核心")
  ];
  result.summary = `${STRATEGY_NAMES.short}：${result.signal}`;
  return result;
}

function calcLong(rows) {
  const result = resultShell(rows, "long");
  if (rows.length < 200) {
    result.summary = "至少需要 200 根資料";
    return result;
  }
  const { close } = series(rows);
  const last = close.length - 1;
  const sma50 = sma(close, 50)[last];
  const sma100 = sma(close, 100)[last];
  const sma200 = sma(close, 200)[last];
  const { macdLine, signalLine } = macd(close, 26, 52, 9);
  const price = close[last];
  const buy = price > sma200 && sma50 > sma100 && sma100 > sma200 && macdLine[last] > signalLine[last];
  const sell = price < sma50 || macdLine[last] < signalLine[last];
  result.signal = sell ? "SELL" : buy ? "BUY" : "HOLD";
  result.metrics = [
    metric("收盤", round(price)),
    metric("SMA50/100/200", `${round(sma50)} / ${round(sma100)} / ${round(sma200)}`),
    metric("MACD", round(macdLine[last], 3))
  ];
  result.checks = [
    check("Close > SMA200", price > sma200, "長期趨勢向上"),
    check("SMA50 > SMA100 > SMA200", sma50 > sma100 && sma100 > sma200, "長線多頭排列"),
    check("MACD > Signal", macdLine[last] > signalLine[last], "長週期動能"),
    check("Close >= SMA50", price >= sma50, "跌破則降風險")
  ];
  result.summary = `${STRATEGY_NAMES.long}：${result.signal}`;
  return result;
}

function calcRule35(rows) {
  const result = resultShell(rows, "rule35");
  if (rows.length < 35) {
    result.summary = "至少需要 35 根資料";
    return result;
  }
  const { close, high, volume } = series(rows);
  const last = close.length - 1;
  const ema3 = ema(close, 3);
  const ema5 = ema(close, 5);
  const ema10 = ema(close, 10);
  const ema20 = ema(close, 20);
  const ma35 = sma(close, 35);
  const rsiNow = rsi(close)[last];
  const price = close[last];
  const avgVolume20 = avg(volume.slice(Math.max(0, last - 20), last));
  const prevHigh35 = rollingMax(high, 35, 1);
  const swingHigh20 = rollingMax(high, 20, 1);
  const bias20 = (price - ema20[last]) / ema20[last] * 100;
  const crossUp = ema3[last - 1] <= ema5[last - 1] && ema3[last] > ema5[last];
  const crossDown = ema3[last - 1] >= ema5[last - 1] && ema3[last] < ema5[last];
  const breakoutBuy = price > prevHigh35 && avgVolume20 > 0 && volume[last] >= avgVolume20 * 1.5 && bias20 <= 8;
  const emaCrossBuy = crossUp && price > ema20[last] && price > ma35[last] && bias20 <= 8;
  const drawdown = swingHigh20 > 0 ? (swingHigh20 - price) / swingHigh20 : 0;
  const supportDistance = Math.min(Math.abs(price - ema5[last]) / ema5[last], Math.abs(price - ema10[last]) / ema10[last]);
  const retracementBuy =
    ema3[last] > ema5[last] &&
    ema5[last] > ema20[last] &&
    drawdown >= 0.03 &&
    drawdown <= 0.05 &&
    supportDistance <= 0.015 &&
    (avgVolume20 === 0 || volume[last] < avgVolume20);
  const overboughtExit = rsiNow > 70 && (crossDown || price < close[last - 1]);
  const highBiasExit = bias20 >= 12 && price < close[last - 1];
  result.signal = crossDown || overboughtExit || highBiasExit ? "SELL" : emaCrossBuy || breakoutBuy || retracementBuy ? "BUY" : "HOLD";
  result.metrics = [
    metric("收盤", round(price)),
    metric("回檔 / BIAS20", `${pct(drawdown)} / ${round(bias20)}%`),
    metric("EMA3/5", `${round(ema3[last])} / ${round(ema5[last])}`)
  ];
  result.checks = [
    check("EMA3 上穿 EMA5", crossUp, "3/5 EMA 金叉"),
    check("突破 35 日高點且帶量", breakoutBuy, `35日高點 ${round(prevHigh35)}，量比 ${avgVolume20 ? round(volume[last] / avgVolume20, 2) : "-"}`),
    check("回檔 3%~5% 且靠近 EMA 支撐", retracementBuy, `回檔 ${pct(drawdown)}，支撐距離 ${pct(supportDistance)}`),
    check("BIAS20 <= 8%", bias20 <= 8, `目前 ${round(bias20)}%`),
    check("EMA3 未跌破 EMA5", !crossDown, "死叉為賣出警告"),
    check("RSI 未超買轉弱", !overboughtExit, `RSI ${round(rsiNow)}`)
  ];
  result.summary = `${STRATEGY_NAMES.rule35}：${result.signal}`;
  return result;
}

function calcVcp(rows) {
  const result = resultShell(rows, "vcp");
  if (rows.length < 60) {
    result.summary = "至少需要 60 根資料";
    return result;
  }
  const { close, high, low, volume } = series(rows);
  const last = close.length - 1;
  const price = close[last];
  const avgVolume20 = avg(volume.slice(Math.max(0, last - 20), last));
  const sma50Line = sma(close, 50);
  const sma200Line = sma(close, 200);
  const ema10Line = ema(close, 10);
  const ema20Line = ema(close, 20);
  const rsiNow = rsi(close)[last];
  const trendConfirmed = rows.length >= 200 ? price > sma50Line[last] && price > sma200Line[last] : price > sma50Line[last];
  const ranges = splitChunks(rows.slice(-48), 4).filter((chunk) => chunk.length).map(rangePct);
  const decreasingCount = ranges.reduce((count, value, index) => {
    if (index === ranges.length - 1) return count;
    return count + (value >= ranges[index + 1] * 0.8 ? 1 : 0);
  }, 0);
  const contractions = ranges.length >= 3 && decreasingCount >= 2 && ranges[ranges.length - 1] <= 0.08;
  const pivotHigh = rollingMax(high, 10, 1);
  const pivotLow = rollingMin(low, 10, 1);
  const last5 = rows.slice(-5);
  const pivotRange = rangePct(last5);
  const volumeDry = avgVolume20 === 0 || avg(last5.map((row) => row.volume)) <= avgVolume20 * 0.5;
  const volumeBreakout = avgVolume20 > 0 && volume[last] >= avgVolume20 * 1.5;
  const pivotBreakout = trendConfirmed && contractions && price > pivotHigh && volumeBreakout;
  const cheatEntry = trendConfirmed && contractions && pivotRange <= 0.05 && volumeDry && price >= pivotLow;
  const trendExit = price < ema10Line[last] || price < ema20Line[last] || price < sma50Line[last];
  const pivotStop = price < pivotLow;
  const overboughtExit = rsiNow > 70 && price < close[last - 1];
  result.signal = pivotStop || trendExit || overboughtExit ? "SELL" : pivotBreakout || cheatEntry ? "BUY" : "HOLD";
  result.metrics = [
    metric("收盤 / Pivot", `${round(price)} / ${round(pivotHigh)}`),
    metric("收縮幅度", ranges.map((value) => pct(value, 1)).join(" → ")),
    metric("量比 / RSI", `${avgVolume20 ? round(volume[last] / avgVolume20, 2) : "-"} / ${round(rsiNow)}`)
  ];
  result.checks = [
    check("站上 SMA50 / SMA200", trendConfirmed, rows.length >= 200 ? "長線趨勢確認" : "資料不足 200 根時以 SMA50 判斷"),
    check("收縮幅度遞減", contractions, ranges.map((value) => pct(value, 1)).join(" → ")),
    check("Pivot 突破且量能 >= 1.5x", pivotBreakout, `Pivot ${round(pivotHigh)}，量比 ${avgVolume20 ? round(volume[last] / avgVolume20, 2) : "-"}`),
    check("Cheat Entry 低量窄幅", cheatEntry, `5日區間 ${pct(pivotRange)}，低量 ${volumeDry ? "是" : "否"}`),
    check("未跌破 Pivot Low", !pivotStop, `Pivot Low ${round(pivotLow)}`),
    check("未跌破 EMA10/EMA20/SMA50", !trendExit, `${round(ema10Line[last])} / ${round(ema20Line[last])} / ${round(sma50Line[last])}`)
  ];
  result.summary = `${STRATEGY_NAMES.vcp}：${result.signal}`;
  return result;
}

function analyze(rows, strategy) {
  const calculators = { default: calcDefault, cross: calcCross, short: calcShort, long: calcLong, rule35: calcRule35, vcp: calcVcp };
  return calculators[strategy](rows);
}

export default async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, service: "quant-trade-analyzer", strategies: Object.keys(STRATEGY_NAMES) });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const strategy = String(body.strategy || "vcp").toLowerCase();
    if (!STRATEGY_NAMES[strategy]) {
      return json({ ok: false, error: `Unknown strategy: ${strategy}` }, 400);
    }
    const rows = normalizeRows(body.rows);
    const result = analyze(rows, strategy);
    return json({ ok: true, result, generatedAt: new Date().toISOString() });
  } catch (error) {
    return json({ ok: false, error: error.message || "Analyze failed" }, 400);
  }
};

export const config = {
  runtime: "edge"
};
