const state = {
  refreshSeconds: 30,
  remaining: 30,
  timer: null,
  portfolio: null,
  shareOverrides: new Map(),
  celebrated: false,
  confettiFrame: null,
  savingSnapshot: false,
  statusRestoreTimer: null
};

const el = {
  shell: document.querySelector(".shell"),
  totalProfit: document.querySelector("#totalProfit"),
  totalRate: document.querySelector("#totalRate"),
  dayProfit: document.querySelector("#dayProfit"),
  marketValue: document.querySelector("#marketValue"),
  costAmount: document.querySelector("#costAmount"),
  visualRatio: document.querySelector("#visualRatio"),
  allocationBars: document.querySelector("#allocationBars"),
  holdings: document.querySelector("#holdings"),
  statusText: document.querySelector("#statusText"),
  sourceText: document.querySelector("#sourceText"),
  countdown: document.querySelector("#countdown"),
  refreshButton: document.querySelector("#refreshButton"),
  saveButton: document.querySelector("#saveButton"),
  celebration: document.querySelector("#celebration"),
  celebrationClose: document.querySelector("#celebrationClose"),
  celebrationAmount: document.querySelector("#celebrationAmount"),
  confettiCanvas: document.querySelector("#confettiCanvas")
};

function formatCny(value, options = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  const digits = options.compact ? 0 : 2;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(2);
}

