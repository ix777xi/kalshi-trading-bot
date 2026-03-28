import type { Express } from "express";
import { getAuthHeaders } from "./kalshi-auth";
import { createServer, type Server } from "http";
import { storage, db, sqlite } from "./storage";
import {
  positions, orders, signals, agents, portfolio, pnlHistory,
  riskConfig, auditLog, backtestResults, equityCurve, settings,
} from "@shared/schema";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// Simple in-memory cache
const cache: Record<string, { data: unknown; ts: number }> = {};
const CACHE_TTL = 10_000; // 10 seconds

async function kalshiFetch(path: string): Promise<unknown> {
  const key = path;
  const now = Date.now();
  if (cache[key] && now - cache[key].ts < CACHE_TTL) {
    return cache[key].data;
  }
  const res = await fetch(`${KALSHI_BASE}${path}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "KalshiTradingBot/1.0",
    },
  });
  if (!res.ok) {
    throw new Error(`Kalshi API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  cache[key] = { data, ts: now };
  return data;
}

function seedDatabase() {
  const existing = db.select().from(portfolio).get();
  if (existing) return;

  console.log("Seeding database with mock data...");

  const now = new Date();
  const fmt = (d: Date) => d.toISOString();
  const ago = (mins: number) => fmt(new Date(now.getTime() - mins * 60_000));
  const daysAgo = (d: number) => fmt(new Date(now.getTime() - d * 86400_000));

  db.insert(portfolio).values({
    totalBalance: 12847.32,
    unrealizedPnl: 384.21,
    realizedPnl: 1923.45,
    totalReturn: 18.47,
    winRate: 63.2,
    sharpeRatio: 1.84,
    maxDrawdown: 8.3,
    activePositions: 12,
    botStatus: "running",
    updatedAt: fmt(now),
  }).run();

  let cumPnl = 0;
  let bal = 11000;
  for (let i = 90; i >= 0; i--) {
    const daily = (Math.random() - 0.38) * 80;
    cumPnl += daily;
    bal += daily;
    db.insert(pnlHistory).values({
      timestamp: daysAgo(i),
      cumulativePnl: parseFloat(cumPnl.toFixed(2)),
      dailyPnl: parseFloat(daily.toFixed(2)),
      balance: parseFloat(bal.toFixed(2)),
    }).run();
  }

  const agentData = [
    { name: "Market Scanner", status: "healthy", latencyMs: 42, messagesProcessed: 8432, errorCount: 2, description: "Scans Kalshi markets for opportunities" },
    { name: "Probability Engine", status: "healthy", latencyMs: 180, messagesProcessed: 3241, errorCount: 0, description: "LLM-based probability estimation" },
    { name: "Opportunity Detector", status: "healthy", latencyMs: 65, messagesProcessed: 2981, errorCount: 5, description: "Identifies edge above threshold" },
    { name: "Trade Executor", status: "idle", latencyMs: 12, messagesProcessed: 487, errorCount: 1, description: "Places and manages orders" },
    { name: "Risk Manager", status: "healthy", latencyMs: 28, messagesProcessed: 9102, errorCount: 0, description: "Enforces risk limits" },
  ];
  for (const a of agentData) {
    db.insert(agents).values({ ...a, lastHeartbeat: ago(Math.floor(Math.random() * 3)) }).run();
  }

  const categories = ["politics", "economics", "sports", "weather", "technology", "finance"];
  const sides: string[] = ["yes", "no"];
  const tickers = [
    "PRES-2024-D", "FED-RATE-JUL", "NBA-EAST-BOS", "TEMP-NYC-JUL",
    "AAPL-1T-2024", "BTC-100K-Q3", "UK-ELEC-LAB", "GDP-US-Q2",
    "SUPERBOWL-KC", "CPI-3PCT-AUG", "EURO24-ESP", "OIL-80-Q4",
    "SENATE-DEM", "NVDA-500B", "RAIN-LA-JUN", "FED-HIKE-SEP",
    "NFLX-200M", "TSLA-250", "EURO-PAR", "UNEM-4PCT",
  ];
  const titleMap: Record<string, string> = {
    "PRES-2024-D": "Dem wins 2024 Presidential",
    "FED-RATE-JUL": "Fed cuts rates in July",
    "NBA-EAST-BOS": "Celtics win Eastern Conf",
    "TEMP-NYC-JUL": "NYC avg temp above 85F July",
    "AAPL-1T-2024": "Apple hits $1T market cap",
    "BTC-100K-Q3": "Bitcoin above $100K in Q3",
    "UK-ELEC-LAB": "Labour wins UK Election",
    "GDP-US-Q2": "US GDP growth above 2.5%",
    "SUPERBOWL-KC": "Chiefs win Super Bowl LIX",
    "CPI-3PCT-AUG": "CPI below 3% in August",
    "EURO24-ESP": "Spain wins Euro 2024",
    "OIL-80-Q4": "Crude Oil above $80 Q4",
    "SENATE-DEM": "Democrats hold Senate",
    "NVDA-500B": "Nvidia market cap $500B+",
    "RAIN-LA-JUN": "Rain in LA in June",
    "FED-HIKE-SEP": "Fed hikes in September",
    "NFLX-200M": "Netflix reaches 200M subs",
    "TSLA-250": "Tesla above $250 Q3",
    "EURO-PAR": "Euro parity with USD",
    "UNEM-4PCT": "Unemployment above 4%",
  };

  for (let i = 0; i < 20; i++) {
    const ticker = tickers[i];
    const entry = parseFloat((0.2 + Math.random() * 0.6).toFixed(3));
    const current = parseFloat((entry * (0.85 + Math.random() * 0.3)).toFixed(3));
    const qty = Math.floor(10 + Math.random() * 140);
    const upnl = parseFloat(((current - entry) * qty * 100).toFixed(2));
    const pct = parseFloat((((current - entry) / entry) * 100).toFixed(2));
    db.insert(positions).values({
      ticker,
      title: titleMap[ticker] || ticker,
      side: sides[i % 2],
      quantity: qty,
      entryPrice: entry,
      currentPrice: current,
      unrealizedPnl: upnl,
      pnlPct: pct,
      category: categories[i % categories.length],
      kellyFraction: parseFloat((0.25 + Math.random() * 0.25).toFixed(3)),
      openedAt: daysAgo(Math.floor(Math.random() * 30)),
    }).run();
  }

  const statuses = ["filled", "filled", "filled", "cancelled", "open", "open", "partial", "rejected"];
  for (let i = 0; i < 50; i++) {
    const tickerIdx = Math.floor(Math.random() * tickers.length);
    const status = statuses[i % statuses.length];
    const qty = Math.floor(5 + Math.random() * 95);
    const filled = status === "filled" ? qty : status === "partial" ? Math.floor(qty * 0.5) : 0;
    const createdAt = daysAgo(Math.floor(Math.random() * 14));
    db.insert(orders).values({
      orderId: `ORD-${100000 + i}`,
      ticker: tickers[tickerIdx],
      side: sides[i % 2],
      type: i % 3 === 0 ? "market" : "limit",
      price: parseFloat((0.2 + Math.random() * 0.6).toFixed(3)),
      quantity: qty,
      filledQty: filled,
      status,
      createdAt,
      updatedAt: createdAt,
    }).run();
  }

  const signalTypes = ["BUY_YES", "BUY_NO", "NO_TRADE"];
  const models = ["GPT-4o", "Claude-3.5", "LLM-Ensemble", "GPT-4o-mini"];
  for (let i = 0; i < 100; i++) {
    const mktPrice = parseFloat((0.2 + Math.random() * 0.6).toFixed(3));
    const trueProb = parseFloat(Math.max(0.01, Math.min(0.99, mktPrice + (Math.random() - 0.5) * 0.25)).toFixed(3));
    const edge = parseFloat(((trueProb - mktPrice) * 100).toFixed(2));
    const signalType = edge > 3 ? "BUY_YES" : edge < -3 ? "BUY_NO" : "NO_TRADE";
    db.insert(signals).values({
      ticker: tickers[i % tickers.length],
      edgeScore: edge,
      trueProbability: trueProb,
      marketPrice: mktPrice,
      signalType,
      modelConfidence: parseFloat((0.6 + Math.random() * 0.35).toFixed(3)),
      modelName: models[i % models.length],
      createdAt: ago(i * 15),
    }).run();
  }

  db.insert(riskConfig).values({
    maxPositionPct: 5,
    maxCategoryExposurePct: 20,
    kellyFractionMin: 0.25,
    kellyFractionMax: 0.5,
    stopLossThreshold: 50,
    takeProfitTarget: 75,
    maxDrawdownPause: 10,
    dailyVaR: 2.5,
    updatedAt: fmt(now),
  }).run();

  const auditEntries = [
    { eventType: "ORDER_PLACED", ticker: "FED-RATE-JUL", description: "Limit order placed: BUY YES 50 @ $0.42", status: "ok", amount: 2100 },
    { eventType: "ORDER_FILLED", ticker: "FED-RATE-JUL", description: "Order ORD-100042 fully filled @ $0.42", status: "ok", amount: 2100 },
    { eventType: "RISK_BREACH", ticker: "BTC-100K-Q3", description: "Category exposure limit approached: 18.2% of 20%", status: "warning", amount: null },
    { eventType: "BOT_CONTROL", ticker: null, description: "Bot status changed to RUNNING", status: "ok", amount: null },
    { eventType: "ORDER_CANCELLED", ticker: "NBA-EAST-BOS", description: "Order ORD-100021 cancelled: price moved", status: "ok", amount: null },
    { eventType: "POSITION_CLOSED", ticker: "EURO24-ESP", description: "Position closed at profit: +$124.50", status: "ok", amount: 124.50 },
    { eventType: "ORDER_PLACED", ticker: "GDP-US-Q2", description: "Market order placed: BUY NO 30", status: "ok", amount: 1050 },
    { eventType: "RISK_BREACH", ticker: null, description: "Daily drawdown threshold warning: 7.8% of 10%", status: "warning", amount: null },
    { eventType: "POSITION_OPENED", ticker: "TSLA-250", description: "New position: YES 25 @ $0.38 (Kelly 32%)", status: "ok", amount: 950 },
    { eventType: "ORDER_FILLED", ticker: "NVDA-500B", description: "Order ORD-100087 partially filled: 15/30", status: "ok", amount: 570 },
  ];
  for (let i = 0; i < auditEntries.length * 4; i++) {
    const ev = auditEntries[i % auditEntries.length];
    db.insert(auditLog).values({
      ...ev,
      amount: ev.amount ?? null,
      ticker: ev.ticker ?? null,
      createdAt: ago(i * 18),
    }).run();
  }

  const btId = db.insert(backtestResults).values({
    runName: "Full Backtest Q1-Q3 2024",
    startDate: "2024-01-01",
    endDate: "2024-09-30",
    winRate: 61.8,
    roi: 23.4,
    sharpeRatio: 1.76,
    maxDrawdown: 11.2,
    totalTrades: 342,
    brierScore: 0.187,
    createdAt: daysAgo(5),
  }).returning().get().id;

  const bt2Id = db.insert(backtestResults).values({
    runName: "Walk-Forward Q3 2024",
    startDate: "2024-07-01",
    endDate: "2024-09-30",
    winRate: 58.3,
    roi: 8.7,
    sharpeRatio: 1.42,
    maxDrawdown: 6.8,
    totalTrades: 89,
    brierScore: 0.201,
    createdAt: daysAgo(2),
  }).returning().get().id;

  let eq1 = 10000;
  let eq2 = 10000;
  for (let i = 0; i <= 270; i++) {
    const d = daysAgo(270 - i + 5);
    const change1 = (Math.random() - 0.42) * 120;
    const change2 = (Math.random() - 0.46) * 60;
    eq1 = Math.max(8000, eq1 + change1);
    eq2 = Math.max(9000, eq2 + change2);
    db.insert(equityCurve).values({
      backtestId: btId,
      timestamp: d,
      equity: parseFloat(eq1.toFixed(2)),
      benchmark: parseFloat((10000 + i * 2.5).toFixed(2)),
    }).run();
    if (i >= 180) {
      db.insert(equityCurve).values({
        backtestId: bt2Id,
        timestamp: d,
        equity: parseFloat(eq2.toFixed(2)),
        benchmark: parseFloat((10000 + (i - 180) * 2.5).toFixed(2)),
      }).run();
    }
  }

  db.insert(settings).values({
    kalshiApiKey: "",
    kalshiApiKeyId: "1cbe4de4-dd64-4243-9484-985c01617912",
    kalshiPrivateKey: "",
    notifyOnSignal: true,
    notifyOnFill: true,
    minEdgeAlert: 5,
    scanFrequency: 30,
    llmModel: "gpt-4o",
    updatedAt: fmt(now),
  }).run();

  console.log("Seed complete.");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  sqlite_migrate();
  seedDatabase();

  // ── Kalshi API Proxy ─────────────────────────────────────────────────────
  const ACTIVE_SERIES = [
    "KXHIGHNY", "KXNBAGAME", "KXNBAPTS", "KXFEDRATE",
    "KXCPI", "KXINX", "KXNFLGAME", "KXGDP"
  ];

  app.get("/api/kalshi/markets", async (req, res) => {
    try {
      const { status = "open", limit = "100", cursor, series_ticker } = req.query;

      // If a specific series is requested, use it directly
      if (series_ticker) {
        let path = `/markets?status=${status}&limit=${limit}&series_ticker=${series_ticker}`;
        if (cursor) path += `&cursor=${cursor}`;
        const data = await kalshiFetch(path);
        return res.json(data);
      }

      // Fetch from multiple active series in parallel
      const seriesFetches = ACTIVE_SERIES.map(async (series) => {
        try {
          const result = await kalshiFetch(`/markets?status=open&limit=20&series_ticker=${series}`) as any;
          return (result?.markets || []) as any[];
        } catch {
          return [] as any[];
        }
      });

      // Also fetch generic open markets as fallback
      const genericFetch = kalshiFetch(`/markets?status=open&limit=50`).then((d: any) => d?.markets || []).catch(() => []);

      const [genericMarkets, ...seriesResults] = await Promise.all([genericFetch, ...seriesFetches]);

      // Merge: series-specific first (they have real volume), then deduplicate
      const seenTickers = new Set<string>();
      const merged: any[] = [];

      // Add series markets first (prioritized)
      for (const batch of seriesResults) {
        for (const m of batch) {
          if (!seenTickers.has(m.ticker)) {
            seenTickers.add(m.ticker);
            merged.push(m);
          }
        }
      }

      // Add generic markets (skip empty MVE/parlay ones)
      for (const m of genericMarkets as any[]) {
        if (!seenTickers.has(m.ticker)) {
          const vol = parseFloat(m.volume_fp || "0");
          if (vol > 0) {
            seenTickers.add(m.ticker);
            merged.push(m);
          }
        }
      }

      // Sort by volume descending
      merged.sort((a, b) => {
        const va = parseFloat(a.volume_fp || "0");
        const vb = parseFloat(b.volume_fp || "0");
        return vb - va;
      });

      res.json({ markets: merged, cursor: undefined });
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  app.get("/api/kalshi/markets/:ticker", async (req, res) => {
    try {
      const data = await kalshiFetch(`/markets/${req.params.ticker}`);
      res.json(data);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  app.get("/api/kalshi/markets/:ticker/orderbook", async (req, res) => {
    try {
      const depth = req.query.depth || "10";
      const data = await kalshiFetch(`/markets/${req.params.ticker}/orderbook?depth=${depth}`);
      res.json(data);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  app.get("/api/kalshi/trades", async (req, res) => {
    try {
      const limit = req.query.limit || "50";
      const data = await kalshiFetch(`/markets/trades?limit=${limit}`);
      res.json(data);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // ── Portfolio ─────────────────────────────────────────────────────────────
  app.get("/api/portfolio", async (_req, res) => {
    const p = await storage.getPortfolio();
    const hist = await storage.getPnlHistory();
    res.json({ portfolio: p, pnlHistory: hist });
  });

  app.post("/api/bot/control", async (req, res) => {
    const { action } = req.body;
    if (!["running", "paused", "stopped"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }
    await storage.updateBotStatus(action);
    await storage.createAuditLog({
      eventType: "BOT_CONTROL",
      ticker: null,
      description: `Bot status changed to ${action.toUpperCase()}`,
      amount: null,
      status: "ok",
      createdAt: new Date().toISOString(),
    });
    res.json({ status: action });
  });

  app.get("/api/positions", async (_req, res) => {
    res.json(await storage.getPositions());
  });

  app.get("/api/orders", async (_req, res) => {
    res.json(await storage.getOrders());
  });

  app.post("/api/orders", async (req, res) => {
    try {
      const order = await storage.createOrder({
        ...req.body,
        orderId: `ORD-${Date.now()}`,
        filledQty: 0,
        status: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      res.json(order);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/orders/:id", async (req, res) => {
    await storage.cancelOrder(parseInt(req.params.id));
    res.json({ success: true });
  });

  app.get("/api/signals", async (_req, res) => {
    res.json(await storage.getSignals());
  });

  app.get("/api/agents", async (_req, res) => {
    res.json(await storage.getAgents());
  });

  app.get("/api/risk/config", async (_req, res) => {
    res.json(await storage.getRiskConfig());
  });

  app.put("/api/risk/config", async (req, res) => {
    res.json(await storage.updateRiskConfig(req.body));
  });

  app.get("/api/audit", async (_req, res) => {
    res.json(await storage.getAuditLog());
  });

  app.get("/api/backtest/results", async (_req, res) => {
    const results = await storage.getBacktestResults();
    const withCurves = await Promise.all(
      results.map(async (r) => ({
        ...r,
        equityCurve: await storage.getEquityCurve(r.id),
      }))
    );
    res.json(withCurves);
  });


  // ── Settings with private key masking ─────────────────────────────────────
  // Override default settings GET to never expose the private key
  app.get("/api/settings", async (_req, res) => {
    const s = await storage.getSettings();
    if (!s) return res.json(null);
    // Strip private key, return hasPrivateKey boolean instead
    const { kalshiPrivateKey, ...rest } = s as any;
    res.json({ ...rest, hasPrivateKey: !!(kalshiPrivateKey && kalshiPrivateKey.trim().length > 0) });
  });

  app.put("/api/settings", async (req, res) => {
    const body = req.body;
    // Handle clear private key request
    if (body.clearPrivateKey === true) {
      body.kalshiPrivateKey = "";
      delete body.clearPrivateKey;
    } else {
      // Only update private key if it was actually sent (non-empty)
      if (body.kalshiPrivateKey === undefined || body.kalshiPrivateKey === "••••••••") {
        delete body.kalshiPrivateKey;
      }
    }
    const updated = await storage.updateSettings(body);
    // Return masked version
    const { kalshiPrivateKey, ...rest } = updated as any;
    res.json({ ...rest, hasPrivateKey: !!(kalshiPrivateKey && kalshiPrivateKey.trim().length > 0) });
  });

  // ── Live Trading Proxy Routes ─────────────────────────────────────────────
  const KALSHI_API_BASE = "https://api.elections.kalshi.com";
  const KALSHI_API_PATH = "/trade-api/v2";

  async function getKalshiCredentials(): Promise<{ apiKeyId: string; privateKey: string } | null> {
    const s = await storage.getSettings();
    if (!s) return null;
    const privateKey = (s as any).kalshiPrivateKey || "";
    const apiKeyId = s.kalshiApiKeyId || "";
    if (!privateKey.trim() || !apiKeyId.trim()) return null;
    return { apiKeyId, privateKey };
  }

  async function kalshiAuthFetch(
    method: string,
    apiPath: string,
    body?: unknown
  ): Promise<{ ok: boolean; status: number; data: unknown }> {
    const creds = await getKalshiCredentials();
    if (!creds) {
      return { ok: false, status: 400, data: { error: "Configure your RSA private key in Settings" } };
    }
    const fullPath = `${KALSHI_API_PATH}${apiPath}`;
    try {
      const headers = getAuthHeaders(creds.apiKeyId, creds.privateKey, method, fullPath);
      const fetchOptions: RequestInit = { method, headers };
      if (body !== undefined) {
        fetchOptions.body = JSON.stringify(body);
      }
      const resp = await fetch(`${KALSHI_API_BASE}${fullPath}`, fetchOptions);
      const data = await resp.json();
      return { ok: resp.ok, status: resp.status, data };
    } catch (e: any) {
      return { ok: false, status: 502, data: { error: e.message } };
    }
  }

  // GET /api/live/test — test connection by calling balance
  app.get("/api/live/test", async (_req, res) => {
    const result = await kalshiAuthFetch("GET", "/portfolio/balance");
    if (!result.ok) {
      return res.status(result.status).json(result.data);
    }
    res.json(result.data);
  });

  // GET /api/live/balance
  app.get("/api/live/balance", async (_req, res) => {
    const result = await kalshiAuthFetch("GET", "/portfolio/balance");
    res.status(result.status).json(result.data);
  });

  // GET /api/live/positions
  app.get("/api/live/positions", async (_req, res) => {
    const result = await kalshiAuthFetch("GET", "/portfolio/positions?settlement_status=unsettled");
    res.status(result.status).json(result.data);
  });

  // GET /api/live/orders
  app.get("/api/live/orders", async (req, res) => {
    const status = req.query.status || "resting";
    const result = await kalshiAuthFetch("GET", `/portfolio/orders?status=${status}`);
    res.status(result.status).json(result.data);
  });

  // GET /api/live/fills
  app.get("/api/live/fills", async (_req, res) => {
    const result = await kalshiAuthFetch("GET", "/portfolio/fills?limit=100");
    res.status(result.status).json(result.data);
  });

  // POST /api/live/orders — create order
  app.post("/api/live/orders", async (req, res) => {
    const result = await kalshiAuthFetch("POST", "/portfolio/orders", req.body);
    res.status(result.status).json(result.data);
  });

  // DELETE /api/live/orders — cancel all orders
  app.delete("/api/live/orders", async (_req, res) => {
    const result = await kalshiAuthFetch("DELETE", "/portfolio/orders");
    res.status(result.status).json(result.data);
  });

  // DELETE /api/live/orders/:orderId — cancel specific order
  app.delete("/api/live/orders/:orderId", async (req, res) => {
    const result = await kalshiAuthFetch("DELETE", `/portfolio/orders/${req.params.orderId}`);
    res.status(result.status).json(result.data);
  });

  // PUT /api/live/orders/:orderId — amend order
  app.put("/api/live/orders/:orderId", async (req, res) => {
    const result = await kalshiAuthFetch("PUT", `/portfolio/orders/${req.params.orderId}`, req.body);
    res.status(result.status).json(result.data);
  });

  return httpServer;
}

function sqlite_migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_balance REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      realized_pnl REAL NOT NULL,
      total_return REAL NOT NULL,
      win_rate REAL NOT NULL,
      sharpe_ratio REAL NOT NULL,
      max_drawdown REAL NOT NULL,
      active_positions INTEGER NOT NULL,
      bot_status TEXT NOT NULL DEFAULT 'running',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pnl_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      cumulative_pnl REAL NOT NULL,
      daily_pnl REAL NOT NULL,
      balance REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      title TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      pnl_pct REAL NOT NULL,
      category TEXT NOT NULL,
      kelly_fraction REAL NOT NULL,
      opened_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL UNIQUE,
      ticker TEXT NOT NULL,
      side TEXT NOT NULL,
      type TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      filled_qty INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      edge_score REAL NOT NULL,
      true_probability REAL NOT NULL,
      market_price REAL NOT NULL,
      signal_type TEXT NOT NULL,
      model_confidence REAL NOT NULL,
      model_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      last_heartbeat TEXT NOT NULL,
      messages_processed INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS risk_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      max_position_pct REAL NOT NULL DEFAULT 5,
      max_category_exposure_pct REAL NOT NULL DEFAULT 20,
      kelly_fraction_min REAL NOT NULL DEFAULT 0.25,
      kelly_fraction_max REAL NOT NULL DEFAULT 0.5,
      stop_loss_threshold REAL NOT NULL DEFAULT 50,
      take_profit_target REAL NOT NULL DEFAULT 75,
      max_drawdown_pause REAL NOT NULL DEFAULT 10,
      daily_var REAL NOT NULL DEFAULT 2.5,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      ticker TEXT,
      description TEXT NOT NULL,
      amount REAL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS backtest_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      win_rate REAL NOT NULL,
      roi REAL NOT NULL,
      sharpe_ratio REAL NOT NULL,
      max_drawdown REAL NOT NULL,
      total_trades INTEGER NOT NULL,
      brier_score REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS equity_curve (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backtest_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      equity REAL NOT NULL,
      benchmark REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kalshi_api_key TEXT NOT NULL DEFAULT '',
      kalshi_api_key_id TEXT NOT NULL DEFAULT '',
      kalshi_private_key TEXT NOT NULL DEFAULT '',
      notify_on_signal INTEGER NOT NULL DEFAULT 1,
      notify_on_fill INTEGER NOT NULL DEFAULT 1,
      min_edge_alert REAL NOT NULL DEFAULT 5,
      scan_frequency INTEGER NOT NULL DEFAULT 30,
      llm_model TEXT NOT NULL DEFAULT 'gpt-4o',
      updated_at TEXT NOT NULL
    );

  `);
  // Add new columns for existing databases (ALTER TABLE IF NOT EXISTS not supported in SQLite)
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN kalshi_private_key TEXT NOT NULL DEFAULT ''"); } catch {}
}
