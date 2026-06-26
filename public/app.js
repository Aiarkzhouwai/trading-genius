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
  const numeric = Number(value);
  if (value === null || value === undefined || Number.isNaN(numeric)) return "--";
  const compactFrom = options.compactFrom ?? 100_000;
  const shouldCompact = options.compact === true
    || (options.compact !== false && Math.abs(numeric) >= compactFrom);
  if (shouldCompact) {
    const sign = numeric < 0 ? "-" : "";
    return `${sign}¥${formatChineseAmount(Math.abs(numeric))}`;
  }

  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numeric);
}

function formatChineseAmount(value) {
  const units = [
    { value: 100_000_000, label: "亿" },
    { value: 10_000, label: "万" }
  ];
  const unit = units.find((item) => value >= item.value);
  if (!unit) {
    return new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 2
    }).format(value);
  }

  const scaled = value / unit.value;
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}${unit.label}`;
}

function exactCny(value) {
  return formatCny(value, { compact: false });
}

function formatShares(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  if (Math.abs(numeric) >= 10_000) {
    const sign = numeric < 0 ? "-" : "";
    return `${sign}${formatChineseAmount(Math.abs(numeric))}`;
  }
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0
  }).format(numeric);
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

function signedCny(value, options = {}) {
  const numeric = Number(value);
  if (value === null || value === undefined || Number.isNaN(numeric)) return "--";
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${formatCny(numeric, options)}`;
}

function exactSignedCny(value) {
  return signedCny(value, { compact: false });
}

function setAmountText(node, text, exactText = text) {
  node.textContent = text;
  node.title = exactText;
}

function svgEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
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

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function dayChangeFor(item) {
  const serverDayChange = finiteNumber(item.dayChange);
  if (serverDayChange !== null) return serverDayChange;

  const lastPrice = finiteNumber(item.lastPrice);
  const costPrice = finiteNumber(item.costPrice);
  if (item.dayBaseline === "cost" && lastPrice !== null && costPrice !== null) {
    return lastPrice - costPrice;
  }

  const quoteChange = finiteNumber(item.change);
  if (quoteChange !== null) return quoteChange;

  if (lastPrice !== null && costPrice !== null) {
    return lastPrice - costPrice;
  }

  return null;
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
  const dayChange = dayChangeFor(item);
  const dayProfit = dayChange === null ? null : dayChange * shares;

  return {
    ...item,
    key,
    serverShares: item.shares,
    shares,
    costAmount,
    marketValue,
    profit,
    profitRate,
    dayChange,
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
    segment.title = `${item.name} ${exactCny(item.marketValue)}`;
    el.allocationBars.append(segment);
  });
}