function signedCny(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatCny(value)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function toneClass(value) {
  return value < 0 ? "loss" : "profit";
}

function setTone(node, value) {
  node.classList.toggle("loss", value < 0);
  node.classList.toggle("profit", value >= 0);
}

function formatChinaTime(iso) {
  if (!iso) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

function holdingKey(item) {
  return item.displayCode || item.windCode || `${item.code}.${item.market || ""}`;
}

function parseShares(value) {
  const shares = Number(value);
  if (!Number.isFinite(shares) || shares < 0) return 0;
  return shares;
}

function summarize(items) {
  const costAmount = items.reduce((sum, item) => sum + item.costAmount, 0);
  const marketValue = items.reduce((sum, item) => sum + item.marketValue, 0);
  const profit = marketValue - costAmount;
  const profitRate = costAmount ? (profit / costAmount) * 100 : 0;
  const dayProfit = items.reduce((sum, item) => sum + (item.dayProfit ?? 0), 0);

  return {
    costAmount,
    marketValue,
    profit,
    profitRate,
    dayProfit
  };
}

function computeHolding(item) {
  const key = holdingKey(item);
  const shares = state.shareOverrides.has(key)
    ? state.shareOverrides.get(key)
    : item.shares;
  const costAmount = shares * item.costPrice;
  const marketValue = shares * item.lastPrice;
  const profit = marketValue - costAmount;
  const profitRate = costAmount ? (profit / costAmount) * 100 : 0;
  const dayProfit = item.change === null ? null : item.change * shares;

  return {
    ...item,
    key,
    serverShares: item.shares,
    shares,
    costAmount,
    marketValue,
    profit,
    profitRate,
    dayProfit
  };
}

function computedPortfolio() {
  if (!state.portfolio) return null;
  const holdings = state.portfolio.holdings.map(computeHolding);
  return {
    ...state.portfolio,
    holdings,
    summary: summarize(holdings)
  };
}

function renderBars(holdings, total) {
  el.allocationBars.innerHTML = "";
  const safeTotal = total > 0 ? total : 0;

  holdings.forEach((item) => {
    const segment = document.createElement("div");
    segment.className = "bar-segment";
    segment.style.width = safeTotal
      ? `${Math.max(2, (item.marketValue / safeTotal) * 100)}%`
      : `${100 / Math.max(1, holdings.length)}%`;
    segment.title = `${item.name} ${formatCny(item.marketValue)}`;
    el.allocationBars.append(segment);
  });
}

function renderSummary(data) {
  const summary = data.summary;
  const profitClass = toneClass(summary.profit);

  el.totalProfit.textContent = signedCny(summary.profit);
  el.totalProfit.classList.toggle("loss", summary.profit < 0);
  el.totalRate.textContent = `收益率 ${formatPercent(summary.profitRate)}`;
  el.dayProfit.textContent = `今日 ${signedCny(summary.dayProfit)}`;
  el.dayProfit.className = toneClass(summary.dayProfit);
  el.marketValue.textContent = formatCny(summary.marketValue);
  el.costAmount.textContent = formatCny(summary.costAmount);
  el.visualRatio.textContent = `${data.holdings.length} 只持仓`;
  el.totalRate.className = profitClass;

  renderBars(data.holdings, summary.marketValue);
}

function renderStatus(data) {
  const latestQuoteTime = data.holdings
    .map((item) => item.quoteTime)
    .filter(Boolean)
    .sort()
    .at(-1);

  el.statusText.textContent = data.errors?.length
    ? `已更新，${data.errors.length} 只暂时失败`
    : "行情已更新";
  el.sourceText.textContent = `${data.source} · 行情 ${formatChinaTime(latestQuoteTime)} · 页面 ${formatChinaTime(data.computedAt)}`;
}

function showSnapshotSaved() {
  window.clearTimeout(state.statusRestoreTimer);
  window.setTimeout(() => {
    el.statusText.textContent = "截图已生成";
  }, 0);
  state.statusRestoreTimer = window.setTimeout(() => {
    const data = computedPortfolio();
    if (data) renderStatus(data);
  }, 2400);
}

function renderHoldings(holdings) {
  el.holdings.innerHTML = "";

  holdings.forEach((item) => {
    const card = document.createElement("article");
    card.className = "stock-card";
    card.dataset.key = item.key;
    const profitClass = toneClass(item.profit);
    const changeClass = toneClass(item.changePercent || 0);
    const displayCode = item.displayCode || item.windCode || item.code;

    card.innerHTML = `
      <div class="stock-head">
        <div class="stock-title">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(displayCode)} · 成本 ${formatPrice(item.costPrice)}</span>
        </div>
        <div class="price-box">
          <strong>${formatPrice(item.lastPrice)}</strong>
          <span class="chip ${changeClass}">${formatPercent(item.changePercent)}</span>
        </div>
      </div>
      <label class="shares-row">
        <span>股数</span>
        <input
          class="shares-input"
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          data-key="${escapeHtml(item.key)}"
          value="${Number(item.shares).toString()}"
        >
      </label>
      <div class="stock-grid">
        <div class="stock-stat">
          <span class="stock-label">累计收益</span>
          <strong class="${profitClass}" data-field="profit">${signedCny(item.profit)}</strong>
        </div>
        <div class="stock-stat">
          <span class="stock-label">收益率</span>
          <strong class="${profitClass}" data-field="profitRate">${formatPercent(item.profitRate)}</strong>
        </div>
        <div class="stock-stat">
          <span class="stock-label">市值</span>
          <strong data-field="marketValue">${formatCny(item.marketValue)}</strong>
        </div>
      </div>
    `;

    el.holdings.append(card);
  });
}

function updateHoldingStats(holdings) {
  holdings.forEach((item) => {
    const card = Array.from(el.holdings.querySelectorAll(".stock-card"))
      .find((node) => node.dataset.key === item.key);
    if (!card) return;

    const profit = card.querySelector('[data-field="profit"]');
    const profitRate = card.querySelector('[data-field="profitRate"]');
    const marketValue = card.querySelector('[data-field="marketValue"]');

    profit.textContent = signedCny(item.profit);
    profitRate.textContent = formatPercent(item.profitRate);
    marketValue.textContent = formatCny(item.marketValue);
    setTone(profit, item.profit);
    setTone(profitRate, item.profitRate);
  });
}

function render(data, options = {}) {
  renderSummary(data);
  renderStatus(data);

  if (options.rebuildHoldings) {
    renderHoldings(data.holdings);
  } else {
    updateHoldingStats(data.holdings);
  }
}

function renderCurrentView(options = {}) {
  const data = computedPortfolio();
  if (!data) return;
  render(data, options);
}

function maybeCelebrate(data) {
  if (state.celebrated || data.summary.dayProfit <= 0) return;
  state.celebrated = true;
  showCelebration(data.summary.dayProfit);
}

function resizeConfettiCanvas() {
  const ratio = window.devicePixelRatio || 1;
  el.confettiCanvas.width = Math.floor(window.innerWidth * ratio);
  el.confettiCanvas.height = Math.floor(window.innerHeight * ratio);
  el.confettiCanvas.style.width = `${window.innerWidth}px`;
  el.confettiCanvas.style.height = `${window.innerHeight}px`;
  return ratio;
}

function showCelebration(dayProfit) {
  el.celebrationAmount.textContent = `今日 ${signedCny(dayProfit)}`;
  el.celebration.hidden = false;
  startConfetti();
}

function hideCelebration() {
  el.celebration.hidden = true;
  if (state.confettiFrame) {
    cancelAnimationFrame(state.confettiFrame);
    state.confettiFrame = null;
  }
}

function startConfetti() {
  const ctx = el.confettiCanvas.getContext("2d");
  const ratio = resizeConfettiCanvas();
  const colors = ["#d62027", "#f2c94c", "#2662d9", "#16875a", "#ff7a59"];
  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random() * el.confettiCanvas.width,
    y: -Math.random() * el.confettiCanvas.height * 0.35,
    size: (6 + Math.random() * 9) * ratio,
    speed: (2.2 + Math.random() * 4.5) * ratio,
    drift: (-1.8 + Math.random() * 3.6) * ratio,
    rotation: Math.random() * Math.PI,
    spin: -0.08 + Math.random() * 0.16,
    color: colors[Math.floor(Math.random() * colors.length)]
  }));
  const startedAt = performance.now();
  const duration = 3600;

  function draw(now) {
    const progress = Math.min(1, (now - startedAt) / duration);
    ctx.clearRect(0, 0, el.confettiCanvas.width, el.confettiCanvas.height);

    particles.forEach((particle) => {
      particle.y += particle.speed;
      particle.x += particle.drift;
      particle.rotation += particle.spin;

      if (particle.y > el.confettiCanvas.height + 20 * ratio) {
        particle.y = -20 * ratio;
        particle.x = Math.random() * el.confettiCanvas.width;
      }

      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.globalAlpha = 1 - Math.max(0, progress - 0.72) / 0.28;
      ctx.fillStyle = particle.color;
      ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
      ctx.restore();
    });

    if (progress < 1 && !el.celebration.hidden) {
      state.confettiFrame = requestAnimationFrame(draw);
      return;
    }

    state.confettiFrame = null;
    ctx.clearRect(0, 0, el.confettiCanvas.width, el.confettiCanvas.height);
  }

  if (state.confettiFrame) cancelAnimationFrame(state.confettiFrame);
  state.confettiFrame = requestAnimationFrame(draw);
}

