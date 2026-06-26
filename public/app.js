const state = {
  refreshSeconds: 30,
  remaining: 30,
  timer: null
};

const el = {
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
  refreshButton: document.querySelector("#refreshButton")
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

function toneClass(value) {
  return value < 0 ? "loss" : "profit";
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

function renderBars(holdings, total) {
  el.allocationBars.innerHTML = "";
  holdings.forEach((item) => {
    const segment = document.createElement("div");
    segment.className = "bar-segment";
    segment.style.width = `${Math.max(2, (item.marketValue / total) * 100)}%`;
    segment.title = `${item.name} ${formatCny(item.marketValue)}`;
    el.allocationBars.append(segment);
  });
}

function renderHoldings(holdings) {
  el.holdings.innerHTML = "";

  holdings.forEach((item) => {
    const card = document.createElement("article");
    card.className = "stock-card";
    const profitClass = toneClass(item.profit);
    const changeClass = toneClass(item.changePercent || 0);

    card.innerHTML = `
      <div class="stock-head">
        <div class="stock-title">
          <strong>${item.name}</strong>
          <span>${item.code} · ${item.shares} 股 · 成本 ${formatPrice(item.costPrice)}</span>
        </div>
        <div class="price-box">
          <strong>${formatPrice(item.lastPrice)}</strong>
          <span class="chip ${changeClass}">${formatPercent(item.changePercent)}</span>
        </div>
      </div>
      <div class="stock-grid">
        <div class="stock-stat">
          <span class="stock-label">累计收益</span>
          <strong class="${profitClass}">${signedCny(item.profit)}</strong>
        </div>
        <div class="stock-stat">
          <span class="stock-label">收益率</span>
          <strong class="${profitClass}">${formatPercent(item.profitRate)}</strong>
        </div>
        <div class="stock-stat">
          <span class="stock-label">市值</span>
          <strong>${formatCny(item.marketValue)}</strong>
        </div>
      </div>
    `;

    el.holdings.append(card);
  });
}

function render(data) {
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

  renderBars(data.holdings, summary.marketValue || 1);
  renderHoldings(data.holdings);

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

async function loadPortfolio() {
  el.refreshButton.disabled = true;
  el.statusText.textContent = "正在读取行情...";

  try {
    const response = await fetch("/api/portfolio", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok && !data.holdings?.length) {
      throw new Error(data.error || "行情读取失败");
    }
    state.refreshSeconds = Number(data.refreshSeconds || 30);
    state.remaining = state.refreshSeconds;
    render(data);
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

el.refreshButton.addEventListener("click", () => {
  state.remaining = state.refreshSeconds;
  loadPortfolio();
});

loadPortfolio();
startTimer();
