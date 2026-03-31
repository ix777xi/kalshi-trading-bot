/**
 * Decision Engine — Disciplined entry/exit rules, tiered profit-taking,
 * stop-losses, hedging, and position monitoring.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface PositionState {
  ticker: string;
  title: string;
  side: "yes" | "no";
  entryPrice: number;        // avg entry price (0-1)
  quantity: number;           // total contracts held
  currentPrice: number;       // current market mid price
  unrealizedPnl: number;     // in dollars
  unrealizedPnlPct: number;  // percentage gain/loss from entry
  category: "sports" | "weather" | "crypto" | "finance" | "politics" | "novelty";
  sport?: string;             // e.g., "nba", "mlb" if sports category
  isLive: boolean;           // is the event currently live
  entryTime: number;         // timestamp of entry
  peakPrice: number;         // highest price seen since entry
  peakPnlPct: number;        // highest unrealized % gain seen
}

export interface DecisionAction {
  type: "SELL" | "HOLD" | "HEDGE" | "STOP_LOSS" | "TAKE_PROFIT" | "TIME_DECAY_EXIT";
  ticker: string;
  contracts: number;         // how many to sell (0 = hold)
  reason: string;            // human-readable reason
  urgency: "immediate" | "limit" | "scheduled";
  tier?: number;             // profit-taking tier (1, 2, 3)
  logEntry: TradeLog;
}

export interface TradeLog {
  action: "BUY" | "SELL" | "STOP_LOSS" | "TAKE_PROFIT" | "HEDGE" | "TIME_DECAY_EXIT";
  marketTicker: string;
  contracts: number;
  price: number;
  reason: string;
  remainingContracts: number;
  portfolioExposurePct: number;
  unrealizedPnlRemaining: string;
  modelProbability: number;
  kalshiImplied: number;
  edge: number;
}

export interface EntryDecision {
  allowed: boolean;
  reason: string;
  adjustedSize?: number;     // kelly-adjusted contract count
  kellyFraction?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

// Entry thresholds (from Kalshi Profit Strategies guide)
const MIN_EDGE_STANDARD = 0.06;           // 6% minimum edge
const MIN_EDGE_HIGH_CONVICTION = 0.10;    // 10% for larger sizes
const MAX_SPORT_CONCENTRATION = 0.40;     // 40% max in one sport
const KALSHI_FEE_ESTIMATE = 0.02;         // ~2% average Kalshi fee to subtract from gross edge
const MIN_NET_EDGE_HIGH_CONF = 0.03;      // 3% net edge for confidence 8-10
const MIN_NET_EDGE_MED_CONF = 0.07;       // 7% net edge for confidence 5-7
const MIN_NET_EDGE_LOW_CONF = 0.12;       // 12%+ net edge for confidence 1-4
const PRICE_FLOOR = 0.20;                 // Never buy contracts below 20¢ (longshot trap)
const PRICE_CEILING = 0.85;               // Never buy contracts above 85¢ (max upside too low)
const MAX_SPREAD = 0.05;                  // Skip markets with >5¢ bid-ask spread
const MAX_TOTAL_OPEN_PCT = 0.30;          // Max 30% of bankroll in open positions simultaneously
const MIN_HOURS_TO_RESOLVE = 1;           // No trades resolving in < 1 hour
const PREFER_MAX_DAYS = 30;               // Prefer markets resolving within 30 days

// Category priority (from research: maker edge by category)
// 1=Finance/Macro, 2=Weather, 3=Politics, 4=Crypto, 5=World Events, 6=Sports/Entertainment
const CATEGORY_PRIORITY: Record<string, number> = {
  finance: 1, weather: 2, politics: 3, crypto: 4, novelty: 5, sports: 6,
};

// Position sizing
const KELLY_STANDARD = 0.20;             // 0.20x Kelly for 6-10% edges
const KELLY_HIGH_CONVICTION = 0.35;      // 0.35x Kelly for >10% edges w/ volume
const MAX_SINGLE_EVENT_PCT = 0.08;       // 8% of portfolio max per event
const WEATHER_NOVELTY_CAP = 0.03;        // 3% cap for weather/novelty
const LONGSHOT_CAP = 0.05;              // 5% cap for contracts < 25¢

// Profit-taking tiers (pre-game)
const PROFIT_TIER_1_PCT = 0.50;          // +50% → sell 33%
const PROFIT_TIER_2_PCT = 1.00;          // +100% → sell 33%
const PROFIT_TIER_3_PCT = 1.50;          // +150% or implied > 85% → sell final 33%
const SELL_FRACTION_PER_TIER = 0.33;

// Profit-taking tiers (live game — compressed)
const LIVE_PROFIT_TIER_1_PCT = 0.30;     // +30% → sell 33%
const LIVE_PROFIT_TIER_2_PCT = 0.60;     // +60% → sell 33%
const LIVE_PROFIT_TIER_3_PCT = 1.00;     // +100% → sell final 33%

// Stop-loss rules
const STOP_LOSS_PRE_GAME = -0.40;        // -40% → exit 100%
const STOP_LOSS_LIVE_PARTIAL = -0.25;    // -25% → exit 50%
const STOP_LOSS_LIVE_FULL = -0.40;       // -40% → exit 100%
const STOP_LOSS_WEATHER = -0.20;         // -20% → exit 100%

// Time decay
const TIME_DECAY_MINUTES = 30;           // 30 min no movement → reduce 50%

// Daily rules
const DAILY_UP_TIGHTEN_PCT = 0.10;       // If up >10%, tighten stops
const DAILY_DOWN_HALT_PCT = -0.10;       // If down >10%, halt new buys

// ── Tier Tracking (in-memory) ────────────────────────────────────────────────

const tiersTaken: Map<string, Set<number>> = new Map();

export function markTierTaken(ticker: string, tier: number): void {
  if (!tiersTaken.has(ticker)) tiersTaken.set(ticker, new Set());
  tiersTaken.get(ticker)!.add(tier);
}

function isTierTaken(ticker: string, tier: number): boolean {
  return tiersTaken.get(ticker)?.has(tier) ?? false;
}

// ── Peak P&L Tracking (in-memory) ────────────────────────────────────────────

const peakPnlTracker: Map<string, number> = new Map();

function updatePeakPnlPct(ticker: string, currentPnlPct: number): number {
  const peak = peakPnlTracker.get(ticker) ?? currentPnlPct;
  const newPeak = Math.max(peak, currentPnlPct);
  peakPnlTracker.set(ticker, newPeak);
  return newPeak;
}

// ── Helper: build a TradeLog ─────────────────────────────────────────────────

function buildTradeLog(
  action: TradeLog["action"],
  pos: PositionState,
  contracts: number,
  reason: string,
  portfolioValue: number,
): TradeLog {
  const remaining = pos.quantity - contracts;
  const positionValue = pos.quantity * pos.currentPrice;
  const exposurePct = portfolioValue > 0 ? (positionValue / portfolioValue) * 100 : 0;
  const remainingPnl = remaining > 0
    ? ((pos.currentPrice - pos.entryPrice) * remaining).toFixed(2)
    : "0.00";

  return {
    action,
    marketTicker: pos.ticker,
    contracts,
    price: pos.currentPrice,
    reason,
    remainingContracts: remaining,
    portfolioExposurePct: parseFloat(exposurePct.toFixed(2)),
    unrealizedPnlRemaining: remainingPnl,
    modelProbability: 0, // caller can override if model data available
    kalshiImplied: pos.currentPrice,
    edge: 0,
  };
}

// ── Core: evaluatePosition ───────────────────────────────────────────────────

export function evaluatePosition(
  position: PositionState,
  portfolioValue: number,
  dailyPnlPct: number,
): DecisionAction {
  const pnlPct = position.unrealizedPnlPct;
  const isWeatherNovelty = position.category === "weather" || position.category === "novelty";

  // Track peak P&L for this position
  updatePeakPnlPct(position.ticker, pnlPct);

  // ── 1. Stop-loss check (highest priority) ──────────────────────────────

  // Weather/novelty: tighter stop at -20%
  if (isWeatherNovelty && pnlPct <= STOP_LOSS_WEATHER) {
    const contracts = position.quantity;
    const reason = `STOP-LOSS (weather/novelty): ${(pnlPct * 100).toFixed(1)}% loss exceeds -20% threshold → exit 100%`;
    return {
      type: "STOP_LOSS",
      ticker: position.ticker,
      contracts,
      reason,
      urgency: "immediate",
      logEntry: buildTradeLog("STOP_LOSS", position, contracts, reason, portfolioValue),
    };
  }

  // Live position: full stop at -40%
  if (position.isLive && pnlPct <= STOP_LOSS_LIVE_FULL) {
    const contracts = position.quantity;
    const reason = `STOP-LOSS (live, full): ${(pnlPct * 100).toFixed(1)}% loss exceeds -40% threshold → exit 100%`;
    return {
      type: "STOP_LOSS",
      ticker: position.ticker,
      contracts,
      reason,
      urgency: "immediate",
      logEntry: buildTradeLog("STOP_LOSS", position, contracts, reason, portfolioValue),
    };
  }

  // Live position: partial stop at -25%
  if (position.isLive && pnlPct <= STOP_LOSS_LIVE_PARTIAL) {
    const contracts = Math.ceil(position.quantity * 0.5);
    const reason = `STOP-LOSS (live, partial): ${(pnlPct * 100).toFixed(1)}% loss exceeds -25% threshold → exit 50%`;
    return {
      type: "STOP_LOSS",
      ticker: position.ticker,
      contracts,
      reason,
      urgency: "immediate",
      logEntry: buildTradeLog("STOP_LOSS", position, contracts, reason, portfolioValue),
    };
  }

  // Pre-game: full stop at -40%
  if (!position.isLive && pnlPct <= STOP_LOSS_PRE_GAME) {
    const contracts = position.quantity;
    const reason = `STOP-LOSS (pre-game): ${(pnlPct * 100).toFixed(1)}% loss exceeds -40% threshold → exit 100%`;
    return {
      type: "STOP_LOSS",
      ticker: position.ticker,
      contracts,
      reason,
      urgency: "limit",
      logEntry: buildTradeLog("STOP_LOSS", position, contracts, reason, portfolioValue),
    };
  }

  // If daily portfolio is up >10%, tighten stops to -10% from current
  if (dailyPnlPct > DAILY_UP_TIGHTEN_PCT && pnlPct <= -0.10) {
    const contracts = position.quantity;
    const reason = `STOP-LOSS (tightened): portfolio up ${(dailyPnlPct * 100).toFixed(1)}% today, tightened stop to -10% — position at ${(pnlPct * 100).toFixed(1)}%`;
    return {
      type: "STOP_LOSS",
      ticker: position.ticker,
      contracts,
      reason,
      urgency: "immediate",
      logEntry: buildTradeLog("STOP_LOSS", position, contracts, reason, portfolioValue),
    };
  }

  // ── 2. Profit-taking check ─────────────────────────────────────────────

  const tiers = position.isLive
    ? [LIVE_PROFIT_TIER_1_PCT, LIVE_PROFIT_TIER_2_PCT, LIVE_PROFIT_TIER_3_PCT]
    : [PROFIT_TIER_1_PCT, PROFIT_TIER_2_PCT, PROFIT_TIER_3_PCT];

  for (let tierIdx = 0; tierIdx < tiers.length; tierIdx++) {
    const tierNum = tierIdx + 1;
    const threshold = tiers[tierIdx];

    if (isTierTaken(position.ticker, tierNum)) continue;

    if (pnlPct >= threshold) {
      const sellContracts = Math.max(1, Math.floor(position.quantity * SELL_FRACTION_PER_TIER));

      // Final tier (runner): also sell if live and currentPrice >= 0.85
      const isFinalTier = tierNum === 3;
      const hitHighImplied = isFinalTier && position.isLive && position.currentPrice >= 0.85;
      const hitThreshold = pnlPct >= threshold;

      if (hitThreshold || hitHighImplied) {
        const triggerReason = hitHighImplied && !hitThreshold
          ? `implied price ${(position.currentPrice * 100).toFixed(0)}¢ >= 85¢`
          : `+${(pnlPct * 100).toFixed(1)}% >= +${(threshold * 100).toFixed(0)}%`;
        const reason = `TAKE-PROFIT tier ${tierNum}: ${triggerReason} → sell ${sellContracts} of ${position.quantity} (33%)`;

        return {
          type: "TAKE_PROFIT",
          ticker: position.ticker,
          contracts: sellContracts,
          reason,
          urgency: position.isLive ? "immediate" : "limit",
          tier: tierNum,
          logEntry: buildTradeLog("TAKE_PROFIT", position, sellContracts, reason, portfolioValue),
        };
      }
    }
  }

  // Check final tier special case: live + implied >= 85¢ even if pnl hasn't hit tier 3
  if (!isTierTaken(position.ticker, 3) && position.isLive && position.currentPrice >= 0.85 && position.side === "yes") {
    const sellContracts = Math.max(1, Math.floor(position.quantity * SELL_FRACTION_PER_TIER));
    const reason = `TAKE-PROFIT tier 3 (implied): currentPrice ${(position.currentPrice * 100).toFixed(0)}¢ >= 85¢ → sell runner (${sellContracts} contracts)`;
    return {
      type: "TAKE_PROFIT",
      ticker: position.ticker,
      contracts: sellContracts,
      reason,
      urgency: "immediate",
      tier: 3,
      logEntry: buildTradeLog("TAKE_PROFIT", position, sellContracts, reason, portfolioValue),
    };
  }

  // ── 3. Dead weight check ───────────────────────────────────────────────

  // If edge remaining is tiny, close
  const edgeRemaining = Math.abs(position.peakPnlPct - pnlPct);
  if (edgeRemaining < 0.02 && pnlPct > 0 && pnlPct < 0.10) {
    const reason = `DEAD-WEIGHT: edge remaining <2% (pnl ${(pnlPct * 100).toFixed(1)}%) — closing position`;
    return {
      type: "SELL",
      ticker: position.ticker,
      contracts: position.quantity,
      reason,
      urgency: "limit",
      logEntry: buildTradeLog("SELL", position, position.quantity, reason, portfolioValue),
    };
  }

  // If current price >= 92¢ and side is yes, max upside is 8¢ — not worth the risk
  if (position.currentPrice >= 0.92 && position.side === "yes") {
    const reason = `DEAD-WEIGHT: YES @ ${(position.currentPrice * 100).toFixed(0)}¢ — only ${((1 - position.currentPrice) * 100).toFixed(0)}¢ upside remaining, closing`;
    return {
      type: "SELL",
      ticker: position.ticker,
      contracts: position.quantity,
      reason,
      urgency: "limit",
      logEntry: buildTradeLog("SELL", position, position.quantity, reason, portfolioValue),
    };
  }

  // ── 4. Time decay check (pre-game only) ────────────────────────────────

  if (!position.isLive) {
    const minutesHeld = (Date.now() - position.entryTime) / 60_000;
    if (minutesHeld > TIME_DECAY_MINUTES) {
      // Price hasn't moved meaningfully toward profitability
      const priceMovement = Math.abs(position.currentPrice - position.entryPrice);
      if (priceMovement < 0.02) {
        const contracts = Math.ceil(position.quantity * 0.5);
        const reason = `TIME-DECAY: held ${Math.round(minutesHeld)}min with <2¢ movement → reduce 50% (${contracts} contracts)`;
        return {
          type: "TIME_DECAY_EXIT",
          ticker: position.ticker,
          contracts,
          reason,
          urgency: "limit",
          logEntry: buildTradeLog("TIME_DECAY_EXIT", position, contracts, reason, portfolioValue),
        };
      }
    }
  }

  // ── 5. Default: HOLD ───────────────────────────────────────────────────

  return {
    type: "HOLD",
    ticker: position.ticker,
    contracts: 0,
    reason: "No action needed — holding position",
    urgency: "scheduled",
    logEntry: buildTradeLog("SELL", position, 0, "HOLD", portfolioValue),
  };
}

// ── Core: evaluateEntry ──────────────────────────────────────────────────────

export function evaluateEntry(
  signal: {
    ticker: string;
    edgeScore: number;        // percentage (e.g. 8 = 8%)
    modelConfidence: number;  // 0-1
    marketPrice: number;      // 0-1
    trueProbability: number;  // 0-1
    edgeSource: string;
  },
  portfolioValue: number,
  cashAvailable: number,
  existingPositions: PositionState[],
  sportExposure: Record<string, number>,
  dailyPnlPct: number = 0,
): EntryDecision {
  const edgePct = Math.abs(signal.edgeScore) / 100; // convert from percentage to decimal

  // 1. Daily loss halt
  if (dailyPnlPct < DAILY_DOWN_HALT_PCT) {
    return { allowed: false, reason: `Daily P&L at ${(dailyPnlPct * 100).toFixed(1)}% — below -10% halt threshold. No new buys.` };
  }

  // 2. Price range gate: only trade 20-85¢ contracts (from PDF: avoid extreme mispricings)
  if (signal.marketPrice < PRICE_FLOOR) {
    return { allowed: false, reason: `Price ${(signal.marketPrice * 100).toFixed(0)}¢ below ${(PRICE_FLOOR * 100).toFixed(0)}¢ floor — longshots are structurally -EV (contracts at 5¢ win only 4.18%)` };
  }
  if (signal.marketPrice > PRICE_CEILING) {
    return { allowed: false, reason: `Price ${(signal.marketPrice * 100).toFixed(0)}¢ above ${(PRICE_CEILING * 100).toFixed(0)}¢ ceiling — insufficient upside for the risk` };
  }

  // 3. Net edge after fees (PDF: always calculate net edge after Kalshi fees)
  const netEdgePct = edgePct - KALSHI_FEE_ESTIMATE;
  if (netEdgePct <= 0) {
    return { allowed: false, reason: `Net edge after fees: ${(netEdgePct * 100).toFixed(1)}% (gross ${(edgePct * 100).toFixed(1)}% - ${(KALSHI_FEE_ESTIMATE * 100).toFixed(0)}% fee) — not profitable` };
  }

  // 4. Confidence-scaled edge threshold (PDF edge threshold rules)
  const confidenceScore = Math.round(signal.modelConfidence * 10); // 0-10 scale
  let requiredNetEdge = MIN_NET_EDGE_LOW_CONF;
  if (confidenceScore >= 8) requiredNetEdge = MIN_NET_EDGE_HIGH_CONF;
  else if (confidenceScore >= 5) requiredNetEdge = MIN_NET_EDGE_MED_CONF;
  if (netEdgePct < requiredNetEdge) {
    return { allowed: false, reason: `Net edge ${(netEdgePct * 100).toFixed(1)}% below required ${(requiredNetEdge * 100).toFixed(0)}% for confidence ${confidenceScore}/10` };
  }

  // 5. Total open position cap: max 30% of bankroll simultaneously
  const totalOpenExposure = existingPositions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
  if (portfolioValue > 0 && totalOpenExposure / portfolioValue > MAX_TOTAL_OPEN_PCT) {
    return { allowed: false, reason: `Total open exposure ${((totalOpenExposure / portfolioValue) * 100).toFixed(1)}% exceeds ${(MAX_TOTAL_OPEN_PCT * 100).toFixed(0)}% max` };
  }

  // 6. Categorize the signal
  const category = categorizeFromTicker(signal.ticker);

  // 7. Sport concentration check
  if (category === "sports") {
    const sportKey = guessSportFromTicker(signal.ticker);
    const currentExposure = sportExposure[sportKey] || 0;
    if (portfolioValue > 0 && currentExposure / portfolioValue > MAX_SPORT_CONCENTRATION) {
      return { allowed: false, reason: `Sport '${sportKey}' concentration at ${((currentExposure / portfolioValue) * 100).toFixed(1)}% — exceeds 40% max` };
    }
  }

  // 8. Weather/novelty cap: max 3% of portfolio
  if (category === "weather" || category === "novelty") {
    const catExposure = existingPositions
      .filter(p => p.category === category)
      .reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
    if (portfolioValue > 0 && catExposure / portfolioValue > WEATHER_NOVELTY_CAP) {
      return { allowed: false, reason: `${category} exposure at ${((catExposure / portfolioValue) * 100).toFixed(1)}% — exceeds 3% cap` };
    }
  }

  // 9. Single event cap: max 8% of portfolio
  const eventTicker = signal.ticker.split("-").slice(0, -1).join("-");
  const eventExposure = existingPositions
    .filter(p => p.ticker.startsWith(eventTicker))
    .reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
  if (portfolioValue > 0 && eventExposure / portfolioValue > MAX_SINGLE_EVENT_PCT) {
    return { allowed: false, reason: `Event '${eventTicker}' exposure at ${((eventExposure / portfolioValue) * 100).toFixed(1)}% — exceeds 8% single event cap` };
  }

  // 10. Calculate Kelly size
  const isHighConviction = edgePct >= MIN_EDGE_HIGH_CONVICTION;
  const kellyMultiplier = isHighConviction ? KELLY_HIGH_CONVICTION : KELLY_STANDARD;

  // Kelly formula: f* = (bp - q) / b
  // where b = odds, p = true prob, q = 1 - p
  const trueProb = signal.trueProbability;
  const marketProb = signal.marketPrice;
  const odds = marketProb > 0 ? (1 - marketProb) / marketProb : 0;
  const fullKelly = odds > 0 ? (odds * trueProb - (1 - trueProb)) / odds : 0;
  const fractionalKelly = Math.max(0, fullKelly * kellyMultiplier);
  let positionDollars = fractionalKelly * portfolioValue;

  // 11. Apply hard caps
  // Single event cap
  positionDollars = Math.min(positionDollars, portfolioValue * MAX_SINGLE_EVENT_PCT);
  // Weather/novelty cap
  if (category === "weather" || category === "novelty") {
    positionDollars = Math.min(positionDollars, portfolioValue * WEATHER_NOVELTY_CAP);
  }
  // Longshot cap: contracts < 25¢ max 5%
  if (signal.marketPrice < 0.25) {
    positionDollars = Math.min(positionDollars, portfolioValue * LONGSHOT_CAP);
  }
  // Cash available cap
  positionDollars = Math.min(positionDollars, cashAvailable);

  const adjustedSize = Math.max(1, Math.floor(positionDollars / Math.max(signal.marketPrice, 0.01)));

  if (adjustedSize <= 0) {
    return { allowed: false, reason: "Kelly sizing resulted in 0 contracts" };
  }

  // Minimum $20 projected profit filter
  // Max profit per contract = (1 - entry price) for YES, entry price for NO
  const isYes = signal.signalType === "BUY_YES" || signal.signalType === "SELL_NO";
  const maxProfitPerContract = isYes ? (1 - signal.marketPrice) : signal.marketPrice;
  const projectedMaxProfit = adjustedSize * maxProfitPerContract;
  const MIN_PROFIT_THRESHOLD = 20; // $20 minimum projected profit
  if (projectedMaxProfit < MIN_PROFIT_THRESHOLD) {
    return { allowed: false, reason: `Projected max profit $${projectedMaxProfit.toFixed(2)} below $${MIN_PROFIT_THRESHOLD} minimum. Need ${Math.ceil(MIN_PROFIT_THRESHOLD / Math.max(maxProfitPerContract, 0.01))} contracts (have ${adjustedSize})` };
  }

  return {
    allowed: true,
    reason: `Entry allowed: edge=${(edgePct * 100).toFixed(1)}%, Kelly=${(fractionalKelly * 100).toFixed(1)}%, size=${adjustedSize} contracts, projected profit $${projectedMaxProfit.toFixed(2)}`,
    adjustedSize,
    kellyFraction: fractionalKelly,
  };
}

// ── Core: evaluateHedge ──────────────────────────────────────────────────────

export function evaluateHedge(
  positions: PositionState[],
  portfolioValue: number = 0,
): DecisionAction[] {
  const actions: DecisionAction[] = [];

  // 1. Profit-lock: if any position up +80% in live game → suggest small NO hedge
  for (const pos of positions) {
    if (pos.isLive && pos.unrealizedPnlPct >= 0.80 && pos.side === "yes") {
      const hedgeContracts = Math.max(1, Math.floor(pos.quantity * 0.12)); // ~10-15% of original
      const reason = `HEDGE: ${pos.ticker} up ${(pos.unrealizedPnlPct * 100).toFixed(0)}% in live game → hedge with ${hedgeContracts} NO contracts`;
      actions.push({
        type: "HEDGE",
        ticker: pos.ticker,
        contracts: hedgeContracts,
        reason,
        urgency: "limit",
        logEntry: buildTradeLog("HEDGE", pos, hedgeContracts, reason, portfolioValue),
      });
    }
  }

  // 2. Both-sides check: if holding YES on multiple outcomes in same event → flag
  const eventGroups: Record<string, PositionState[]> = {};
  for (const pos of positions) {
    const event = pos.ticker.split("-").slice(0, -1).join("-");
    if (!event) continue;
    if (!eventGroups[event]) eventGroups[event] = [];
    eventGroups[event].push(pos);
  }
  for (const [event, group] of Object.entries(eventGroups)) {
    if (group.length >= 2) {
      const yesPositions = group.filter(p => p.side === "yes");
      if (yesPositions.length >= 2) {
        // Pick the weakest one to suggest closing
        const sorted = yesPositions.sort((a, b) => a.unrealizedPnlPct - b.unrealizedPnlPct);
        const weakest = sorted[0];
        const reason = `HEDGE: holding ${yesPositions.length} YES positions in event '${event}' — consider closing weakest (${weakest.ticker} at ${(weakest.unrealizedPnlPct * 100).toFixed(1)}%)`;
        actions.push({
          type: "SELL",
          ticker: weakest.ticker,
          contracts: weakest.quantity,
          reason,
          urgency: "limit",
          logEntry: buildTradeLog("SELL", weakest, weakest.quantity, reason, portfolioValue),
        });
      }
    }
  }

  // 3. Cross-event concentration: if 3+ positions in same sport on same day → flag
  const sportCounts: Record<string, PositionState[]> = {};
  for (const pos of positions) {
    if (pos.category === "sports" && pos.sport) {
      if (!sportCounts[pos.sport]) sportCounts[pos.sport] = [];
      sportCounts[pos.sport].push(pos);
    }
  }
  for (const [sport, group] of Object.entries(sportCounts)) {
    if (group.length >= 3) {
      const weakest = group.sort((a, b) => a.unrealizedPnlPct - b.unrealizedPnlPct)[0];
      const reason = `CONCENTRATION: ${group.length} positions in ${sport} — consider reducing weakest (${weakest.ticker})`;
      actions.push({
        type: "SELL",
        ticker: weakest.ticker,
        contracts: Math.ceil(weakest.quantity * 0.5),
        reason,
        urgency: "scheduled",
        logEntry: buildTradeLog("SELL", weakest, Math.ceil(weakest.quantity * 0.5), reason, portfolioValue),
      });
    }
  }

  return actions;
}

// ── Core: dailyScan ──────────────────────────────────────────────────────────

export function dailyScan(
  positions: PositionState[],
  portfolioValue: number,
  dailyPnlPct: number,
): DecisionAction[] {
  const actions: DecisionAction[] = [];

  // 1. For each position: if edge < 2% → close it
  for (const pos of positions) {
    const edgeRemaining = Math.abs(pos.unrealizedPnlPct);
    // If position is barely profitable and hasn't moved, edge is gone
    if (pos.unrealizedPnlPct >= 0 && pos.unrealizedPnlPct < 0.02) {
      const reason = `DAILY-SCAN: ${pos.ticker} edge <2% (${(pos.unrealizedPnlPct * 100).toFixed(1)}%) — closing stale position`;
      actions.push({
        type: "SELL",
        ticker: pos.ticker,
        contracts: pos.quantity,
        reason,
        urgency: "limit",
        logEntry: buildTradeLog("SELL", pos, pos.quantity, reason, portfolioValue),
      });
    }
  }

  // 2. If portfolio up >10% today → tighten all stops to -10% from current
  if (dailyPnlPct > DAILY_UP_TIGHTEN_PCT) {
    for (const pos of positions) {
      if (pos.unrealizedPnlPct <= -0.10) {
        const reason = `DAILY-SCAN (tightened): portfolio up ${(dailyPnlPct * 100).toFixed(1)}% — ${pos.ticker} at ${(pos.unrealizedPnlPct * 100).toFixed(1)}% breaches tightened -10% stop`;
        actions.push({
          type: "STOP_LOSS",
          ticker: pos.ticker,
          contracts: pos.quantity,
          reason,
          urgency: "immediate",
          logEntry: buildTradeLog("STOP_LOSS", pos, pos.quantity, reason, portfolioValue),
        });
      }
    }
  }

  // 3. If portfolio down >10% today → flag halt
  if (dailyPnlPct < DAILY_DOWN_HALT_PCT) {
    // Return an action that indicates halt — caller should stop all new buys
    if (positions.length > 0) {
      const pos = positions[0];
      const reason = `DAILY-SCAN HALT: portfolio down ${(dailyPnlPct * 100).toFixed(1)}% today — halt all new buys, manage existing only`;
      actions.push({
        type: "HOLD",
        ticker: "PORTFOLIO",
        contracts: 0,
        reason,
        urgency: "immediate",
        logEntry: buildTradeLog("SELL", pos, 0, reason, portfolioValue),
      });
    }
  }

  return actions;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function categorizeFromTicker(ticker: string): PositionState["category"] {
  const t = ticker.toUpperCase();
  if (/NBA|NFL|MLB|NHL|SOCCER|GAME|PTS|NCAA|UFC|TENNIS/.test(t)) return "sports";
  if (/HIGH|TEMP|RAIN|WEATHER|KXHIGH/.test(t)) return "weather";
  if (/BTC|ETH|CRYPTO/.test(t)) return "crypto";
  if (/INX|SPX|GDP|CPI|FED|RATE|UNEM/.test(t)) return "finance";
  if (/PRES|SENATE|ELEC|APPROVAL/.test(t)) return "politics";
  return "novelty";
}

function guessSportFromTicker(ticker: string): string {
  const t = ticker.toUpperCase();
  if (/NBA/.test(t)) return "nba";
  if (/NFL/.test(t)) return "nfl";
  if (/MLB/.test(t)) return "mlb";
  if (/NHL/.test(t)) return "nhl";
  if (/NCAA/.test(t)) return "ncaa";
  if (/UFC/.test(t)) return "ufc";
  if (/TENNIS/.test(t)) return "tennis";
  if (/SOCCER/.test(t)) return "soccer";
  return "other";
}
