import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const APP_FILE = "全方位股市分析師設計.html";
const MARKET_TIME_ZONE = "Asia/Taipei";
const YAHOO_SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 60);
const DASHBOARD_CACHE_SECONDS = Number(process.env.DASHBOARD_CACHE_SECONDS || 90);
const SEARCH_CACHE_SECONDS = Number(process.env.SEARCH_CACHE_SECONDS || 300);

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

const COMMON_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const PRESETS = {
  indices: ["^TWII", "^GSPC", "^IXIC", "^DJI", "^SOX", "DX-Y.NYB", "^TNX", "GC=F", "CL=F"],
  twStocks: ["2330.TW", "2317.TW", "2454.TW", "2308.TW", "2382.TW", "2881.TW", "2882.TW", "3661.TW", "3037.TW", "2603.TW"],
  usStocks: ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "AMD", "AVGO", "TSM"],
  funds: ["0050.TW", "00878.TW", "006208.TW", "VOO", "QQQ", "VTI", "GLD", "SLV", "USO", "DBC"],
  bonds: ["^TNX", "TLT", "IEF", "BND", "AGG", "00679B.TWO", "00751B.TWO", "00687B.TWO"],
  forex: ["USDTWD=X", "TWD=X", "JPY=X", "EURUSD=X", "GBPUSD=X", "AUDUSD=X", "USDCNH=X", "DX-Y.NYB"],
};

const SYMBOL_DIRECTORY = new Map(
  [
    ["^TWII", { zhName: "台灣加權指數", assetClass: "index", category: "大盤", yahooQuery: "Taiwan Weighted Index" }],
    ["^GSPC", { zhName: "標普 500 指數", assetClass: "index", category: "大盤", yahooQuery: "S&P 500" }],
    ["^IXIC", { zhName: "那斯達克綜合指數", assetClass: "index", category: "大盤", yahooQuery: "Nasdaq Composite" }],
    ["^DJI", { zhName: "道瓊工業指數", assetClass: "index", category: "大盤", yahooQuery: "Dow Jones Industrial Average" }],
    ["^SOX", { zhName: "費城半導體指數", assetClass: "index", category: "大盤", yahooQuery: "PHLX Semiconductor Index" }],
    ["DX-Y.NYB", { zhName: "美元指數", assetClass: "index", category: "外匯", yahooQuery: "US Dollar Index" }],
    ["^TNX", { zhName: "美國 10 年期公債殖利率", assetClass: "bond", category: "債券", yahooQuery: "US 10 Year Treasury Yield" }],
    ["GC=F", { zhName: "黃金期貨", assetClass: "commodity", category: "原物料", yahooQuery: "Gold futures" }],
    ["CL=F", { zhName: "原油期貨", assetClass: "commodity", category: "原物料", yahooQuery: "Crude oil futures" }],

    ["2330.TW", { zhName: "台積電", assetClass: "stock", market: "台股", category: "股票", yahooQuery: "Taiwan Semiconductor Manufacturing" }],
    ["2317.TW", { zhName: "鴻海", assetClass: "stock", market: "台股", category: "股票", yahooQuery: "Hon Hai Precision" }],
    ["2454.TW", { zhName: "聯發科", assetClass: "stock", market: "台股", category: "股票", yahooQuery: "MediaTek" }],
    ["2308.TW", { zhName: "台達電", assetClass: "stock", market: "台股", category: "股票", yahooQuery: "Delta Electronics Taiwan" }],
    ["2382.TW", { zhName: "廣達", assetClass: "stock", market: "台股", category: "股票", yahooQuery: "Quanta Computer" }],
    ["2881.TW", { zhName: "富邦金", assetClass: "stock", market: "台股", category: "股票", yahooQuery: "Fubon Financial" }],
    ["2882.TW", { zhName: "國泰金", assetClass: "stock", market: "台股", category: "股票", yahooQuery: "Cathay Financial" }],
    ["3661.TW", { zhName: "世芯-KY", assetClass: "stock", market: "台股", category: "股票", yahooQuery: "Alchip Technologies" }],
    ["3037.TW", { zhName: "欣興", assetClass: "stock", market: "台股", category: "股票", yahooQuery: "Unimicron" }],
    ["2603.TW", { zhName: "長榮", assetClass: "stock", market: "台股", category: "股票", yahooQuery: "Evergreen Marine" }],

    ["NVDA", { zhName: "NVIDIA", assetClass: "stock", market: "美股", category: "股票", yahooQuery: "NVIDIA Corporation" }],
    ["AAPL", { zhName: "Apple", assetClass: "stock", market: "美股", category: "股票", yahooQuery: "Apple stock" }],
    ["MSFT", { zhName: "Microsoft", assetClass: "stock", market: "美股", category: "股票", yahooQuery: "Microsoft stock" }],
    ["GOOGL", { zhName: "Alphabet", assetClass: "stock", market: "美股", category: "股票", yahooQuery: "Alphabet stock" }],
    ["AMZN", { zhName: "Amazon", assetClass: "stock", market: "美股", category: "股票", yahooQuery: "Amazon stock" }],
    ["META", { zhName: "Meta", assetClass: "stock", market: "美股", category: "股票", yahooQuery: "Meta Platforms stock" }],
    ["TSLA", { zhName: "Tesla", assetClass: "stock", market: "美股", category: "股票", yahooQuery: "Tesla stock" }],
    ["AMD", { zhName: "AMD", assetClass: "stock", market: "美股", category: "股票", yahooQuery: "AMD stock" }],
    ["AVGO", { zhName: "Broadcom", assetClass: "stock", market: "美股", category: "股票", yahooQuery: "Broadcom stock" }],
    ["TSM", { zhName: "台積電 ADR", assetClass: "stock", market: "美股", category: "股票", yahooQuery: "TSM ADR" }],

    ["0050.TW", { zhName: "元大台灣 50", assetClass: "fund", category: "基金/ETF", yahooQuery: "Yuanta Taiwan 50 ETF" }],
    ["00878.TW", { zhName: "國泰永續高股息", assetClass: "fund", category: "基金/ETF", yahooQuery: "Cathay Taiwan ESG Sustainability High Dividend ETF" }],
    ["006208.TW", { zhName: "富邦台 50", assetClass: "fund", category: "基金/ETF", yahooQuery: "Fubon Taiwan 50 ETF" }],
    ["VOO", { zhName: "Vanguard S&P 500 ETF", assetClass: "fund", category: "基金/ETF", yahooQuery: "VOO ETF" }],
    ["QQQ", { zhName: "Invesco QQQ ETF", assetClass: "fund", category: "基金/ETF", yahooQuery: "QQQ ETF" }],
    ["VTI", { zhName: "Vanguard Total Stock Market ETF", assetClass: "fund", category: "基金/ETF", yahooQuery: "VTI ETF" }],
    ["GLD", { zhName: "SPDR 黃金 ETF", assetClass: "fund", category: "原物料 ETF", yahooQuery: "SPDR Gold Shares" }],
    ["SLV", { zhName: "iShares 白銀 ETF", assetClass: "fund", category: "原物料 ETF", yahooQuery: "iShares Silver Trust" }],
    ["USO", { zhName: "United States Oil Fund", assetClass: "fund", category: "原物料 ETF", yahooQuery: "United States Oil Fund" }],
    ["DBC", { zhName: "Invesco 商品指數 ETF", assetClass: "fund", category: "原物料 ETF", yahooQuery: "Invesco DB Commodity Index Tracking Fund" }],

    ["TLT", { zhName: "iShares 20+ 年美債 ETF", assetClass: "bond", category: "債券", yahooQuery: "TLT bond ETF" }],
    ["IEF", { zhName: "iShares 7-10 年美債 ETF", assetClass: "bond", category: "債券", yahooQuery: "IEF bond ETF" }],
    ["BND", { zhName: "Vanguard Total Bond Market ETF", assetClass: "bond", category: "債券", yahooQuery: "BND bond ETF" }],
    ["AGG", { zhName: "iShares Core US Aggregate Bond ETF", assetClass: "bond", category: "債券", yahooQuery: "AGG bond ETF" }],
    ["00679B.TWO", { zhName: "元大美債 20 年", assetClass: "bond", category: "債券", yahooQuery: "00679B" }],
    ["00751B.TWO", { zhName: "元大AAA至A公司債", assetClass: "bond", category: "債券", yahooQuery: "00751B" }],
    ["00687B.TWO", { zhName: "國泰20年美債", assetClass: "bond", category: "債券", yahooQuery: "00687B" }],

    ["USDTWD=X", { zhName: "美元/新台幣", assetClass: "forex", category: "外匯", yahooQuery: "USD TWD exchange rate", base: "USD", quote: "TWD" }],
    ["TWD=X", { zhName: "美元/新台幣", assetClass: "forex", category: "外匯", yahooQuery: "USD TWD exchange rate", base: "USD", quote: "TWD" }],
    ["JPY=X", { zhName: "美元/日圓", assetClass: "forex", category: "外匯", yahooQuery: "USD JPY exchange rate", base: "USD", quote: "JPY" }],
    ["EURUSD=X", { zhName: "歐元/美元", assetClass: "forex", category: "外匯", yahooQuery: "EUR USD exchange rate", base: "EUR", quote: "USD" }],
    ["GBPUSD=X", { zhName: "英鎊/美元", assetClass: "forex", category: "外匯", yahooQuery: "GBP USD exchange rate", base: "GBP", quote: "USD" }],
    ["AUDUSD=X", { zhName: "澳幣/美元", assetClass: "forex", category: "外匯", yahooQuery: "AUD USD exchange rate", base: "AUD", quote: "USD" }],
    ["USDCNH=X", { zhName: "美元/離岸人民幣", assetClass: "forex", category: "外匯", yahooQuery: "USD CNH exchange rate", base: "USD", quote: "CNH" }],
  ].map(([symbol, details]) => [symbol.toUpperCase(), { symbol, ...details }])
);

