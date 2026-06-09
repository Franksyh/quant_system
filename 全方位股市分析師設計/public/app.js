const symbolsInput = document.querySelector("#symbols");
const minScoreInput = document.querySelector("#min-score");
const refreshSecondsInput = document.querySelector("#refresh-seconds");
const scanNowButton = document.querySelector("#scan-now");
const autoRefreshButton = document.querySelector("#auto-refresh");
const telegramTestButton = document.querySelector("#telegram-test");
const cards = document.querySelector("#cards");
const template = document.querySelector("#stock-card-template");
const marketPill = document.querySelector("#market-pill");
const telegramPill = document.querySelector("#telegram-pill");
const scanTime = document.querySelector("#scan-time");
const candidateCount = document.querySelector("#candidate-count");
const topScore = document.querySelector("#top-score");
const sourceName = document.querySelector("#source-name");
const errorBox = document.querySelector("#error-box");
const generatePromptInput = document.querySelector("#generate-prompt");
const voiceInputButton = document.querySelector("#voice-input");
const generateContentButton = document.querySelector("#generate-content");
const copyContentButton = document.querySelector("#copy-content");
const generatedContent = document.querySelector("#generated-content");
const generationProvider = document.querySelector("#generation-provider");
const voiceStatus = document.querySelector("#voice-status");
const quickPromptButtons = document.querySelectorAll(".quick-prompt");

const STORAGE_KEY = "intraday-stock-radar.symbols";
const PROMPT_STORAGE_KEY = "intraday-stock-radar.generatePrompt";
let autoTimer = null;
let latestItems = [];
let speechRecognition = null;
let isListening = false;

setupSpeechRecognition();
await boot();

scanNowButton.addEventListener("click", () => {
  scan();
});

autoRefreshButton.addEventListener("click", () => {
  const enabled = autoRefreshButton.getAttribute("aria-pressed") !== "true";
  setAutoRefresh(enabled);
});

telegramTestButton.addEventListener("click", () => {
  testTelegram();
});

voiceInputButton.addEventListener("click", () => {
  toggleVoiceInput();
});

generateContentButton.addEventListener("click", () => {
  generateContent();
});

copyContentButton.addEventListener("click", () => {
  copyGeneratedContent();
});

quickPromptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    generatePromptInput.value = button.dataset.prompt || "";
    localStorage.setItem(PROMPT_STORAGE_KEY, generatePromptInput.value);
  });
});

symbolsInput.addEventListener("change", () => {
  localStorage.setItem(STORAGE_KEY, symbolsInput.value);
});

generatePromptInput.addEventListener("change", () => {
  localStorage.setItem(PROMPT_STORAGE_KEY, generatePromptInput.value);
});

async function boot() {
  try {
    const config = await fetchJson("/api/config");
    const savedSymbols = localStorage.getItem(STORAGE_KEY);
    const savedPrompt = localStorage.getItem(PROMPT_STORAGE_KEY);
    symbolsInput.value = savedSymbols || config.defaultWatchlist.join(", ");
    if (savedPrompt) generatePromptInput.value = savedPrompt;
    refreshSecondsInput.value = Math.max(30, Number(config.intervalMinutes || 2) * 60);
    renderConfig(config);
    await scan();
  } catch (error) {
    showError(error);
  }
}

async function scan() {
  hideError();
  scanNowButton.disabled = true;
  scanNowButton.textContent = "掃描中";

  try {
    const query = new URLSearchParams({
      symbols: symbolsInput.value,
      minScore: minScoreInput.value || "0",
    });
    const result = await fetchJson(`/api/scan?${query.toString()}`);
    latestItems = result.items || [];
    renderConfig(result);
    renderCards(latestItems);
  } catch (error) {
    showError(error);
  } finally {
    scanNowButton.disabled = false;
    scanNowButton.textContent = "立即掃描";
  }
}