function renderKlineChart(item) {
  const candles = Array.isArray(item.dailyKline) ? item.dailyKline.filter((row) => (
    Number.isFinite(Number(row.open))
    && Number.isFinite(Number(row.close))
    && Number.isFinite(Number(row.high))
    && Number.isFinite(Number(row.low))
  )) : [];

  if (candles.length < 2) {
    return `
      <div class="kline-panel is-empty">
        <div class="kline-heading">
          <span>近40日K线</span>
          <strong>K线暂不可用</strong>
        </div>
        <div class="kline-empty">行情源暂时没有返回日K数据</div>
      </div>
    `;
  }

  const width = 320;
  const height = 126;
  const top = 12;
  const bottom = 24;
  const left = 8;
  const right = 8;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const lows = candles.map((row) => Number(row.low));
  const highs = candles.map((row) => Number(row.high));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;
  const step = chartWidth / Math.max(1, candles.length - 1);
  const bodyWidth = Math.max(2.4, Math.min(7, step * 0.56));
  const priceY = (price) => top + ((max - price) / range) * chartHeight;
  const grid = [0.25, 0.5, 0.75].map((ratio) => {
    const y = top + chartHeight * ratio;
    return `<line x1="${left}" y1="${y.toFixed(2)}" x2="${width - right}" y2="${y.toFixed(2)}" class="kline-grid-line" />`;
  }).join("");

  const candleNodes = candles.map((row, index) => {
    const open = Number(row.open);
    const close = Number(row.close);
    const high = Number(row.high);
    const low = Number(row.low);
    const x = left + index * step;
    const highY = priceY(high);
    const lowY = priceY(low);
    const openY = priceY(open);
    const closeY = priceY(close);
    const bodyY = Math.min(openY, closeY);
    const bodyHeight = Math.max(1.6, Math.abs(openY - closeY));
    const tone = close >= open ? "up" : "down";
    return `
      <g class="kline-candle ${tone}">
        <line x1="${x.toFixed(2)}" y1="${highY.toFixed(2)}" x2="${x.toFixed(2)}" y2="${lowY.toFixed(2)}" />
        <rect x="${(x - bodyWidth / 2).toFixed(2)}" y="${bodyY.toFixed(2)}" width="${bodyWidth.toFixed(2)}" height="${bodyHeight.toFixed(2)}" rx="0.8" />
      </g>
    `;
  }).join("");

  const last = candles.at(-1);
  const firstDate = candles[0].date?.slice(5) || "";
  const lastDate = last.date?.slice(5) || "";
  const lastClose = Number(last.close);
  const previousClose = Number(candles.at(-2)?.close);
  const trend = Number.isFinite(previousClose) && previousClose !== 0
    ? ((lastClose - previousClose) / previousClose) * 100
    : null;
  const trendClass = trend !== null && trend < 0 ? "loss" : "profit";

  return `
    <div class="kline-panel">
      <div class="kline-heading">
        <span>近${candles.length}日K线</span>
        <strong class="${trendClass}">${formatPrice(lastClose)}${trend === null ? "" : ` · ${formatPercent(trend)}`}</strong>
      </div>
      <svg class="kline-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${svgEscape(item.name)}近${candles.length}日K线">
        <rect x="0" y="0" width="${width}" height="${height}" class="kline-bg" />
        ${grid}
        ${candleNodes}
        <text x="${left}" y="${height - 9}" class="kline-axis">${svgEscape(firstDate)}</text>
        <text x="${width - right}" y="${height - 9}" class="kline-axis end">${svgEscape(lastDate)}</text>
        <text x="${width - right}" y="${top + 2}" class="kline-price end">高 ${formatPrice(max)}</text>
        <text x="${width - right}" y="${top + chartHeight - 13}" class="kline-price end">低 ${formatPrice(min)}</text>
      </svg>
    </div>
  `;
}

