import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Positions ────────────────────────────────────────────────────────────────
export const positions = sqliteTable("positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  title: text("title").notNull(),
  side: text("side").notNull(), // 'yes' | 'no'
  quantity: integer("quantity").notNull(),
  entryPrice: real("entry_price").notNull(),
  currentPrice: real("current_price").notNull(),
  unrealizedPnl: real("unrealized_pnl").notNull(),
  pnlPct: real("pnl_pct").notNull(),
  category: text("category").notNull(),
  kellyFraction: real("kelly_fraction").notNull(),
  openedAt: text("opened_at").notNull(),
});

export const insertPositionSchema = createInsertSchema(positions).omit({ id: true });
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Position = typeof positions.$inferSelect;

// ── Orders ───────────────────────────────────────────────────────────────────
export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").notNull().unique(),
  ticker: text("ticker").notNull(),
  side: text("side").notNull(), // 'yes' | 'no'
  type: text("type").notNull(), // 'limit' | 'market'
  price: real("price").notNull(),
  quantity: integer("quantity").notNull(),
  filledQty: integer("filled_qty").notNull().default(0),
  status: text("status").notNull(), // 'open' | 'filled' | 'cancelled' | 'rejected' | 'partial'
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertOrderSchema = createInsertSchema(orders).omit({ id: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

// ── Signals ──────────────────────────────────────────────────────────────────
export const signals = sqliteTable("signals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  edgeScore: real("edge_score").notNull(),
  trueProbability: real("true_probability").notNull(),
  marketPrice: real("market_price").notNull(),
  signalType: text("signal_type").notNull(), // 'BUY_YES' | 'BUY_NO' | 'NO_TRADE'
  modelConfidence: real("model_confidence").notNull(),
  modelName: text("model_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertSignalSchema = createInsertSchema(signals).omit({ id: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signals.$inferSelect;

// ── Agents ───────────────────────────────────────────────────────────────────
export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  status: text("status").notNull(), // 'healthy' | 'degraded' | 'error' | 'idle'
  lastHeartbeat: text("last_heartbeat").notNull(),
  messagesProcessed: integer("messages_processed").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  description: text("description").notNull(),
});

export const insertAgentSchema = createInsertSchema(agents).omit({ id: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

// ── Portfolio ─────────────────────────────────────────────────────────────────
export const portfolio = sqliteTable("portfolio", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  totalBalance: real("total_balance").notNull(),
  unrealizedPnl: real("unrealized_pnl").notNull(),
  realizedPnl: real("realized_pnl").notNull(),
  totalReturn: real("total_return").notNull(),
  winRate: real("win_rate").notNull(),
  sharpeRatio: real("sharpe_ratio").notNull(),
  maxDrawdown: real("max_drawdown").notNull(),
  activePositions: integer("active_positions").notNull(),
  botStatus: text("bot_status").notNull().default("running"), // 'running' | 'paused' | 'stopped'
  updatedAt: text("updated_at").notNull(),
});

export type Portfolio = typeof portfolio.$inferSelect;

// ── P&L History ───────────────────────────────────────────────────────────────
export const pnlHistory = sqliteTable("pnl_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull(),
  cumulativePnl: real("cumulative_pnl").notNull(),
  dailyPnl: real("daily_pnl").notNull(),
  balance: real("balance").notNull(),
});

export type PnlHistory = typeof pnlHistory.$inferSelect;

// ── Risk Config ───────────────────────────────────────────────────────────────
export const riskConfig = sqliteTable("risk_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  maxPositionPct: real("max_position_pct").notNull().default(5),
  maxCategoryExposurePct: real("max_category_exposure_pct").notNull().default(20),
  kellyFractionMin: real("kelly_fraction_min").notNull().default(0.25),
  kellyFractionMax: real("kelly_fraction_max").notNull().default(0.5),
  stopLossThreshold: real("stop_loss_threshold").notNull().default(50),
  takeProfitTarget: real("take_profit_target").notNull().default(75),
  maxDrawdownPause: real("max_drawdown_pause").notNull().default(10),
  dailyVaR: real("daily_var").notNull().default(2.5),
  updatedAt: text("updated_at").notNull(),
});

export const insertRiskConfigSchema = createInsertSchema(riskConfig).omit({ id: true });
export type InsertRiskConfig = z.infer<typeof insertRiskConfigSchema>;
export type RiskConfig = typeof riskConfig.$inferSelect;

// ── Audit Log ────────────────────────────────────────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(), // 'ORDER_PLACED' | 'ORDER_FILLED' | 'ORDER_CANCELLED' | 'POSITION_OPENED' | 'POSITION_CLOSED' | 'RISK_BREACH' | 'BOT_CONTROL'
  ticker: text("ticker"),
  description: text("description").notNull(),
  amount: real("amount"),
  status: text("status").notNull(), // 'ok' | 'warning' | 'error'
  createdAt: text("created_at").notNull(),
});

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLog.$inferSelect;