function renderConfig(config) {
  marketPill.textContent = config.marketOpen ? "盤中" : "非盤中";
  marketPill.className = `pill ${config.marketOpen ? "open" : "closed"}`;

  telegramPill.textContent = config.telegramEnabled ? "Telegram 已啟用" : "Telegram 未設定";
  telegramPill.className = `pill ${config.telegramEnabled ? "open" : "neutral"}`;

  if (config.scannedAt) {
    scanTime.textContent = `掃描 ${formatTime(config.scannedAt)}`;
  }

  candidateCount.textContent = String(config.items?.length ?? latestItems.length ?? 0);
  topScore.textContent = config.items?.length ? String(config.items[0].score) : "--";
  sourceName.textContent = config.source || config.market || "--";
}

function renderCards(items) {
  cards.textContent = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "目前沒有符合條件的盤中訊號。";
    cards.append(empty);
    return;
  }

  items.forEach((item, index) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector(".rank").textContent = String(index + 1).padStart(2, "0");
    card.querySelector("h3").textContent = `${item.name} ${item.symbol}`;
    card.querySelector(".stock-meta").textContent = `${item.exchange}｜${item.tradeDate || "--"} ${
      item.time || "--"
    }`;

    const grade = card.querySelector(".grade");
    grade.textContent = item.grade;
    grade.classList.toggle("hot", item.score >= 68);
    grade.classList.toggle("warm", item.score >= 58 && item.score < 68);

    card.querySelector(".price").textContent = formatPrice(item.price);

    const change = card.querySelector(".change");
    change.textContent = `${formatSigned(item.change)} (${formatSignedPercent(item.changePercent)})`;
    change.className = `change ${item.change >= 0 ? "rise" : "fall"}`;

    card.querySelector(".score").textContent = `${item.score} / 100`;
    card.querySelector(".volume").textContent = formatLots(item.volumeLots);

    const tagContainer = card.querySelector(".tags");
    for (const reason of item.reasons || []) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = reason;
      tagContainer.append(tag);
    }

    const riskContainer = card.querySelector(".risks");
    for (const flag of item.riskFlags || []) {
      const risk = document.createElement("span");
      risk.className = "risk";
      risk.textContent = flag;
      riskContainer.append(risk);
    }

    drawSparkline(card.querySelector(".spark"), item);
    cards.append(card);
  });
}

function drawSparkline(canvas, item) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);

  const low = Number(item.low || item.previousClose || item.price);
  const high = Number(item.high || item.price);
  const previous = Number(item.previousClose || item.price);
  const open = Number(item.open || previous);
  const price = Number(item.price);
  const min = Math.min(low, previous, open, price);
  const max = Math.max(high, previous, open, price);
  const pad = 8;

  const yFor = (value) => {
    if (max === min) return height / 2;
    return height - pad - ((value - min) / (max - min)) * (height - pad * 2);
  };

  context.strokeStyle = "rgba(105, 115, 109, 0.28)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, yFor(previous));
  context.lineTo(width, yFor(previous));
  context.stroke();

  const points = [
    [0, yFor(open)],
    [width * 0.35, yFor(low)],
    [width * 0.68, yFor(high)],
    [width, yFor(price)],
  ];

  context.strokeStyle = item.change >= 0 ? "#c73232" : "#147a50";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  context.fillStyle = item.change >= 0 ? "#c73232" : "#147a50";
  context.beginPath();
  context.arc(width - 3, yFor(price), 4, 0, Math.PI * 2);
  context.fill();
}

function setAutoRefresh(enabled) {
  autoRefreshButton.setAttribute("aria-pressed", String(enabled));

  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }

  if (enabled) {
    const seconds = clamp(Number(refreshSecondsInput.value || 120), 30, 900);
    refreshSecondsInput.value = seconds;
    autoTimer = setInterval(scan, seconds * 1000);
  }
}

