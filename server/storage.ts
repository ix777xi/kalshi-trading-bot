import {
  type User, type InsertUser, users,
  type Position, type InsertPosition, positions,
  type Order, type InsertOrder, orders,
  type Signal, type InsertSignal, signals,
  type Agent, type InsertAgent, agents,
  type Portfolio, portfolio,
  type PnlHistory, pnlHistory,
  type RiskConfig, type InsertRiskConfig, riskConfig,
  type AuditLog, type InsertAuditLog, auditLog,
  type BacktestResult, backtestResults,
  type EquityCurve, equityCurve,
  type Settings, type InsertSettings, settings,
  type PendingTrade, type InsertPendingTrade, pendingTrades,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqlite } from "./db";
import { eq, desc, and } from "drizzle-orm";

export { sqlite };
export const db = drizzle(sqlite);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getPortfolio(): Promise<Portfolio | undefined>;
  updateBotStatus(status: string): Promise<void>;
  getPnlHistory(): Promise<PnlHistory[]>;
  getPositions(): Promise<Position[]>;
  createPosition(pos: InsertPosition): Promise<Position>;
  getOrders(): Promise<Order[]>;
  createOrder(order: InsertOrder): Promise<Order>;
  cancelOrder(id: number): Promise<void>;
  getSignals(): Promise<Signal[]>;
  createSignal(signal: InsertSignal): Promise<Signal>;
  getAgents(): Promise<Agent[]>;
  getRiskConfig(): Promise<RiskConfig | undefined>;
  updateRiskConfig(config: Partial<InsertRiskConfig>): Promise<RiskConfig>;
  getAuditLog(): Promise<AuditLog[]>;
  createAuditLog(entry: InsertAuditLog): Promise<AuditLog>;
  getBacktestResults(): Promise<BacktestResult[]>;
  getEquityCurve(backtestId: number): Promise<EquityCurve[]>;
  getSettings(): Promise<Settings | undefined>;
  updateSettings(s: Partial<InsertSettings>): Promise<Settings>;
  // Pending Trades (HITL)
  getPendingTrades(status?: string): Promise<PendingTrade[]>;
  getPendingTradeById(id: number): Promise<PendingTrade | undefined>;
  createPendingTrade(data: InsertPendingTrade): Promise<PendingTrade>;
  updatePendingTradeStatus(id: number, status: string, extra?: { orderId?: string; errorMessage?: string; decidedAt?: string; executedAt?: string }): Promise<PendingTrade>;
  updatePendingTrade(id: number, data: { contracts?: number; priceCents?: number }): Promise<PendingTrade>;
  // Bot Mode
  getBotMode(): Promise<string>;
  setBotMode(mode: string): Promise<void>;
  getDailyPnl(): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }
  async createUser(insertUser: InsertUser): Promise<User> {
    return db.insert(users).values(insertUser).returning().get();
  }
  async getPortfolio(): Promise<Portfolio | undefined> {
    return db.select().from(portfolio).get();
  }
  async updateBotStatus(status: string): Promise<void> {
    db.update(portfolio).set({ botStatus: status, updatedAt: new Date().toISOString() }).run();
  }
  async getPnlHistory(): Promise<PnlHistory[]> {
    return db.select().from(pnlHistory).all();
  }
  async getPositions(): Promise<Position[]> {
    return db.select().from(positions).all();
  }
  async createPosition(pos: InsertPosition): Promise<Position> {
    return db.insert(positions).values(pos).returning().get();
  }
  async getOrders(): Promise<Order[]> {
    return db.select().from(orders).orderBy(desc(orders.createdAt)).all();
  }
  async createOrder(order: InsertOrder): Promise<Order> {
    return db.insert(orders).values(order).returning().get();
  }
  async cancelOrder(id: number): Promise<void> {
    const now = new Date().toISOString();
    db.update(orders).set({ status: "cancelled", updatedAt: now }).where(eq(orders.id, id)).run();
  }
  async getSignals(): Promise<Signal[]> {
    return db.select().from(signals).orderBy(desc(signals.createdAt)).all();
  }
  async createSignal(signal: InsertSignal): Promise<Signal> {
    return db.insert(signals).values(signal).returning().get();
  }
  async getAgents(): Promise<Agent[]> {
    return db.select().from(agents).all();
  }
  async getRiskConfig(): Promise<RiskConfig | undefined> {
    return db.select().from(riskConfig).get();
  }
  async updateRiskConfig(config: Partial<InsertRiskConfig>): Promise<RiskConfig> {
    const existing = db.select().from(riskConfig).get();
    if (existing) {
      return db.update(riskConfig)
        .set({ ...config, updatedAt: new Date().toISOString() })
        .where(eq(riskConfig.id, existing.id))
        .returning().get();
    }
    return db.insert(riskConfig).values({ ...config as InsertRiskConfig, updatedAt: new Date().toISOString() }).returning().get();
  }
  async getAuditLog(): Promise<AuditLog[]> {
    return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).all();
  }
  async createAuditLog(entry: InsertAuditLog): Promise<AuditLog> {
    return db.insert(auditLog).values(entry).returning().get();
  }
  async getBacktestResults(): Promise<BacktestResult[]> {
    return db.select().from(backtestResults).orderBy(desc(backtestResults.createdAt)).all();
  }
  async getEquityCurve(bId: number): Promise<EquityCurve[]> {
    return db.select().from(equityCurve).where(eq(equityCurve.backtestId, bId)).all();
  }
  async getSettings(): Promise<Settings | undefined> {
    return db.select().from(settings).get();
  }
  async updateSettings(s: Partial<InsertSettings>): Promise<Settings> {
    const existing = db.select().from(settings).get();
    if (existing) {
      return db.update(settings)
        .set({ ...s, updatedAt: new Date().toISOString() })
        .where(eq(settings.id, existing.id))
        .returning().get();
    }
    return db.insert(settings).values({ ...s as InsertSettings, updatedAt: new Date().toISOString() }).returning().get();
  }

  // ── Pending Trades (HITL) ────────────────────────────────────────────────────
  async getPendingTrades(status?: string): Promise<PendingTrade[]> {
    if (status) {
      return db.select().from(pendingTrades)
        .where(eq(pendingTrades.status, status))
        .orderBy(desc(pendingTrades.createdAt)).all();
    }
    return db.select().from(pendingTrades).orderBy(desc(pendingTrades.createdAt)).all();
  }

  async getPendingTradeById(id: number): Promise<PendingTrade | undefined> {
    return db.select().from(pendingTrades).where(eq(pendingTrades.id, id)).get();
  }

  async createPendingTrade(data: InsertPendingTrade): Promise<PendingTrade> {
    return db.insert(pendingTrades).values(data).returning().get();
  }

  async updatePendingTradeStatus(
    id: number,
    status: string,
    extra?: { orderId?: string; errorMessage?: string; decidedAt?: string; executedAt?: string }
  ): Promise<PendingTrade> {
    const update: any = { status };
    if (extra?.orderId !== undefined) update.orderId = extra.orderId;
    if (extra?.errorMessage !== undefined) update.errorMessage = extra.errorMessage;
    if (extra?.decidedAt !== undefined) update.decidedAt = extra.decidedAt;
    if (extra?.executedAt !== undefined) update.executedAt = extra.executedAt;
    return db.update(pendingTrades).set(update).where(eq(pendingTrades.id, id)).returning().get();
  }

  async updatePendingTrade(id: number, data: { contracts?: number; priceCents?: number }): Promise<PendingTrade> {
    const update: any = {};
    if (data.contracts !== undefined) update.contracts = data.contracts;
    if (data.priceCents !== undefined) update.priceCents = data.priceCents;
    return db.update(pendingTrades).set(update).where(eq(pendingTrades.id, id)).returning().get();
  }

  async getBotMode(): Promise<string> {
    const s = db.select().from(settings).get();
    return (s as any)?.botMode || "hitl";
  }

  async setBotMode(mode: string): Promise<void> {
    const s = db.select().from(settings).get();
    if (s) {
      db.update(settings)
        .set({ botMode: mode, updatedAt: new Date().toISOString() } as any)
        .where(eq(settings.id, s.id))
        .run();
    }
  }

  async getDailyPnl(): Promise<number> {
    // Sum estimated cost of auto-executed trades today as a proxy for daily P&L impact
    const today = new Date().toISOString().slice(0, 10);
    const trades = db.select().from(pendingTrades).all();
    const todayTrades = trades.filter(
      (t: any) => t.autoExecuted && (t.executedAt || t.createdAt || "").startsWith(today)
    );
    // Simplified: return negative if we have losses (executed cost) as placeholder
    return todayTrades.reduce((sum: number, t: any) => sum - (t.estimatedCost || 0), 0);
  }
}

export const storage = new DatabaseStorage();