const ALIAS_SYMBOLS = new Map(
  [
    ["大盤", "^TWII"],
    ["台股", "^TWII"],
    ["台股大盤", "^TWII"],
    ["加權指數", "^TWII"],
    ["台灣加權", "^TWII"],
    ["美股大盤", "^GSPC"],
    ["標普", "^GSPC"],
    ["標普500", "^GSPC"],
    ["nasdaq", "^IXIC"],
    ["那斯達克", "^IXIC"],
    ["費半", "^SOX"],
    ["半導體指數", "^SOX"],
    ["道瓊", "^DJI"],
    ["美元指數", "DX-Y.NYB"],
    ["dxy", "DX-Y.NYB"],
    ["美元台幣", "USDTWD=X"],
    ["美金台幣", "USDTWD=X"],
    ["usd/twd", "USDTWD=X"],
    ["usdtwd", "USDTWD=X"],
    ["日圓", "JPY=X"],
    ["日幣", "JPY=X"],
    ["usd/jpy", "JPY=X"],
    ["歐元", "EURUSD=X"],
    ["eur/usd", "EURUSD=X"],
    ["英鎊", "GBPUSD=X"],
    ["澳幣", "AUDUSD=X"],
    ["人民幣", "USDCNH=X"],
    ["美債", "^TNX"],
    ["美國十年債", "^TNX"],
    ["10年債", "^TNX"],
    ["十年債", "^TNX"],
    ["台積電", "2330.TW"],
    ["tsmc", "2330.TW"],
    ["鴻海", "2317.TW"],
    ["聯發科", "2454.TW"],
    ["台達電", "2308.TW"],
    ["廣達", "2382.TW"],
    ["富邦金", "2881.TW"],
    ["國泰金", "2882.TW"],
    ["世芯", "3661.TW"],
    ["長榮", "2603.TW"],
    ["元大台灣50", "0050.TW"],
    ["台灣50", "0050.TW"],
    ["高股息", "00878.TW"],
    ["黃金", "GLD"],
    ["黃金etf", "GLD"],
    ["原油", "USO"],
  ].map(([key, symbol]) => [key.toLowerCase(), symbol])
);

