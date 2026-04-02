/**
 * Performance Tracker — In-memory trade outcome tracking,
 * adaptive Kelly multiplier, and performance summary.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface TradeOutcome {
  ticker: string;
  category: string;
  edgeSource: string;
  entryPrice: number;
  exitPrice: number;
  side: "yes" | "no";
  pnl: number;
  won: boolean;
  timestamp: number;
}

interface PerformanceSummary {
  totalTrades: number;
  winRate: number;
  avgProfitPerTrade: number;
  bestCategory: string;
  worstCategory: string;
  kellyMultiplier: number;
  shouldPause: boolean;
  recentPnl: number;
}

// ── State ────────────────────────────────────────────────────────────────────

const MAX_HISTORY = 100;
const ROLLING_WINDOW = 50;

const tradeHistory: TradeOutcome[] = [];

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Record a completed trade outcome.
 */
export function recordTradeOutcome(outcome: TradeOutcome): void {
  tradeHistory.push(outcome);
  if (tradeHistory.length > MAX_HISTORY) {
    tradeHistory.shift();
  }
}

/**
 * Calculate rolling win rate for the last ROLLING_WINDOW trades,
 * optionally filtered by category or edgeSource.
 * Returns 0-1.
 */
export function getWinRate(category?: string, edgeSource?: string): number {
  let filtered = tradeHistory;
  if (category) {
    filtered = filtered.filter(t => t.category === category);
  }
  if (edgeSource) {
    filtered = filtered.filter(t => t.edgeSource === edgeSource);
  }
  const recent = filtered.slice(-ROLLING_WINDOW);
  if (recent.length === 0) return 0.55; // default assumption when no data
  return recent.filter(t => t.won).length / recent.length;
}

/**
 * Adaptive Kelly multiplier based on recent win rate.
 *   win rate > 65%  → 0.30 (scale up)
 *   win rate 50-65% → 0.20 (standard)
 *   win rate 40-50% → 0.10 (scale down)
 *   win rate < 40%  → 0    (pause trading)
 */
export function getAdaptiveKellyMultiplier(): number {
  const wr = getWinRate();

  if (wr > 0.65) return 0.30;
  if (wr >= 0.50) return 0.20;
  if (wr >= 0.40) return 0.10;
  return 0; // pause
}

/**
 * Whether the bot should pause new entries due to poor performance.
 */
export function shouldPauseTrading(): boolean {
  return getAdaptiveKellyMultiplier() === 0;
}

/**
 * Aggregate performance summary for the API / dashboard.
 */
export function getPerformanceSummary(): PerformanceSummary {
  const totalTrades = tradeHistory.length;
  const winRate = getWinRate();
  const kellyMultiplier = getAdaptiveKellyMultiplier();

  const recentTrades = tradeHistory.slice(-ROLLING_WINDOW);
  const recentPnl = recentTrades.reduce((sum, t) => sum + t.pnl, 0);
  const avgProfitPerTrade = recentTrades.length > 0
    ? recentPnl / recentTrades.length
    : 0;

  // Best / worst category by win rate
  const categories = Array.from(new Set(tradeHistory.map(t => t.category)));
  let bestCategory = "N/A";
  let worstCategory = "N/A";
  let bestWr = -1;
  let worstWr = 2;

  for (const cat of categories) {
    const wr = getWinRate(cat);
    const catTrades = tradeHistory.filter(t => t.category === cat);
    if (catTrades.length < 3) continue; // need minimum sample
    if (wr > bestWr) { bestWr = wr; bestCategory = cat; }
    if (wr < worstWr) { worstWr = wr; worstCategory = cat; }
  }

  return {
    totalTrades,
    winRate,
    avgProfitPerTrade,
    bestCategory,
    worstCategory,
    kellyMultiplier,
    shouldPause: kellyMultiplier === 0,
    recentPnl,
  };
}

/**
 * Full performance data export for the API.
 */
export function getPerformanceData(): {
  summary: PerformanceSummary;
  recentTrades: TradeOutcome[];
  categoryBreakdown: Record<string, { trades: number; winRate: number; pnl: number }>;
} {
  const summary = getPerformanceSummary();

  const categories = Array.from(new Set(tradeHistory.map(t => t.category)));
  const categoryBreakdown: Record<string, { trades: number; winRate: number; pnl: number }> = {};
  for (const cat of categories) {
    const catTrades = tradeHistory.filter(t => t.category === cat);
    categoryBreakdown[cat] = {
      trades: catTrades.length,
      winRate: getWinRate(cat),
      pnl: catTrades.reduce((sum, t) => sum + t.pnl, 0),
    };
  }

  return {
    summary,
    recentTrades: tradeHistory.slice(-20), // last 20 trades
    categoryBreakdown,
  };
}
