import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const refreshSeconds = Number(process.env.REFRESH_SECONDS || 30);
const quoteCacheMs = Number(process.env.QUOTE_CACHE_MS || 15_000);

const defaultHoldings = [
  {
    code: "688146",
    market: "SH",
    shares: 300,
    costPrice: 290
  },
  {
    code: "688530",
    market: "SH",
    shares: 200,
    costPrice: 85
  }
];

const holdings = parseHoldings(process.env.HOLDINGS_JSON) ?? defaultHoldings;
let cachedPortfolio = null;
let cachedAt = 0;

function parseHoldings(value) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    return parsed.map((item) => ({
      code: String(item.code).trim(),
      market: String(item.market || inferMarket(item.code)).trim().toUpperCase(),
      shares: Number(item.shares),
      costPrice: Number(item.costPrice)
    })).filter((item) => item.code && item.shares > 0 && item.costPrice > 0);
  } catch {
    return null;
  }
}

function inferMarket(code) {
  const normalized = String(code);
  if (normalized.startsWith("6")) return "SH";
  return "SZ";
}

function secidFor(holding) {
  const market = holding.market || inferMarket(holding.code);
  const prefix = market === "SH" ? "1" : "0";
  return `${prefix}.${holding.code}`;
}

function scaled(value, divisor = 100) {
  if (value === null || value === undefined || value === "-" || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(value) / divisor;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 5000);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url, options = {}) {
  const attempts = Number(options.attempts || 2);
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchWithTimeout(url, options);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  throw lastError;
}

async function fetchEastmoneyQuote(holding) {
  const fields = [
    "f43",
    "f44",
    "f45",
    "f46",
    "f47",
    "f48",
    "f57",
    "f58",
    "f60",
    "f86",
    "f169",
    "f170"
  ].join(",");
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secidFor(holding)}&fields=${fields}`;
  const response = await fetchWithRetry(url, {
    attempts: 2,
    timeoutMs: 5000,
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "trading-genius/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Eastmoney request failed with ${response.status}`);
  }

  const body = await response.json();
  if (body.rc !== 0 || !body.data) {
    throw new Error("Eastmoney response did not include data");
  }

  const data = body.data;
  const lastPrice = scaled(data.f43);
  if (lastPrice === null) {
    throw new Error("Eastmoney response did not include a valid latest price");
  }

  return {
    code: data.f57 || holding.code,
    name: data.f58 || holding.name || holding.code,
    lastPrice,
    previousClose: scaled(data.f60),
    open: scaled(data.f46),
    high: scaled(data.f44),
    low: scaled(data.f45),
    change: scaled(data.f169),
    changePercent: scaled(data.f170),
    volume: Number(data.f47 || 0),
    amount: Number(data.f48 || 0),
    quoteTime: data.f86 ? new Date(Number(data.f86) * 1000).toISOString() : null,
    source: "东方财富"
  };
}

function tencentSymbolFor(holding) {
  const prefix = (holding.market || inferMarket(holding.code)) === "SH" ? "sh" : "sz";
  return `${prefix}${holding.code}`;
}

function parseTencentTime(value) {
  if (!value || value.length < 14) return null;
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(8, 10);
  const minute = value.slice(10, 12);
  const second = value.slice(12, 14);
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`).toISOString();
}

async function fetchTencentQuote(holding) {
  const url = `https://qt.gtimg.cn/q=${tencentSymbolFor(holding)}`;
  const response = await fetchWithRetry(url, {
    attempts: 2,
    timeoutMs: 5000,
    headers: {
      "accept": "text/plain,*/*",
      "user-agent": "trading-genius/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Tencent quote request failed with ${response.status}`);
  }

  const text = new TextDecoder("gb18030").decode(await response.arrayBuffer());
  const raw = text.match(/="([^"]+)"/)?.[1];
  if (!raw) {
    throw new Error("Tencent quote response did not include data");
  }

  const parts = raw.split("~");
  const lastPrice = Number(parts[3]);
  if (!Number.isFinite(lastPrice)) {
    throw new Error("Tencent quote response did not include a valid latest price");
  }

  return {
    code: parts[2] || holding.code,
    name: parts[1] || holding.name || holding.code,
    lastPrice,
    previousClose: Number(parts[4]) || null,
    open: Number(parts[5]) || null,
    high: Number(parts[33]) || null,
    low: Number(parts[34]) || null,
    change: Number(parts[31]) || 0,
    changePercent: Number(parts[32]) || 0,
    volume: Number(parts[6]) || 0,
    amount: Number(parts[37]) || 0,
    quoteTime: parseTencentTime(parts[30]),
    source: "腾讯"
  };
}

async function fetchQuote(holding) {
  try {
    return await fetchEastmoneyQuote(holding);
  } catch (eastmoneyError) {
    try {
      return await fetchTencentQuote(holding);
    } catch (tencentError) {
      throw new Error(`东方财富失败: ${eastmoneyError.message}; 腾讯失败: ${tencentError.message}`);
    }
  }
}

function enrichHolding(holding, quote) {
  const costAmount = holding.shares * holding.costPrice;
  const marketValue = holding.shares * quote.lastPrice;
  const profit = marketValue - costAmount;
  const profitRate = costAmount ? (profit / costAmount) * 100 : 0;
  const dayProfit = quote.change === null ? null : quote.change * holding.shares;

  return {
    ...holding,
    name: quote.name,
    windCode: `${holding.code}.${holding.market}`,
    lastPrice: quote.lastPrice,
    previousClose: quote.previousClose,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    change: quote.change,
    changePercent: quote.changePercent,
    quoteTime: quote.quoteTime,
    source: quote.source,
    costAmount,
    marketValue,
    profit,
    profitRate,
    dayProfit
  };
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

async function buildPortfolio() {
  const now = Date.now();
  if (cachedPortfolio && now - cachedAt < quoteCacheMs) {
    return {
      ...cachedPortfolio,
      cached: true
    };
  }

  const results = await Promise.allSettled(holdings.map(async (holding) => {
    const normalized = {
      ...holding,
      market: holding.market || inferMarket(holding.code)
    };
    const quote = await fetchQuote(normalized);
    return enrichHolding(normalized, quote);
  }));

  const items = [];
  const errors = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(result.value);
    } else {
      errors.push({
        code: holdings[index].code,
        message: result.reason?.message || "行情读取失败"
      });
    }
  });

  const sources = [...new Set(items.map((item) => item.source).filter(Boolean))];
  const payload = {
    title: "交易天才",
    currency: "CNY",
    refreshSeconds,
    source: sources.length ? `${sources.join(" / ")}公开行情接口` : "公开行情接口",
    computedAt: new Date().toISOString(),
    holdings: items,
    summary: summarize(items),
    errors,
    cached: false
  };

  if (items.length > 0) {
    cachedPortfolio = payload;
    cachedAt = now;
  }
  return payload;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const requested = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, requested);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": pathname === "/index.html" ? "no-cache" : "public, max-age=60"
    });
    response.end(content);
  } catch {
    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/portfolio") {
      const payload = await buildPortfolio();
      sendJson(response, payload.holdings.length ? 200 : 503, payload);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, {
      error: "页面暂时无法读取行情",
      message: error.message
    });
  }
});

server.listen(port, () => {
  console.log(`Trading Genius is running on http://localhost:${port}`);
});