const cache = new Map();
const rooms = new Map();
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 2 * 60 * 1000);
const ROOM_MAX_USERS = Number(process.env.ROOM_MAX_USERS || 60);

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, COMMON_HEADERS);
      return res.end();
    }

    const apiResponse = await handleApiRequest(requestUrl);
    if (apiResponse) {
      return sendJson(res, apiResponse.data, apiResponse.status);
    }

    return serveStatic(requestUrl.pathname, res);
  } catch (error) {
    console.error(error);
    return sendJson(
      res,
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown server error",
      },
      500
    );
  }
});

if (isDirectRun()) {
  server.listen(PORT, () => {
    console.log(`Market analyst app listening on http://localhost:${PORT}`);
  });
}

export async function handleApiRequest(requestUrl) {
  if (requestUrl.pathname === "/api/config") {
    return jsonResult({
      ok: true,
      source: "Yahoo Finance chart/search",
      timezone: MARKET_TIME_ZONE,
      cacheSeconds: CACHE_SECONDS,
      presets: PRESETS,
      refreshedAt: new Date().toISOString(),
    });
  }

  if (requestUrl.pathname === "/api/search") {
    const query = String(requestUrl.searchParams.get("q") || "").trim();
    if (!query) return jsonResult({ ok: true, query, results: [], news: [] });
    const data = await searchAssets(query);
    return jsonResult({ ok: true, ...data });
  }

  if (requestUrl.pathname === "/api/quote") {
    const rawSymbol = String(requestUrl.searchParams.get("symbol") || "").trim();
    if (!rawSymbol) return jsonResult({ ok: false, error: "請提供 symbol 參數。" }, 400);
    const symbol = normalizeSymbol(rawSymbol);
    const instrument = await getInstrument(symbol, { range: "1y", interval: "1d" });
    const news = await getNewsForInstrument(instrument);
    return jsonResult({ ok: true, item: instrument, news });
  }

  if (requestUrl.pathname === "/api/batch") {
    const symbols = splitSymbols(requestUrl.searchParams.get("symbols") || "");
    if (!symbols.length) return jsonResult({ ok: true, items: [] });
    const items = await fetchInstrumentList(symbols.slice(0, 60), { range: "1y", interval: "1d" });
    return jsonResult({ ok: true, items, source: "Yahoo Finance chart", refreshedAt: new Date().toISOString() });
  }

  if (requestUrl.pathname === "/api/dashboard") {
    const dashboard = await cached(
      "dashboard:v3",
      DASHBOARD_CACHE_SECONDS,
      () => buildDashboard()
    );
    return jsonResult(dashboard);
  }

  if (requestUrl.pathname === "/api/news") {
    const query = String(requestUrl.searchParams.get("q") || "stock market fed rates ai semiconductor").trim();
    const news = await searchNews(query, 10);
    return jsonResult({ ok: true, query, news });
  }

  if (requestUrl.pathname === "/api/room") {
    return syncRoom(requestUrl);
  }

  if (requestUrl.pathname === "/api/room/leave") {
    return leaveRoom(requestUrl);
  }

  if (requestUrl.pathname === "/api/health") {
    return jsonResult({ ok: true, now: new Date().toISOString() });
  }

  return null;
}

function jsonResult(data, status = 200) {
  return { data, status };
}

function syncRoom(requestUrl) {
  pruneRooms();

  const now = Date.now();
  const roomId = sanitizeRoom(requestUrl.searchParams.get("room")) || makeShortId("room");
  const userId = sanitizeUserId(requestUrl.searchParams.get("user")) || makeShortId("user");
  const name = sanitizeName(requestUrl.searchParams.get("name")) || `User ${userId.slice(-4).toUpperCase()}`;
  const focus = sanitizeFocus(requestUrl.searchParams.get("focus"));

  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      createdAt: now,
      updatedAt: now,
      focus: "",
      users: new Map(),
    };
    rooms.set(roomId, room);
  }

  const existing = room.users.get(userId);
  if (focus) room.focus = focus;
  if (!existing && room.users.size >= ROOM_MAX_USERS) {
    const oldest = [...room.users.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0];
    if (oldest) room.users.delete(oldest.id);
  }

  room.users.set(userId, {
    id: userId,
    name,
    focus: focus || existing?.focus || room.focus || "",
    joinedAt: existing?.joinedAt || new Date(now).toISOString(),
    lastSeen: now,
  });
  room.updatedAt = now;

  return jsonResult({ ok: true, userId, ...roomSnapshot(room) });
}

function leaveRoom(requestUrl) {
  const roomId = sanitizeRoom(requestUrl.searchParams.get("room"));
  const userId = sanitizeUserId(requestUrl.searchParams.get("user"));
  const room = roomId ? rooms.get(roomId) : null;
  if (room && userId) {
    room.users.delete(userId);
    room.updatedAt = Date.now();
    if (!room.users.size) rooms.delete(roomId);
  }
  return jsonResult({ ok: true, room: roomId, userId });
}

