import type { Express } from "express";
import { getAuthHeaders } from "./kalshi-auth";
import { createServer, type Server } from "http";
import { storage, db, sqlite } from "./storage";
import {
  positions, orders, signals, agents, portfolio, pnlHistory,
  riskConfig, auditLog, backtestResults, equityCurve, settings, pendingTrades,
} from "@shared/schema";
import { generateLiveSignals, type PositionInfo } from "./signal-engine";

function getPositionsForRiskCheck(): PositionInfo[] {
  try {
    const rows = db.select().from(positions).all();
    return rows.map(r => ({
      ticker: r.ticker,
      title: r.title,
      side: r.side,
      entryPrice: r.entryPrice,
      quantity: r.quantity,
    }));
  } catch {
    return [];
  }
}
import { randomUUID } from "crypto";

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
    // Try live signals first, fall back to DB
    try {
      const liveSignals = await generateLiveSignals(getPositionsForRiskCheck());
      if (liveSignals.length > 0) {
        return res.json(liveSignals.map((s, idx) => ({ ...s, id: idx + 1 })));
      }
    } catch (e) {
      console.error("[/api/signals] Live engine error, falling back to DB:", e);
    }
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

  // ── Pending Trades API ───────────────────────────────────────────────────
  app.get("/api/pending-trades", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const trades = await storage.getPendingTrades(status);
      res.json(trades);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/pending-trades/:id/approve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const trade = await storage.getPendingTradeById(id);
      if (!trade) return res.status(404).json({ error: "Trade not found" });
      if (trade.status !== "pending" && trade.status !== "modified") {
        return res.status(400).json({ error: "Trade is not in pending/modified state" });
      }

      const now = new Date().toISOString();
      await storage.updatePendingTradeStatus(id, "approved", { decidedAt: now });

      // Try to execute via Kalshi API
      const creds = await getKalshiCredentials();
      if (!creds) {
        await storage.updatePendingTradeStatus(id, "failed", { errorMessage: "Configure API key first" });
        return res.status(400).json({ error: "Configure your RSA private key in Settings to execute trades" });
      }

      const isYes = trade.side === "yes";
      const isSell = trade.action === "sell";
      const orderBody: any = {
        ticker: trade.ticker,
        side: trade.side,
        action: isSell ? "sell" : "buy",
        count: trade.contracts,
        type: "limit",
        client_order_id: randomUUID(),
        post_only: !isSell, // Sell orders use IOC for faster exit
        ...(isSell ? { reduce_only: true } : {}),
      };
      if (isYes) {
        orderBody.yes_price = trade.priceCents;
      } else {
        orderBody.no_price = 100 - trade.priceCents;
      }

      const result = await kalshiAuthFetch("POST", "/portfolio/orders", orderBody);
      if (result.ok) {
        const orderId = (result.data as any)?.order?.order_id || (result.data as any)?.order_id || "unknown";
        await storage.updatePendingTradeStatus(id, "executed", {
          orderId,
          executedAt: new Date().toISOString(),
        });
        res.json({ success: true, orderId, trade: await storage.getPendingTradeById(id) });
      } else {
        const errMsg = (result.data as any)?.detail || (result.data as any)?.error || JSON.stringify(result.data);
        await storage.updatePendingTradeStatus(id, "failed", { errorMessage: errMsg });
        res.status(result.status).json({ error: errMsg, trade: await storage.getPendingTradeById(id) });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/pending-trades/:id/reject", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const trade = await storage.getPendingTradeById(id);
      if (!trade) return res.status(404).json({ error: "Trade not found" });
      const now = new Date().toISOString();
      const updated = await storage.updatePendingTradeStatus(id, "rejected", { decidedAt: now });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/pending-trades/:id/modify", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const trade = await storage.getPendingTradeById(id);
      if (!trade) return res.status(404).json({ error: "Trade not found" });

      const { contracts, priceCents } = req.body;
      await storage.updatePendingTrade(id, {
        contracts: contracts !== undefined ? parseInt(contracts) : undefined,
        priceCents: priceCents !== undefined ? parseInt(priceCents) : undefined,
      });
      const updated = await storage.updatePendingTradeStatus(id, "modified");
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Live Signals (from signal engine) ────────────────────────────────────
  // Cache for live signals
  let signalCache: { data: any[]; ts: number } | null = null;
  const SIGNAL_CACHE_TTL = 60_000;

  async function getCachedSignals() {
    const now = Date.now();
    if (signalCache && now - signalCache.ts < SIGNAL_CACHE_TTL) {
      return signalCache.data;
    }
    try {
      const liveSignals = await generateLiveSignals(getPositionsForRiskCheck());
      signalCache = { data: liveSignals, ts: now };
      return liveSignals;
    } catch (e) {
      console.error("[Signal Engine] Failed:", e);
      return signalCache?.data || [];
    }
  }

  // Override the existing /api/signals endpoint with live data
  app.get("/api/signals/live", async (_req, res) => {
    try {
      const liveSignals = await getCachedSignals();
      res.json({
        signals: liveSignals,
        count: liveSignals.length,
        cachedAt: signalCache?.ts ? new Date(signalCache.ts).toISOString() : null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Bot Config ────────────────────────────────────────────────────────────
  app.get("/api/bot/config", async (_req, res) => {
    const s = await storage.getSettings();
    if (!s) return res.json({ botMode: "hitl", autoMinEdge: 5, autoMinConfidence: 75, autoMaxContracts: 50, autoMaxCost: 50, dailyLossLimit: 500, maxDrawdownLimit: 20 });
    res.json({
      botMode: (s as any).botMode || "hitl",
      autoMinEdge: (s as any).autoMinEdge ?? 5,
      autoMinConfidence: (s as any).autoMinConfidence ?? 75,
      autoMaxContracts: (s as any).autoMaxContracts ?? 50,
      autoMaxCost: (s as any).autoMaxCost ?? 50,
      dailyLossLimit: (s as any).dailyLossLimit ?? 500,
      maxDrawdownLimit: (s as any).maxDrawdownLimit ?? 20,
      autonomousConfirmedAt: (s as any).autonomousConfirmedAt || null,
    });
  });

  app.put("/api/bot/config", async (req, res) => {
    try {
      const { botMode, autoMinEdge, autoMinConfidence, autoMaxContracts, autoMaxCost } = req.body;
      const update: any = {};
      if (botMode !== undefined) {
        // Don't allow direct mode switch to autonomous via this endpoint (requires confirmation)
        if (botMode === "autonomous") {
          return res.status(400).json({ error: "Use POST /api/bot/mode to enable autonomous mode (requires confirmation)" });
        }
        update.botMode = botMode;
      }
      if (autoMinEdge !== undefined) update.autoMinEdge = parseFloat(autoMinEdge);
      if (autoMinConfidence !== undefined) update.autoMinConfidence = parseFloat(autoMinConfidence);
      if (autoMaxContracts !== undefined) update.autoMaxContracts = parseInt(autoMaxContracts);
      if (autoMaxCost !== undefined) update.autoMaxCost = parseFloat(autoMaxCost);
      await storage.updateSettings(update);
      res.json({ success: true, ...update });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });


  // ── In-memory bot state (for emergency halt) ─────────────────────────────────
  let botStartTime = Date.now();
  let consecutiveFailures = 0;

  // ── Bot Status API ────────────────────────────────────────────────────────────
  app.get("/api/bot/status", async (_req, res) => {
    try {
      const s = await storage.getSettings();
      const mode = (s as any)?.botMode || "hitl";
      const isHalted = mode === "halted";
      const uptimeMs = Date.now() - botStartTime;
      const uptimeMins = Math.floor(uptimeMs / 60_000);

      const today = new Date().toISOString().slice(0, 10);
      const allTrades = await storage.getPendingTrades();
      const todayExecuted = allTrades.filter(
        (t: any) => (t.status === "executed") && (t.executedAt || t.createdAt || "").startsWith(today)
      );
      const autoToday = todayExecuted.filter((t: any) => t.autoExecuted);
      const tradesToday = todayExecuted.length;

      // Win rate: last 20 executed trades (profit = maxProfit, loss = estimatedCost negative)
      const last20 = allTrades.filter((t: any) => t.status === "executed").slice(0, 20);
      const wins = last20.filter((t: any) => (t.edgeScore || 0) > 0).length;
      const winRate = last20.length > 0 ? Math.round((wins / last20.length) * 100) : 0;

      // Daily P&L estimate
      const dailyPnl = await storage.getDailyPnl();

      res.json({
        mode,
        isHalted,
        uptime: `${Math.floor(uptimeMins / 60)}h ${uptimeMins % 60}m`,
        uptimeMs,
        tradesToday,
        autoToday: autoToday.length,
        dailyPnl: parseFloat(dailyPnl.toFixed(2)),
        winRate,
        consecutiveFailures,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Emergency Halt ────────────────────────────────────────────────────────────
  app.post("/api/bot/emergency-halt", async (_req, res) => {
    try {
      // Set halted state immediately (works even if API call fails)
      await storage.setBotMode("halted");
      await storage.updateBotStatus("stopped");

      // Try to cancel all live orders
      let cancelResult = { ok: false, message: "API not configured" };
      try {
        const result = await kalshiAuthFetch("DELETE", "/portfolio/orders");
        cancelResult = { ok: result.ok, message: result.ok ? "All orders cancelled" : JSON.stringify(result.data) };
      } catch (e: any) {
        cancelResult = { ok: false, message: e.message };
      }

      // Log the emergency halt
      await storage.createAuditLog({
        eventType: "BOT_CONTROL",
        ticker: null,
        description: `EMERGENCY HALT triggered. Orders cancel: ${cancelResult.message}`,
        amount: null,
        status: "warning",
        createdAt: new Date().toISOString(),
      });

      res.json({
        success: true,
        mode: "halted",
        cancelResult,
        message: "Bot halted. All trading stopped.",
      });
    } catch (e: any) {
      // Even if there's an error, try to set halted state
      try { await storage.setBotMode("halted"); } catch {}
      res.status(500).json({ error: e.message, halted: true });
    }
  });

  // ── Set Bot Mode ──────────────────────────────────────────────────────────────
  app.post("/api/bot/mode", async (req, res) => {
    try {
      const { mode, confirmation, dailyLossLimit, maxDrawdownLimit } = req.body;

      if (!["hitl", "supervised", "autonomous", "halted"].includes(mode)) {
        return res.status(400).json({ error: "Invalid mode" });
      }

      // Autonomous requires confirmation phrase
      if (mode === "autonomous") {
        if (confirmation !== "I CONFIRM AUTONOMOUS MODE") {
          return res.status(400).json({ error: "Confirmation phrase required to enable autonomous mode" });
        }
        const s = await storage.getSettings();
        if (!(s as any)?.kalshiPrivateKey?.trim()) {
          return res.status(400).json({ error: "API key must be configured before enabling autonomous mode" });
        }
      }

      const update: any = { botMode: mode };
      if (mode === "autonomous") {
        update.autonomousConfirmedAt = new Date().toISOString();
        if (dailyLossLimit !== undefined) update.dailyLossLimit = parseFloat(dailyLossLimit);
        if (maxDrawdownLimit !== undefined) update.maxDrawdownLimit = parseFloat(maxDrawdownLimit);
      }

      await storage.updateSettings(update);

      await storage.createAuditLog({
        eventType: "BOT_CONTROL",
        ticker: null,
        description: `Bot mode changed to ${mode.toUpperCase()}${mode === "autonomous" ? " (autonomous confirmed)" : ""}`,
        amount: null,
        status: "ok",
        createdAt: new Date().toISOString(),
      });

      res.json({ success: true, mode });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Restart from Halted ───────────────────────────────────────────────────────
  app.post("/api/bot/restart", async (req, res) => {
    try {
      const { confirmation } = req.body;
      if (confirmation !== "RESTART BOT") {
        return res.status(400).json({ error: "Confirmation required: send { confirmation: 'RESTART BOT' }" });
      }

      await storage.setBotMode("hitl");
      await storage.updateBotStatus("running");
      consecutiveFailures = 0;

      await storage.createAuditLog({
        eventType: "BOT_CONTROL",
        ticker: null,
        description: "Bot restarted from HALTED state — mode set to HITL",
        amount: null,
        status: "ok",
        createdAt: new Date().toISOString(),
      });

      res.json({ success: true, mode: "hitl" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Background Signal Scanner ─────────────────────────────────────────────
  async function runSignalScan(isInitial = false) {
    try {
      const settingsData = await storage.getSettings();
      const mode = (settingsData as any)?.botMode || "hitl";
      
      // Don't scan if halted
      if (mode === "halted") {
        console.log("[Auto-Scanner] Bot is HALTED — skipping scan");
        return;
      }

      console.log(`[Auto-Scanner] Running scan (mode=${mode})...`);
      const liveSignals = await getCachedSignals();
      const minEdge = (settingsData as any)?.autoMinEdge ?? 5;
      const minConf = (settingsData as any)?.autoMinConfidence ?? 75;
      const maxContracts = (settingsData as any)?.autoMaxContracts ?? 50;
      const maxCost = (settingsData as any)?.autoMaxCost ?? 50;
      const dailyLossLimit = (settingsData as any)?.dailyLossLimit ?? 500;

      // Emergency halt check: daily P&L
      const dailyPnl = await storage.getDailyPnl();
      if (Math.abs(dailyPnl) > dailyLossLimit) {
        console.log(`[Auto-Scanner] Daily loss limit hit ($${Math.abs(dailyPnl).toFixed(2)} > $${dailyLossLimit}) — triggering emergency halt`);
        await storage.setBotMode("halted");
        await storage.createAuditLog({
          eventType: "BOT_CONTROL",
          ticker: null,
          description: `AUTO-HALT: Daily loss limit exceeded ($${Math.abs(dailyPnl).toFixed(2)} > $${dailyLossLimit})`,
          amount: Math.abs(dailyPnl),
          status: "warning",
          createdAt: new Date().toISOString(),
        });
        return;
      }

      // Emergency halt check: consecutive failures
      if (consecutiveFailures >= 3) {
        console.log(`[Auto-Scanner] 3+ consecutive failures — triggering emergency halt`);
        await storage.setBotMode("halted");
        await storage.createAuditLog({
          eventType: "BOT_CONTROL",
          ticker: null,
          description: "AUTO-HALT: 3+ consecutive API/execution failures",
          amount: null,
          status: "warning",
          createdAt: new Date().toISOString(),
        });
        consecutiveFailures = 0;
        return;
      }

      const existing = await storage.getPendingTrades("pending");
      const existingTickers = new Set(existing.map((t: any) => t.ticker));

      for (const sig of liveSignals) {
        if (existingTickers.has(sig.ticker)) continue;
        if (sig.signalType === "NO_TRADE") continue;

        const isSell = sig.signalType.startsWith("SELL");

        // For non-sell signals, check edge/confidence thresholds
        if (!isSell) {
          if (Math.abs(sig.edgeScore) < minEdge) continue;
          if (sig.modelConfidence * 100 < minConf) continue;
        }

        const side = (sig.signalType === "BUY_YES" || sig.signalType === "SELL_YES") ? "yes" : "no";
        const action = isSell ? "sell" : "buy";
        const priceCents = Math.round(sig.marketPrice * 100);
        const contracts = isSell
          ? 50
          : Math.min(maxContracts, Math.max(1, Math.floor(maxCost / Math.max(sig.marketPrice, 0.01))));
        const estimatedCost = parseFloat((contracts * sig.marketPrice).toFixed(2));
        const maxProfit = isSell ? estimatedCost : parseFloat((contracts * (1 - sig.marketPrice)).toFixed(2));

        // Supervised auto: check if meets auto-execution criteria
        const meetsAutoSupervisedCriteria = (
          !isSell &&
          (sig.executableEdge || 0) >= 0.08 &&
          sig.modelConfidence >= 0.80 &&
          estimatedCost <= 50 &&
          (sig.spread || 0) <= 0.06
        );

        let tradeStatus = "pending";
        let autoExecuted = false;

        if (mode === "supervised" && meetsAutoSupervisedCriteria) {
          // Auto-execute immediately
          const execResult = await autoExecuteTrade(sig.ticker, side, action, contracts, priceCents);
          if (execResult.ok) {
            tradeStatus = "executed";
            autoExecuted = true;
            consecutiveFailures = 0;
            console.log(`[Supervised] Auto-executed: ${sig.ticker} (${side}) edge=${sig.edgeScore.toFixed(1)}%`);
          } else {
            consecutiveFailures++;
            console.log(`[Supervised] Auto-execute failed: ${sig.ticker} — ${execResult.error}`);
            // Fall through to pending
          }
        } else if (mode === "autonomous") {
          // Execute ALL signals that passed guardrails
          const execResult = await autoExecuteTrade(sig.ticker, side, action, contracts, priceCents);
          if (execResult.ok) {
            tradeStatus = "executed";
            autoExecuted = true;
            consecutiveFailures = 0;
            console.log(`[Autonomous] Auto-executed: ${sig.ticker} (${side}) edge=${sig.edgeScore.toFixed(1)}%`);
          } else {
            consecutiveFailures++;
            console.log(`[Autonomous] Auto-execute failed: ${sig.ticker} — ${execResult.error}`);
            tradeStatus = "failed";
          }
        }

        const trade = await storage.createPendingTrade({
          ticker: sig.ticker,
          title: sig.title,
          side,
          action,
          contracts,
          priceCents,
          estimatedCost,
          maxProfit,
          edgeScore: sig.edgeScore,
          trueProbability: sig.trueProbability,
          marketPrice: sig.marketPrice,
          modelConfidence: sig.modelConfidence,
          modelName: sig.modelName,
          edgeSource: sig.edgeSource,
          reasoning: sig.reasoning,
          status: tradeStatus,
          createdAt: new Date().toISOString(),
          decidedAt: autoExecuted ? new Date().toISOString() : null,
          executedAt: autoExecuted ? new Date().toISOString() : null,
          orderId: null,
          errorMessage: null,
          gapType: sig.gapType || null,
          executableEdge: sig.executableEdge || null,
          kellySize: sig.kellySize || null,
          autoExecuted,
        });

        // Log auto-executed trades to audit log
        if (autoExecuted) {
          await storage.createAuditLog({
            eventType: "ORDER_PLACED",
            ticker: sig.ticker,
            description: `[AUTO-${mode.toUpperCase()}] ${action.toUpperCase()} ${side.toUpperCase()} ${contracts} @ ${priceCents}¢ | Edge: ${sig.edgeScore.toFixed(1)}% | Gap: ${sig.gapType || "?"}`,
            amount: estimatedCost,
            status: "ok",
            createdAt: new Date().toISOString(),
          });
        }

        console.log(`[Auto-Scanner] ${autoExecuted ? "Executed" : "Queued"}: ${sig.ticker} (${side}) edge=${sig.edgeScore.toFixed(1)}%`);
      }
    } catch (e) {
      console.error("[Auto-Scanner] Error:", e);
      consecutiveFailures++;
    }
  }

  // Helper: auto-execute a trade via Kalshi API
  async function autoExecuteTrade(
    ticker: string,
    side: string,
    action: string,
    contracts: number,
    priceCents: number
  ): Promise<{ ok: boolean; orderId?: string; error?: string }> {
    try {
      const creds = await getKalshiCredentials();
      if (!creds) return { ok: false, error: "No API credentials configured" };

      const orderBody: any = {
        ticker,
        side,
        action,
        count: contracts,
        type: "limit",
        client_order_id: randomUUID(),
        post_only: action !== "sell",
        ...(action === "sell" ? { reduce_only: true } : {}),
      };
      if (side === "yes") {
        orderBody.yes_price = priceCents;
      } else {
        orderBody.no_price = 100 - priceCents;
      }

      const result = await kalshiAuthFetch("POST", "/portfolio/orders", orderBody);
      if (result.ok) {
        const orderId = (result.data as any)?.order?.order_id || (result.data as any)?.order_id || "unknown";
        return { ok: true, orderId };
      } else {
        const errMsg = (result.data as any)?.detail || (result.data as any)?.error || JSON.stringify(result.data);
        return { ok: false, error: errMsg };
      }
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  setInterval(() => runSignalScan(), 60_000);

  // Kick off initial scan after 5 seconds (so server is fully up)
  setTimeout(() => runSignalScan(true), 5_000);

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
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pending_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      title TEXT NOT NULL,
      side TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'buy',
      contracts INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      estimated_cost REAL NOT NULL,
      max_profit REAL NOT NULL,
      edge_score REAL NOT NULL,
      true_probability REAL NOT NULL,
      market_price REAL NOT NULL,
      model_confidence REAL NOT NULL,
      model_name TEXT NOT NULL,
      edge_source TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      decided_at TEXT,
      executed_at TEXT,
      order_id TEXT,
      error_message TEXT
    );
  `);
  // Add new columns for existing databases (ALTER TABLE IF NOT EXISTS not supported in SQLite)
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN kalshi_private_key TEXT NOT NULL DEFAULT ''"); } catch {}
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN bot_mode TEXT NOT NULL DEFAULT 'hitl'"); } catch {}
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN auto_min_edge REAL NOT NULL DEFAULT 5"); } catch {}
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN auto_min_confidence REAL NOT NULL DEFAULT 75"); } catch {}
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN auto_max_contracts INTEGER NOT NULL DEFAULT 50"); } catch {}
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN auto_max_cost REAL NOT NULL DEFAULT 50"); } catch {}
  // Bot mode columns
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN bot_mode TEXT NOT NULL DEFAULT 'hitl'"); } catch {}
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN daily_loss_limit REAL NOT NULL DEFAULT 500"); } catch {}
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN max_drawdown_limit REAL NOT NULL DEFAULT 20"); } catch {}
  try { sqlite.exec("ALTER TABLE settings ADD COLUMN autonomous_confirmed_at TEXT"); } catch {}
  // Pending trades gap detection columns
  try { sqlite.exec("ALTER TABLE pending_trades ADD COLUMN gap_type TEXT"); } catch {}
  try { sqlite.exec("ALTER TABLE pending_trades ADD COLUMN executable_edge REAL"); } catch {}
  try { sqlite.exec("ALTER TABLE pending_trades ADD COLUMN kelly_size REAL"); } catch {}
  try { sqlite.exec("ALTER TABLE pending_trades ADD COLUMN auto_executed INTEGER NOT NULL DEFAULT 0"); } catch {}
}