function renderSummary(data) {
  const summary = data.summary;
  const profitClass = toneClass(summary.profit);

  setAmountText(el.totalProfit, signedCny(summary.profit), exactSignedCny(summary.profit));
  el.totalProfit.classList.toggle("loss", summary.profit < 0);
  el.totalRate.textContent = `收益率 ${formatPercent(summary.profitRate)}`;
  el.totalRate.title = `收益率 ${formatPercent(summary.profitRate)}`;
  setAmountText(el.dayProfit, `今日 ${signedCny(summary.dayProfit)}`, `今日 ${exactSignedCny(summary.dayProfit)}`);
  el.dayProfit.className = toneClass(summary.dayProfit);
  setAmountText(el.marketValue, formatCny(summary.marketValue), exactCny(summary.marketValue));
  setAmountText(el.costAmount, formatCny(summary.costAmount), exactCny(summary.costAmount));
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

function showSnapshotSaved(message = "截图已生成", detail = "如未自动进入相册，请在手机保存或分享面板里选择保存图片。") {
  window.clearTimeout(state.statusRestoreTimer);
  window.setTimeout(() => {
    el.statusText.textContent = message;
    el.sourceText.textContent = detail;
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
          <strong class="amount-fit">${formatPrice(item.lastPrice)}</strong>
          <span class="chip ${changeClass}">${formatPercent(item.changePercent)}</span>
        </div>
      </div>
      ${renderKlineChart(item)}
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
          <strong class="${profitClass} amount-fit" data-field="profit" title="${escapeHtml(exactSignedCny(item.profit))}">${signedCny(item.profit)}</strong>
        </div>
        <div class="stock-stat">
          <span class="stock-label">收益率</span>
          <strong class="${profitClass} amount-fit" data-field="profitRate" title="${escapeHtml(formatPercent(item.profitRate))}">${formatPercent(item.profitRate)}</strong>
        </div>
        <div class="stock-stat">
          <span class="stock-label">市值</span>
          <strong class="amount-fit" data-field="marketValue" title="${escapeHtml(exactCny(item.marketValue))}">${formatCny(item.marketValue)}</strong>
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

    setAmountText(profit, signedCny(item.profit), exactSignedCny(item.profit));
    setAmountText(profitRate, formatPercent(item.profitRate), formatPercent(item.profitRate));
    setAmountText(marketValue, formatCny(item.marketValue), exactCny(item.marketValue));
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

function snapshotFileName() {
  const date = new Date().toISOString().slice(0, 10);
  return `holdings-${date}.png`;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("截图生成失败"));
        return;
      }
      resolve(blob);
    }, "image/png", 1);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;

  if ("download" in HTMLAnchorElement.prototype) {
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function saveCanvasToDevice(canvas) {
  const blob = await canvasToBlob(canvas);
  const filename = snapshotFileName();
  const file = typeof File === "function"
    ? new File([blob], filename, { type: "image/png" })
    : null;
  const canShareFile = file
    && typeof navigator.canShare === "function"
    && navigator.canShare({ files: [file] })
    && typeof navigator.share === "function";

  if (canShareFile) {
    try {
      await navigator.share({
        files: [file],
        title: "持仓收益截图"
      });
      return {
        message: "已打开系统保存/分享面板",
        detail: "在手机面板里选择保存图片或存储到照片。"
      };
    } catch (error) {
      if (error.name === "AbortError") {
        return {
          message: "已取消保存",
          detail: "需要时可以再点保存截图。"
        };
      }
    }
  }

  downloadBlob(blob, filename);
  return {
    message: "截图已生成",
    detail: "如未自动进入相册，请在下载记录或打开的图片里保存到相册。"
  };
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

function clipCanvasText(ctx, text, maxWidth) {
  if (!maxWidth) return String(text);
  const raw = String(text);
  if (ctx.measureText(raw).width <= maxWidth) return raw;

  let clipped = raw;
  while (clipped.length > 1 && ctx.measureText(`${clipped}...`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}...`;
}

function drawText(ctx, text, x, y, font, color, align = "left", maxWidth = null) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillText(clipCanvasText(ctx, text, maxWidth), x, y);
}

function drawKlineCanvas(ctx, candles, x, y, width, height) {
  const rows = Array.isArray(candles) ? candles.filter((row) => (
    Number.isFinite(Number(row.open))
    && Number.isFinite(Number(row.close))
    && Number.isFinite(Number(row.high))
    && Number.isFinite(Number(row.low))
  )) : [];

  ctx.save();
  ctx.fillStyle = "#fafbfc";
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();

  if (rows.length < 2) {
    drawText(ctx, "K线暂不可用", x + width / 2, y + height / 2 - 16, "600 26px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a", "center", width - 40);
    ctx.restore();
    return;
  }

  const paddingTop = 18;
  const paddingBottom = 28;
  const paddingX = 12;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingTop - paddingBottom;
  const lows = rows.map((row) => Number(row.low));
  const highs = rows.map((row) => Number(row.high));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;
  const yFor = (price) => y + paddingTop + ((max - price) / range) * chartHeight;
  const step = chartWidth / Math.max(1, rows.length - 1);
  const bodyWidth = Math.max(4, Math.min(12, step * 0.55));

  ctx.strokeStyle = "#e9ecf1";
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach((ratio) => {
    const gridY = y + paddingTop + chartHeight * ratio;
    ctx.beginPath();
    ctx.moveTo(x + paddingX, gridY);
    ctx.lineTo(x + width - paddingX, gridY);
    ctx.stroke();
  });

  rows.forEach((row, index) => {
    const open = Number(row.open);
    const close = Number(row.close);
    const high = Number(row.high);
    const low = Number(row.low);
    const candleX = x + paddingX + index * step;
    const highY = yFor(high);
    const lowY = yFor(low);
    const openY = yFor(open);
    const closeY = yFor(close);
    const color = close >= open ? "#d62027" : "#16875a";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(candleX, highY);
    ctx.lineTo(candleX, lowY);
    ctx.stroke();
    ctx.fillRect(candleX - bodyWidth / 2, Math.min(openY, closeY), bodyWidth, Math.max(2, Math.abs(openY - closeY)));
  });

  drawText(ctx, rows[0].date?.slice(5) || "", x + paddingX, y + height - 24, "600 20px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
  drawText(ctx, rows.at(-1).date?.slice(5) || "", x + width - paddingX, y + height - 24, "600 20px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a", "right");
  drawText(ctx, `高 ${formatPrice(max)}`, x + width - paddingX, y + 10, "600 20px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a", "right");
  drawText(ctx, `低 ${formatPrice(min)}`, x + width - paddingX, y + height - 50, "600 20px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a", "right");
  ctx.restore();
}

function captureCanvasFallback() {
  const data = computedPortfolio();
  const width = 1080;
  const height = 500 + data.holdings.length * 370;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f8f9fb";
  ctx.fillRect(0, 0, width, height);

  drawCard(ctx, 54, 54, 972, 220);
  drawText(ctx, "累计收益", 94, 96, "500 32px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
  drawText(ctx, signedCny(data.summary.profit), 94, 144, "850 82px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", data.summary.profit < 0 ? "#16875a" : "#d62027", "left", 620);
  drawText(ctx, `收益率 ${formatPercent(data.summary.profitRate)}`, 94, 228, "700 32px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", data.summary.profit < 0 ? "#16875a" : "#d62027", "left", 420);
  drawText(ctx, `今日 ${signedCny(data.summary.dayProfit)}`, 986, 228, "700 32px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", data.summary.dayProfit < 0 ? "#16875a" : "#d62027", "right", 430);

  drawCard(ctx, 54, 304, 466, 120);
  drawText(ctx, "当前市值", 94, 336, "500 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
  drawText(ctx, formatCny(data.summary.marketValue), 94, 376, "800 34px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a", "left", 370);
  drawCard(ctx, 560, 304, 466, 120);
  drawText(ctx, "投入成本", 600, 336, "500 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
  drawText(ctx, formatCny(data.summary.costAmount), 600, 376, "800 34px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a", "left", 370);

  let y = 464;
  data.holdings.forEach((item) => {
    drawCard(ctx, 54, y, 972, 330);
    drawText(ctx, item.name, 94, y + 34, "800 42px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a", "left", 560);
    drawText(ctx, `${item.displayCode || item.windCode || item.code} · ${formatShares(item.shares)} 股 · 成本 ${formatPrice(item.costPrice)}`, 94, y + 88, "500 26px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a", "left", 620);
    drawText(ctx, formatPrice(item.lastPrice), 986, y + 34, "850 46px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a", "right", 260);
    drawText(ctx, formatPercent(item.changePercent), 986, y + 92, "800 26px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", item.changePercent < 0 ? "#16875a" : "#d62027", "right", 220);
    drawText(ctx, "近40日K线", 94, y + 124, "600 22px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
    drawKlineCanvas(ctx, item.dailyKline, 94, y + 154, 892, 116);
    drawText(ctx, "累计收益", 94, y + 282, "500 24px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
    drawText(ctx, signedCny(item.profit), 94, y + 310, "800 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", item.profit < 0 ? "#16875a" : "#d62027", "left", 240);
    drawText(ctx, "收益率", 394, y + 282, "500 24px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
    drawText(ctx, formatPercent(item.profitRate), 394, y + 310, "800 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", item.profitRate < 0 ? "#16875a" : "#d62027", "left", 210);
    drawText(ctx, "市值", 694, y + 282, "500 24px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#69707a");
    drawText(ctx, formatCny(item.marketValue), 694, y + 310, "800 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif", "#15171a", "left", 270);
    y += 370;
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
    const result = await saveCanvasToDevice(canvas);
    showSnapshotSaved(result.message, result.detail);
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