function roomSnapshot(room) {
  const now = Date.now();
  const users = [...room.users.values()]
    .filter((user) => now - user.lastSeen <= ROOM_TTL_MS)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((user) => ({
      id: user.id,
      name: user.name,
      focus: user.focus,
      joinedAt: user.joinedAt,
      lastSeen: new Date(user.lastSeen).toISOString(),
    }));

  return {
    room: room.id,
    onlineCount: users.length,
    focus: room.focus,
    users,
    updatedAt: new Date(room.updatedAt).toISOString(),
    expiresInSeconds: Math.round(ROOM_TTL_MS / 1000),
  };
}

function pruneRooms() {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    for (const [userId, user] of room.users.entries()) {
      if (now - user.lastSeen > ROOM_TTL_MS) room.users.delete(userId);
    }
    if (!room.users.size && now - room.updatedAt > ROOM_TTL_MS) rooms.delete(roomId);
  }
}

function sanitizeRoom(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 18);
}

function sanitizeUserId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 36);
}

function sanitizeFocus(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.^=_-]/g, "")
    .slice(0, 18);
}

function sanitizeName(value) {
  return String(value || "")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 24);
}

function makeShortId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? `/${APP_FILE}` : decodeURIComponent(pathname);
  const absolutePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, "Forbidden", 403);
  }

  try {
    const file = await readFile(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    res.writeHead(200, {
      ...COMMON_HEADERS,
      "content-type": MIME_TYPES.get(ext) || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(file);
  } catch {
    sendText(res, "Not found", 404);
  }
}

async function buildDashboard() {
  const [indices, twStocks, usStocks, funds, bonds, forex, news] = await Promise.all([
    fetchInstrumentList(PRESETS.indices, { range: "1y", interval: "1d" }),
    fetchInstrumentList(PRESETS.twStocks, { range: "1y", interval: "1d" }),
    fetchInstrumentList(PRESETS.usStocks, { range: "1y", interval: "1d" }),
    fetchInstrumentList(PRESETS.funds, { range: "1y", interval: "1d" }),
    fetchInstrumentList(PRESETS.bonds, { range: "1y", interval: "1d" }),
    fetchInstrumentList(PRESETS.forex, { range: "6mo", interval: "1d" }),
    searchNews("stock market fed interest rates AI semiconductor global markets", 8),
  ]);

  const macro = buildMacroView(indices, bonds, forex);
  const trending = [...twStocks, ...usStocks]
    .filter((item) => item.ok && Number.isFinite(item.price))
    .map((item) => ({
      ...item,
      hotScore: hotStockScore(item),
    }))
    .sort((a, b) => b.hotScore - a.hotScore)
    .slice(0, 18);

  return {
    ok: true,
    source: "Yahoo Finance chart/search",
    timezone: MARKET_TIME_ZONE,
    refreshedAt: new Date().toISOString(),
    groups: { indices, twStocks, usStocks, funds, bonds, forex },
    macro,
    trending,
    news,
  };
}

function buildMacroView(indices, bonds, forex) {
  const twii = findSymbol(indices, "^TWII");
  const spx = findSymbol(indices, "^GSPC");
  const nasdaq = findSymbol(indices, "^IXIC");
  const sox = findSymbol(indices, "^SOX");
  const dxy = findSymbol(indices, "DX-Y.NYB") || findSymbol(forex, "DX-Y.NYB");
  const tnx = findSymbol(indices, "^TNX") || findSymbol(bonds, "^TNX");
  const gold = findSymbol(indices, "GC=F");
  const oil = findSymbol(indices, "CL=F");

  const signals = [];
  if (twii) signals.push(macroSignal("台股大盤", twii.trend.short, twii.changePercent, "以台股加權指數判斷本地風險偏好。"));
  if (spx) signals.push(macroSignal("美股風險胃納", spx.trend.medium, spx.changePercent, "S&P 500 反映全球大型股資金態度。"));
  if (nasdaq || sox) {
    const leader = sox || nasdaq;
    signals.push(macroSignal("科技與半導體", leader.trend.short, leader.changePercent, "費半/那指走勢會影響 AI、半導體與成長股。"));
  }
  if (tnx) {
    const tone = tnx.changePercent > 0.3 ? "看跌" : tnx.changePercent < -0.3 ? "看漲" : "中性";
    signals.push(macroSignal("利率壓力", tone, tnx.changePercent, "10 年期美債殖利率上行通常壓抑債券與高本益比股票估值。"));
  }
  if (dxy) {
    const tone = dxy.changePercent > 0.25 ? "看跌" : dxy.changePercent < -0.25 ? "看漲" : "中性";
    signals.push(macroSignal("美元與外匯", tone, dxy.changePercent, "美元指數偏強時，新興市場與原物料常承受匯率壓力。"));
  }
  if (gold) signals.push(macroSignal("黃金避險", gold.trend.short, gold.changePercent, "黃金可觀察避險需求與實質利率變化。"));
  if (oil) signals.push(macroSignal("能源成本", oil.trend.short, oil.changePercent, "油價上行可能推升通膨預期並影響升降息路徑。"));

  const bullish = signals.filter((signal) => signal.tone === "看漲").length;
  const bearish = signals.filter((signal) => signal.tone === "看跌").length;
  const overall =
    bullish >= bearish + 2 ? "偏多" : bearish >= bullish + 2 ? "偏空" : bullish > bearish ? "震盪偏多" : bearish > bullish ? "震盪偏空" : "中性震盪";

  return {
    overall,
    signals,
    summary: `目前宏觀訊號為${overall}。系統綜合台股、美股、美元、利率、能源與黃金趨勢產生此判斷。`,
  };
}

function macroSignal(title, tone, changePercent, note) {
  return {
    title,
    tone: normalizeTone(tone),
    changePercent: round(changePercent, 2),
    note,
  };
}

function normalizeTone(tone) {
  if (tone === "看漲" || tone === "偏多" || tone === "強勢") return "看漲";
  if (tone === "看跌" || tone === "偏空" || tone === "弱勢") return "看跌";
  return "中性";
}

async function fetchInstrumentList(symbols, options) {
  return mapLimit(symbols.map(normalizeSymbol), 8, async (symbol) => {
    try {
      return await getInstrument(symbol, options);
    } catch (error) {
      const directory = SYMBOL_DIRECTORY.get(symbol.toUpperCase());
      return {
        ok: false,
        symbol,
        name: directory?.zhName || symbol,
        assetClass: directory?.assetClass || "unknown",
        category: directory?.category || "未知",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

async function getInstrument(rawSymbol, options = {}) {
  const symbol = normalizeSymbol(rawSymbol);
  const range = options.range || "1y";
  const interval = options.interval || "1d";
  const key = `chart:${symbol}:${range}:${interval}`;
  return cached(key, CACHE_SECONDS, async () => {
    const chart = await fetchYahooChart(symbol, range, interval);
    return buildInstrument(chart, symbol);
  });
}

async function fetchYahooChart(symbol, range, interval) {
  const url = new URL(`${YAHOO_CHART}/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");

  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MarketAnalyst/1.0",
    },
  });
  const data = await response.json().catch(() => null);
  const error = data?.chart?.error;
  if (!response.ok || error) {
    throw new Error(error?.description || `Yahoo Finance chart 回應 ${response.status}`);
  }

  const result = data?.chart?.result?.[0];
  if (!result?.meta) throw new Error(`Yahoo Finance 查無 ${symbol} 的圖表資料。`);
  return result;
}

function buildInstrument(chart, requestedSymbol) {
  const meta = chart.meta;
  const directory = SYMBOL_DIRECTORY.get(String(meta.symbol || requestedSymbol).toUpperCase()) || SYMBOL_DIRECTORY.get(requestedSymbol.toUpperCase()) || {};
  const quote = chart.indicators?.quote?.[0] || {};
  const timestamps = chart.timestamp || [];
  const candles = timestamps
    .map((stamp, index) => ({
      time: stamp * 1000,
      open: toNumber(quote.open?.[index]),
      high: toNumber(quote.high?.[index]),
      low: toNumber(quote.low?.[index]),
      close: toNumber(quote.close?.[index]),
      volume: toNumber(quote.volume?.[index]) || 0,
    }))
    .filter((row) => Number.isFinite(row.close));

  if (!candles.length) throw new Error(`Yahoo Finance 查無 ${requestedSymbol} 的有效價格。`);

  const closes = candles.map((row) => row.close);
  const highs = candles.map((row) => Number.isFinite(row.high) ? row.high : row.close);
  const lows = candles.map((row) => Number.isFinite(row.low) ? row.low : row.close);
  const volumes = candles.map((row) => row.volume || 0);
  const last = candles.at(-1);
  const previous = candles.at(-2) || candles.at(-1);
  const price = toNumber(meta.regularMarketPrice) ?? last.close;
  const previousClose = previous.close;
  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;
  const recent20 = candles.slice(-20);
  const support = Math.min(...recent20.map((row) => Number.isFinite(row.low) ? row.low : row.close));
  const resistance = Math.max(...recent20.map((row) => Number.isFinite(row.high) ? row.high : row.close));
  const indicators = buildIndicators(candles, closes, highs, lows, volumes);
  const assetClass = directory.assetClass || classifyAsset(meta.instrumentType, requestedSymbol);
  const category = directory.category || categoryFromAssetClass(assetClass);
  const market = directory.market || marketFromMeta(meta, requestedSymbol);
  const displaySymbol = meta.symbol || requestedSymbol;
  const name = directory.zhName || meta.longName || meta.shortName || displaySymbol;
  const yahooName = meta.longName || meta.shortName || name;
  const instrument = {
    ok: true,
    symbol: displaySymbol,
    requestedSymbol,
    name,
    yahooName,
    assetClass,
    category,
    market,
    exchange: meta.fullExchangeName || meta.exchangeName || "",
    instrumentType: meta.instrumentType || "",
    currency: meta.currency || "",
    timezone: meta.exchangeTimezoneName || meta.timezone || "",
    marketState: marketStateFromMeta(meta),
    price: round(price, 6),
    previousClose: round(previousClose, 6),
    change: round(change, 6),
    changePercent: round(changePercent, 4),
    dayHigh: round(toNumber(meta.regularMarketDayHigh) ?? last.high ?? price, 6),
    dayLow: round(toNumber(meta.regularMarketDayLow) ?? last.low ?? price, 6),
    fiftyTwoWeekHigh: round(toNumber(meta.fiftyTwoWeekHigh), 6),
    fiftyTwoWeekLow: round(toNumber(meta.fiftyTwoWeekLow), 6),
    volume: toNumber(meta.regularMarketVolume) ?? last.volume ?? 0,
    updatedAt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date(last.time).toISOString(),
    source: "Yahoo Finance chart",
    candles: candles.slice(-120).map((row) => ({
      time: new Date(row.time).toISOString(),
      open: round(row.open, 6),
      high: round(row.high, 6),
      low: round(row.low, 6),
      close: round(row.close, 6),
      volume: row.volume,
    })),
    indicators,
    support: round(support, 6),
    resistance: round(resistance, 6),
  };

  const analysis = analyzeInstrument(instrument);
  return {
    ...instrument,
    ...analysis,
  };
}

function buildIndicators(candles, closes, highs, lows, volumes) {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdSeries = closes.map((_, index) => {
    if (!Number.isFinite(ema12[index]) || !Number.isFinite(ema26[index])) return null;
    return ema12[index] - ema26[index];
  });
  const signalSeries = emaSeries(macdSeries.filter(Number.isFinite), 9);
  const macd = macdSeries.filter(Number.isFinite).at(-1) ?? 0;
  const signal = signalSeries.filter(Number.isFinite).at(-1) ?? 0;
  const atr14 = atr(candles, 14);
  const avgVolume20 = average(volumes.slice(-20));

  return {
    sma5: round(sma(closes, 5), 6),
    sma20: round(sma(closes, 20), 6),
    sma60: round(sma(closes, 60), 6),
    sma120: round(sma(closes, 120), 6),
    rsi14: round(rsi(closes, 14), 2),
    macd: round(macd, 6),
    macdSignal: round(signal, 6),
    macdHistogram: round(macd - signal, 6),
    atr14: round(atr14, 6),
    avgVolume20: Math.round(avgVolume20 || 0),
    return5d: round(returnPercent(closes, 5), 4),
    return20d: round(returnPercent(closes, 20), 4),
    return60d: round(returnPercent(closes, 60), 4),
    high20: round(Math.max(...highs.slice(-20)), 6),
    low20: round(Math.min(...lows.slice(-20)), 6),
  };
}

function analyzeInstrument(item) {
  const { price, indicators, support, resistance, assetClass } = item;
  const atrValue = Number.isFinite(indicators.atr14) && indicators.atr14 > 0 ? indicators.atr14 : Math.abs(item.change) || price * 0.02;
  const above20 = Number.isFinite(indicators.sma20) ? price >= indicators.sma20 : false;
  const above60 = Number.isFinite(indicators.sma60) ? price >= indicators.sma60 : false;
  const above120 = Number.isFinite(indicators.sma120) ? price >= indicators.sma120 : above60;
  const macdPositive = Number(indicators.macdHistogram || 0) >= 0;
  const rsiValue = Number(indicators.rsi14 || 50);
  const volumeBoost = Number(item.volume || 0) > Number(indicators.avgVolume20 || 0) * 1.15;
  const nearBreakout = price >= resistance - atrValue * 0.35;
  const extended = Number.isFinite(indicators.sma20) && price > indicators.sma20 + atrValue * 1.8;

  let score = 50;
  if (above20) score += 10;
  else score -= 8;
  if (above60) score += 10;
  else score -= 10;
  if (macdPositive) score += 8;
  else score -= 7;
  if (indicators.return5d > 0) score += 5;
  else score -= 4;
  if (indicators.return20d > 0) score += 6;
  else score -= 5;
  if (rsiValue >= 45 && rsiValue <= 68) score += 6;
  if (rsiValue > 75) score -= 9;
  if (rsiValue < 30) score -= 6;
  if (volumeBoost && item.changePercent > 0) score += 6;
  if (nearBreakout && item.changePercent > 0) score += 6;
  if (extended) score -= 5;

  if (assetClass === "forex" || assetClass === "index") score = 50 + (score - 50) * 0.75;
  if (assetClass === "bond" && item.symbol === "^TNX") score = 50 + (score - 50) * 0.55;

  score = Math.round(clamp(score, 0, 100));

  const short = above20 && macdPositive ? "看漲" : !above20 && !macdPositive ? "看跌" : "中性";
  const medium = above20 && above60 && indicators.return20d >= 0 ? "看漲" : !above20 && !above60 ? "看跌" : "中性";
  const long = above120 && indicators.return60d >= -2 ? "看漲" : !above60 && indicators.return60d < 0 ? "看跌" : "中性";
  const action = actionFromScore(score, assetClass);
  const buyLow = Math.max(0, Math.min(price, support + atrValue * 0.15, price - atrValue * 0.35));
  const buyHigh = Math.max(buyLow, Math.min(price * 1.01, support + atrValue * 0.8));
  const stopLoss = Math.max(0, support - atrValue * 0.7);
  const takeProfit = Math.max(resistance, price + atrValue * 1.8, price * 1.04);
  const sellLow = Math.max(price, resistance - atrValue * 0.15);
  const sellHigh = Math.max(sellLow, takeProfit);

  const reasons = [];
  if (above20) reasons.push("價格站上 20 日均線");
  else reasons.push("價格低於 20 日均線");
  if (above60) reasons.push("中期均線仍有支撐");
  else reasons.push("60 日均線壓力仍在");
  if (macdPositive) reasons.push("MACD 動能偏正");
  else reasons.push("MACD 動能偏弱");
  if (volumeBoost) reasons.push("成交量高於 20 日均量");
  if (nearBreakout) reasons.push("接近 20 日高點區");
  if (rsiValue > 70) reasons.push("RSI 偏高，追價風險增加");
  if (rsiValue < 35) reasons.push("RSI 偏低，需等止跌訊號");

  const risks = [];
  if (extended) risks.push("短線漲幅已偏離均線，適合分批而非一次追高。");
  if (rsiValue > 75) risks.push("RSI 過熱，若量能退潮容易回測支撐。");
  if (!above60) risks.push("中期趨勢尚未轉強，停損需嚴格。");
  if (item.volume && indicators.avgVolume20 && item.volume < indicators.avgVolume20 * 0.65) risks.push("量能低於均量，訊號可信度下降。");
  if (assetClass === "forex") risks.push("外匯受央行政策、利差與國際事件影響，匯率跳動可能很快。");
  if (assetClass === "bond" || item.symbol === "^TNX") risks.push("債券價格與殖利率方向通常相反，需同步觀察升降息預期。");

  return {
    score,
    action,
    trend: { short, medium, long },
    levels: {
      buy: [round(buyLow, 6), round(buyHigh, 6)],
      sell: [round(sellLow, 6), round(sellHigh, 6)],
      takeProfit: round(takeProfit, 6),
      stopLoss: round(stopLoss, 6),
      support: round(support, 6),
      resistance: round(resistance, 6),
    },
    reasons: reasons.slice(0, 6),
    risks: risks.slice(0, 5),
    note: buildRecommendationNote({ ...item, score, trend: { short, medium, long }, action }),
  };
}

function buildRecommendationNote(item) {
  const assetText = item.assetClass === "forex" ? "匯率" : item.assetClass === "bond" ? "利率/債券" : item.assetClass === "fund" ? "ETF/基金" : "價格";
  if (item.score >= 72) return `${assetText}趨勢偏強，可等待回測支撐或放量突破時分批布局。`;
  if (item.score >= 58) return `${assetText}訊號略偏多，適合用區間買點與停損控管風險。`;
  if (item.score >= 43) return `${assetText}處於震盪區，建議等待均線、量能或大盤方向更明確。`;
  return `${assetText}偏弱，保守者以觀望或降低部位為主。`;
}

function actionFromScore(score, assetClass) {
  if (assetClass === "index" || assetClass === "forex") {
    if (score >= 68) return "趨勢偏多";
    if (score <= 42) return "趨勢偏空";
    return "區間觀察";
  }
  if (assetClass === "bond" && score >= 68) return "偏多觀察";
  if (score >= 76) return "積極觀察";
  if (score >= 62) return "分批買進";
  if (score >= 46) return "持有觀察";
  return "保守觀望";
}

function hotStockScore(item) {
  const priceMomentum = Math.max(0, item.changePercent) * 6;
  const trendBonus = item.trend.short === "看漲" ? 12 : item.trend.short === "中性" ? 4 : -8;
  const volumeBonus = item.volume && item.indicators.avgVolume20 && item.volume > item.indicators.avgVolume20 * 1.2 ? 10 : 0;
  const breakoutBonus = item.price >= item.indicators.high20 - Math.max(item.indicators.atr14 || 0, item.price * 0.01) ? 10 : 0;
  return Math.round(clamp(item.score + priceMomentum + trendBonus + volumeBonus + breakoutBonus, 0, 130));
}

async function searchAssets(query) {
  const normalized = query.trim();
  const aliases = aliasMatches(normalized);
  const yahoo = await searchYahoo(normalized, 14, 8);
  const localResults = aliases.map((symbol) => resultFromDirectory(symbol));
  const yahooResults = (yahoo.quotes || []).map(normalizeYahooSearchQuote).filter(Boolean);
  const merged = dedupeBySymbol([...localResults, ...yahooResults]).slice(0, 18);

  return {
    query,
    results: merged,
    news: normalizeYahooNews(yahoo.news || []),
    source: "Yahoo Finance search",
  };
}

async function searchYahoo(query, quotesCount = 10, newsCount = 4) {
  const key = `search:${query}:${quotesCount}:${newsCount}`;
  return cached(key, SEARCH_CACHE_SECONDS, async () => {
    const url = new URL(YAHOO_SEARCH);
    url.searchParams.set("q", query);
    url.searchParams.set("quotesCount", String(quotesCount));
    url.searchParams.set("newsCount", String(newsCount));
    url.searchParams.set("listsCount", "0");
    url.searchParams.set("enableFuzzyQuery", "true");
    url.searchParams.set("quotesQueryId", "tss_match_phrase_query");
    url.searchParams.set("newsQueryId", "news_cie_vespa");

    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MarketAnalyst/1.0",
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Yahoo Finance search 回應 ${response.status}`);
    return data || {};
  });
}

async function searchNews(query, count = 8) {
  const data = await searchYahoo(query, 0, count);
  return normalizeYahooNews(data.news || []).slice(0, count);
}

async function getNewsForInstrument(item) {
  const query = SYMBOL_DIRECTORY.get(item.symbol.toUpperCase())?.yahooQuery || item.yahooName || item.symbol;
  return searchNews(query, 6);
}

function normalizeYahooSearchQuote(quote) {
  if (!quote?.symbol) return null;
  const symbol = normalizeSymbol(quote.symbol);
  const directory = SYMBOL_DIRECTORY.get(symbol.toUpperCase());
  const assetClass = directory?.assetClass || classifyAsset(quote.quoteType, symbol);
  return {
    symbol,
    name: directory?.zhName || quote.longname || quote.shortname || symbol,
    yahooName: quote.longname || quote.shortname || directory?.zhName || symbol,
    exchange: quote.exchDisp || quote.exchange || "",
    quoteType: quote.quoteType || "",
    assetClass,
    category: directory?.category || categoryFromAssetClass(assetClass),
    market: directory?.market || marketFromSearch(quote, symbol),
    source: "Yahoo Finance search",
  };
}

function normalizeYahooNews(news) {
  return news
    .filter((item) => item?.title && item?.link)
    .map((item) => ({
      title: item.title,
      publisher: item.publisher || "",
      link: item.link,
      publishedAt: item.providerPublishTime ? new Date(item.providerPublishTime * 1000).toISOString() : null,
      thumbnail: item.thumbnail?.resolutions?.[0]?.url || "",
      source: "Yahoo Finance search",
    }));
}

function resultFromDirectory(symbol) {
  const normalized = normalizeSymbol(symbol);
  const directory = SYMBOL_DIRECTORY.get(normalized.toUpperCase()) || {};
  return {
    symbol: normalized,
    name: directory.zhName || normalized,
    yahooName: directory.yahooQuery || directory.zhName || normalized,
    exchange: "",
    quoteType: directory.assetClass || "",
    assetClass: directory.assetClass || "unknown",
    category: directory.category || categoryFromAssetClass(directory.assetClass),
    market: directory.market || "",
    source: "local alias + Yahoo symbol",
  };
}

function aliasMatches(query) {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, "");
  const matches = new Set();
  if (ALIAS_SYMBOLS.has(normalized)) matches.add(ALIAS_SYMBOLS.get(normalized));

  for (const [key, symbol] of ALIAS_SYMBOLS.entries()) {
    const compactKey = key.toLowerCase().replace(/\s+/g, "");
    if (compactKey.includes(normalized) || normalized.includes(compactKey)) {
      matches.add(symbol);
    }
  }

  const asSymbol = normalizePotentialSymbol(query);
  if (asSymbol) matches.add(asSymbol);

  for (const [symbol, details] of SYMBOL_DIRECTORY.entries()) {
    const haystack = `${symbol} ${details.zhName || ""} ${details.yahooQuery || ""}`.toLowerCase();
    if (haystack.includes(query.toLowerCase())) matches.add(details.symbol || symbol);
  }

  return [...matches];
}

function normalizePotentialSymbol(input) {
  const raw = input.trim().toUpperCase();
  if (!raw) return "";
  if (/^\d{4,6}$/.test(raw)) return `${raw}.TW`;
  if (/^\d{4,6}\.(TW|TWO)$/.test(raw)) return raw;
  if (/^[A-Z][A-Z0-9.-]{0,12}(=X)?$/.test(raw)) return raw;
  if (/^\^[A-Z0-9]+$/.test(raw)) return raw;
  return "";
}

function normalizeSymbol(symbol) {
  const raw = String(symbol || "").trim();
  if (!raw) return "";
  const alias = ALIAS_SYMBOLS.get(raw.toLowerCase().replace(/\s+/g, ""));
  if (alias) return alias;
  if (/^\d{4,6}$/.test(raw)) return `${raw}.TW`;
  return raw.toUpperCase();
}

function splitSymbols(input) {
  return String(input)
    .split(/[\s,，、;；|]+/)
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .map(normalizeSymbol);
}

function dedupeBySymbol(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = String(item.symbol || "").toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function findSymbol(items, symbol) {
  const normalized = symbol.toUpperCase();
  return items.find((item) => String(item.symbol || "").toUpperCase() === normalized || String(item.requestedSymbol || "").toUpperCase() === normalized);
}

function classifyAsset(instrumentType, symbol) {
  const type = String(instrumentType || "").toUpperCase();
  if (symbol.endsWith("=X")) return "forex";
  if (symbol.startsWith("^")) return symbol === "^TNX" ? "bond" : "index";
  if (type.includes("CURRENCY")) return "forex";
  if (type.includes("ETF") || type.includes("MUTUAL")) return "fund";
  if (type.includes("INDEX")) return "index";
  if (type.includes("FUTURE")) return "commodity";
  if (type.includes("BOND")) return "bond";
  return "stock";
}

function categoryFromAssetClass(assetClass) {
  switch (assetClass) {
    case "stock":
      return "股票";
    case "fund":
      return "基金/ETF";
    case "bond":
      return "債券";
    case "forex":
      return "外匯";
    case "index":
      return "大盤";
    case "commodity":
      return "原物料";
    default:
      return "其他";
  }
}

function marketFromMeta(meta, symbol) {
  if (symbol.endsWith(".TW") || symbol.endsWith(".TWO") || meta.exchangeTimezoneName === "Asia/Taipei") return "台股";
  if (meta.exchangeTimezoneName === "America/New_York" || meta.exchangeName === "NMS" || meta.exchangeName === "NYQ") return "美股";
  if (meta.instrumentType === "CURRENCY") return "外匯";
  return meta.fullExchangeName || meta.exchangeName || "";
}

function marketFromSearch(quote, symbol) {
  if (symbol.endsWith(".TW") || symbol.endsWith(".TWO")) return "台股";
  if (["NMS", "NYQ", "ASE", "NASDAQ", "NYSE"].includes(String(quote.exchange || "").toUpperCase())) return "美股";
  if (symbol.endsWith("=X")) return "外匯";
  return quote.exchDisp || quote.exchange || "";
}

function marketStateFromMeta(meta) {
  const regular = meta.currentTradingPeriod?.regular;
  if (!regular?.start || !regular?.end) return "未知";
  const now = Date.now() / 1000;
  if (now >= regular.start && now <= regular.end) return "交易中";
  return "休市";
}

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  return average(values.slice(-period));
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((total, value) => total + value, 0) / valid.length;
}

function emaSeries(values, period) {
  const output = [];
  const multiplier = 2 / (period + 1);
  let previous = null;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      output.push(null);
      continue;
    }
    previous = previous === null ? value : value * multiplier + previous * (1 - multiplier);
    output.push(previous);
  }
  return output;
}

function rsi(values, period) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const relativeStrength = avgGain / avgLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function atr(candles, period) {
  if (candles.length <= period) return null;
  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const row = candles[index];
    const previousClose = candles[index - 1].close;
    const high = Number.isFinite(row.high) ? row.high : row.close;
    const low = Number.isFinite(row.low) ? row.low : row.close;
    trueRanges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  return average(trueRanges.slice(-period));
}

function returnPercent(values, days) {
  if (values.length <= days) return 0;
  const current = values.at(-1);
  const previous = values.at(-days - 1);
  if (!previous) return 0;
  return ((current - previous) / previous) * 100;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      output[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function cached(key, seconds, worker) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await worker();
  cache.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
  return value;
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    ...COMMON_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendText(res, text, status = 200) {
  res.writeHead(status, {
    ...COMMON_HEADERS,
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;

    const key = trimmed.slice(0, equalIndex).trim();
    const rawValue = trimmed.slice(equalIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