function downloadCanvas(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("截图生成失败"));
        return;
      }

      const date = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `trading-genius-${date}.png`;

      if ("download" in HTMLAnchorElement.prototype) {
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        window.open(url, "_blank", "noopener");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      resolve();
    }, "image/png", 1);
  });
}

async function captureDomSnapshot() {
  if (typeof window.html2canvas !== "function") {
    throw new Error("html2canvas unavailable");
  }

  document.body.classList.add("is-capturing");
  await new Promise((resolve) => requestAnimationFrame(resolve));

  return window.html2canvas(el.shell, {
    backgroundColor: "#f8f9fb",
    logging: false,
    scale: Math.min(3, window.devicePixelRatio || 2),
    useCORS: true
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawCard(ctx, x, y, width, height) {
  ctx.save();
  ctx.shadowColor = "rgba(21, 23, 26, 0.08)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x, y, width, height, 18);
  ctx.fill();
  ctx.restore();
}

function drawText(ctx, text, x, y, font, color, align = "left") {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

function captureCanvasFallback() {
  const data = computedPortfolio();
  const width = 1080;
  const height = 520 + data.holdings.length * 260;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f8f9fb";
  ctx.fillRect(0, 0, width, height);
  drawText(ctx, "交易天才", 54, 52, "800 78px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a");

  drawCard(ctx, 54, 160, 972, 220);
  drawText(ctx, "累计收益", 94, 202, "500 32px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
  drawText(ctx, signedCny(data.summary.profit), 94, 250, "850 82px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", data.summary.profit < 0 ? "#16875a" : "#d62027");
  drawText(ctx, `收益率 ${formatPercent(data.summary.profitRate)}`, 94, 334, "700 32px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", data.summary.profit < 0 ? "#16875a" : "#d62027");
  drawText(ctx, `今日 ${signedCny(data.summary.dayProfit)}`, 986, 334, "700 32px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", data.summary.dayProfit < 0 ? "#16875a" : "#d62027", "right");

  drawCard(ctx, 54, 410, 466, 120);
  drawText(ctx, "当前市值", 94, 442, "500 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
  drawText(ctx, formatCny(data.summary.marketValue), 94, 482, "800 34px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a");
  drawCard(ctx, 560, 410, 466, 120);
  drawText(ctx, "投入成本", 600, 442, "500 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
  drawText(ctx, formatCny(data.summary.costAmount), 600, 482, "800 34px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a");

  let y = 570;
  data.holdings.forEach((item) => {
    drawCard(ctx, 54, y, 972, 210);
    drawText(ctx, item.name, 94, y + 34, "800 42px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a");
    drawText(ctx, `${item.displayCode || item.windCode || item.code} · ${item.shares} 股 · 成本 ${formatPrice(item.costPrice)}`, 94, y + 88, "500 26px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
    drawText(ctx, formatPrice(item.lastPrice), 986, y + 34, "850 46px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a", "right");
    drawText(ctx, formatPercent(item.changePercent), 986, y + 92, "800 26px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", item.changePercent < 0 ? "#16875a" : "#d62027", "right");
    drawText(ctx, "累计收益", 94, y + 146, "500 24px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
    drawText(ctx, signedCny(item.profit), 94, y + 176, "800 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", item.profit < 0 ? "#16875a" : "#d62027");
    drawText(ctx, "收益率", 394, y + 146, "500 24px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
    drawText(ctx, formatPercent(item.profitRate), 394, y + 176, "800 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", item.profitRate < 0 ? "#16875a" : "#d62027");
    drawText(ctx, "市值", 694, y + 146, "500 24px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
    drawText(ctx, formatCny(item.marketValue), 694, y + 176, "800 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a");
    y += 250;
  });

  return canvas;
}

async function saveSnapshot() {
  if (state.savingSnapshot) return;
  state.savingSnapshot = true;
  el.saveButton.disabled = true;

  try {
    let canvas;
    try {
      canvas = await captureDomSnapshot();
    } catch {
      canvas = captureCanvasFallback();
    }
    await downloadCanvas(canvas);
    showSnapshotSaved();
  } finally {
    document.body.classList.remove("is-capturing");
    el.saveButton.disabled = false;
    state.savingSnapshot = false;
  }
}

async function requestSaveSnapshot() {
  try {
    await saveSnapshot();
  } catch (error) {
    el.statusText.textContent = "截图生成失败";
    el.sourceText.textContent = error.message;
  }
}

async function loadPortfolio() {
  el.refreshButton.disabled = true;
  el.statusText.textContent = "正在读取行情...";

  try {
    const response = await fetch("/api/portfolio", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok && !data.holdings?.length) {
      throw new Error(data.error || "行情读取失败");
    }

    state.portfolio = data;
    state.shareOverrides = new Map();
    state.refreshSeconds = Number(data.refreshSeconds || 30);
    state.remaining = state.refreshSeconds;
    const computed = computedPortfolio();
    render(computed, { rebuildHoldings: true });
    maybeCelebrate(computed);
  } catch (error) {
    el.statusText.textContent = "行情暂时读取失败";
    el.sourceText.textContent = error.message;
  } finally {
    el.refreshButton.disabled = false;
    updateCountdown();
  }
}

function updateCountdown() {
  el.countdown.textContent = `${state.remaining}s`;
}

function startTimer() {
  window.clearInterval(state.timer);
  state.timer = window.setInterval(() => {
    state.remaining -= 1;
    if (state.remaining <= 0) {
      loadPortfolio();
      return;
    }
    updateCountdown();
  }, 1000);
}

el.holdings.addEventListener("input", (event) => {
  const input = event.target.closest(".shares-input");
  if (!input) return;
  state.shareOverrides.set(input.dataset.key, parseShares(input.value));
  renderCurrentView();
});

el.refreshButton.addEventListener("click", () => {
  state.remaining = state.refreshSeconds;
  loadPortfolio();
});

el.saveButton.addEventListener("click", () => {
  requestSaveSnapshot();
});

window.addEventListener("save-trading-genius-snapshot", () => {
  requestSaveSnapshot();
});

el.celebrationClose.addEventListener("click", hideCelebration);
el.celebration.addEventListener("click", (event) => {
  if (event.target === el.celebration) hideCelebration();
});

window.addEventListener("resize", () => {
  if (!el.celebration.hidden) resizeConfettiCanvas();
});

loadPortfolio();
startTimer();