// ── Backtest Results ─────────────────────────────────────────────────────────
export const backtestResults = sqliteTable("backtest_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runName: text("run_name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  winRate: real("win_rate").notNull(),
  roi: real("roi").notNull(),
  sharpeRatio: real("sharpe_ratio").notNull(),
  maxDrawdown: real("max_drawdown").notNull(),
  totalTrades: integer("total_trades").notNull(),
  brierScore: real("brier_score").notNull(),
  createdAt: text("created_at").notNull(),
});

export type BacktestResult = typeof backtestResults.$inferSelect;

// ── Equity Curve ─────────────────────────────────────────────────────────────
export const equityCurve = sqliteTable("equity_curve", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  backtestId: integer("backtest_id").notNull(),
  timestamp: text("timestamp").notNull(),
  equity: real("equity").notNull(),
  benchmark: real("benchmark").notNull(),
});

export type EquityCurve = typeof equityCurve.$inferSelect;

// ── Settings ─────────────────────────────────────────────────────────────────
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kalshiApiKey: text("kalshi_api_key").notNull().default(""),
  kalshiApiKeyId: text("kalshi_api_key_id").notNull().default(""),
  kalshiPrivateKey: text("kalshi_private_key").notNull().default(""),
  notifyOnSignal: integer("notify_on_signal", { mode: "boolean" }).notNull().default(true),
  notifyOnFill: integer("notify_on_fill", { mode: "boolean" }).notNull().default(true),
  minEdgeAlert: real("min_edge_alert").notNull().default(5),
  scanFrequency: integer("scan_frequency").notNull().default(30),
  llmModel: text("llm_model").notNull().default("gpt-4o"),
  updatedAt: text("updated_at").notNull(),
});

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

// ── Pending Trades (HITL queue) ─────────────────────────────────────────────
export const pendingTrades = sqliteTable("pending_trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  title: text("title").notNull(),
  side: text("side").notNull(), // 'yes' | 'no'
  action: text("action").notNull().default("buy"),
  contracts: integer("contracts").notNull(),
  priceCents: integer("price_cents").notNull(),
  estimatedCost: real("estimated_cost").notNull(),
  maxProfit: real("max_profit").notNull(),
  edgeScore: real("edge_score").notNull(),
  trueProbability: real("true_probability").notNull(),
  marketPrice: real("market_price").notNull(),
  modelConfidence: real("model_confidence").notNull(),
  modelName: text("model_name").notNull(),
  edgeSource: text("edge_source").notNull(),
  reasoning: text("reasoning").notNull(),
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected' | 'modified' | 'executed' | 'failed'
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
  executedAt: text("executed_at"),
  orderId: text("order_id"),
  errorMessage: text("error_message"),
});

export const insertPendingTradeSchema = createInsertSchema(pendingTrades).omit({ id: true });
export type InsertPendingTrade = z.infer<typeof insertPendingTradeSchema>;
export type PendingTrade = typeof pendingTrades.$inferSelect;

// ── Users (keep for auth) ─────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});
export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