async function testTelegram() {
  hideError();
  telegramTestButton.disabled = true;
  telegramTestButton.textContent = "測試中";

  try {
    await fetchJson("/api/telegram/test", { method: "POST" });
    telegramTestButton.textContent = "已送出";
    setTimeout(() => {
      telegramTestButton.textContent = "推播測試";
    }, 1800);
  } catch (error) {
    showError(error);
    telegramTestButton.textContent = "推播測試";
  } finally {
    telegramTestButton.disabled = false;
  }
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    voiceInputButton.disabled = true;
    voiceInputButton.textContent = "語音不支援";
    voiceStatus.textContent = "語音不支援";
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = "zh-TW";
  speechRecognition.interimResults = true;
  speechRecognition.continuous = false;

  let basePrompt = "";

  speechRecognition.addEventListener("start", () => {
    isListening = true;
    basePrompt = generatePromptInput.value.trim();
    voiceInputButton.setAttribute("aria-pressed", "true");
    voiceInputButton.textContent = "停止語音";
    voiceStatus.textContent = "聆聽中";
  });

  speechRecognition.addEventListener("result", (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0]?.transcript || "")
      .join("")
      .trim();

    if (!transcript) return;
    generatePromptInput.value = [basePrompt, transcript].filter(Boolean).join(" ");
  });

  speechRecognition.addEventListener("end", () => {
    isListening = false;
    voiceInputButton.setAttribute("aria-pressed", "false");
    voiceInputButton.textContent = "語音輸入";
    voiceStatus.textContent = "語音待命";
    localStorage.setItem(PROMPT_STORAGE_KEY, generatePromptInput.value);
  });

  speechRecognition.addEventListener("error", (event) => {
    voiceStatus.textContent = event.error === "not-allowed" ? "麥克風未授權" : "語音辨識中斷";
  });
}

function toggleVoiceInput() {
  if (!speechRecognition) return;

  if (isListening) {
    speechRecognition.stop();
    return;
  }

  hideError();
  try {
    speechRecognition.start();
  } catch {
    voiceStatus.textContent = "語音啟動中";
  }
}

async function generateContent() {
  hideError();
  const prompt = generatePromptInput.value.trim();

  if (!prompt) {
    showError(new Error("請先輸入內容需求。"));
    return;
  }

  localStorage.setItem(PROMPT_STORAGE_KEY, prompt);
  generateContentButton.disabled = true;
  generateContentButton.textContent = "生成中";
  generatedContent.textContent = "生成中...";

  try {
    const data = await fetchJson("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        symbols: symbolsInput.value,
      }),
    });

    generatedContent.textContent = data.content || "";
    generationProvider.textContent = data.provider || "local-market-writer";
  } catch (error) {
    showError(error);
    generatedContent.textContent = "生成失敗";
  } finally {
    generateContentButton.disabled = false;
    generateContentButton.textContent = "生成內容";
  }
}

async function copyGeneratedContent() {
  const text = generatedContent.textContent.trim();

  if (!text || text === "尚未生成內容") return;

  try {
    await navigator.clipboard.writeText(text);
    copyContentButton.textContent = "已複製";
    setTimeout(() => {
      copyContentButton.textContent = "複製內容";
    }, 1600);
  } catch {
    showError(new Error("瀏覽器未允許剪貼簿存取，請手動選取內容複製。"));
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `伺服器回應 ${response.status}`);
  }

  return data;
}

function showError(error) {
  errorBox.hidden = false;
  errorBox.textContent = error instanceof Error ? error.message : String(error);
}

function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function formatTime(iso) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function formatPrice(value) {
  return Number(value).toLocaleString("zh-TW", {
    minimumFractionDigits: Number(value) >= 100 ? 1 : 2,
    maximumFractionDigits: 2,
  });
}

function formatSigned(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(2)}`;
}

function formatSignedPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(2)}%`;
}

function formatLots(value) {
  return `${Number(value || 0).toLocaleString("zh-TW")} 張`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
