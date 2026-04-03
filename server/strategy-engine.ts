/**
 * Strategy Engine — 10 Autonomous Prediction Market Strategies
 *
 * Based on the Autonomous Prediction Market Bot guide:
 * 1. Intra-Market Arb    2. Platt Calibration    3. Contrarian NO Bias
 * 4. Endgame Sweep        5. Time Decay           6. FLB Exploit
 * 7. Live Momentum        8. Spread Capture       9. Order Flow
 * 10. Market Making
 */

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StrategyConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  complexity: "low" | "medium" | "high";
  edgeDurability: "declining" | "medium" | "high";
  minCapital: string;
  riskLevel: "low" | "medium" | "high";
}

export interface StrategySignal {
  id: string;
  strategyId: string;
  strategyName: string;
  ticker: string;
  title: string;
  action: "BUY_YES" | "BUY_NO" | "SELL_YES" | "SELL_NO" | "MARKET_MAKE" | "NO_TRADE";
  side: "yes" | "no";
  priceCents: number;
  contracts: number;
  edge: number;
  expectedProfit: number;
  confidence: number;
  reasoning: string;
  urgency: "immediate" | "limit" | "patient";
  createdAt: string;
}

export interface StrategyState {
  strategies: StrategyConfig[];
  signals: StrategySignal[];
  lastScan: string;
  activeStrategyCount: number;
  totalSignals: number;
}

// ── Strategy Definitions ──────────────────────────────────────────────────────

const DEFAULT_STRATEGIES: StrategyConfig[] = [
  { id: "intra_arb", name: "Intra-Market Arbitrage", description: "Buy both YES+NO when sum < $0.97, sell both when > $1.03. Risk-free structural edge.", enabled: true, priority: 1, complexity: "medium", edgeDurability: "declining", minCapital: "$5K+", riskLevel: "low" },
  { id: "platt_calibration", name: "Platt-Scaled Probability", description: "Calibrate model probabilities away from 50% hedging bias using Platt scaling.", enabled: true, priority: 2, complexity: "high", edgeDurability: "high", minCapital: "$1K+", riskLevel: "medium" },
  { id: "contrarian_no", name: "Contrarian NO Bias", description: "~70% of markets resolve NO. Bet against over-inflated YES prices above 75¢.", enabled: true, priority: 3, complexity: "low", edgeDurability: "high", minCapital: "$1K+", riskLevel: "medium" },
  { id: "flb_exploit", name: "Favorite-Longshot Bias", description: "Heavy favorites (>85¢) win more than implied. Longshots (<15¢) are overpriced.", enabled: true, priority: 3, complexity: "low", edgeDurability: "high", minCapital: "$1K+", riskLevel: "low" },
  { id: "endgame_sweep", name: "Endgame Sweep", description: "Buy near-certain contracts (92-99¢) when retail panic-sells before resolution.", enabled: true, priority: 4, complexity: "low", edgeDurability: "medium", minCapital: "$10K+", riskLevel: "low" },
  { id: "time_decay", name: "Time Decay Exploitation", description: "As deadline nears without YES materializing, NO value rises but market lags.", enabled: true, priority: 5, complexity: "low", edgeDurability: "high", minCapital: "$1K+", riskLevel: "low" },
  { id: "spread_capture", name: "Spread Capture", description: "Post-only limit orders near midpoint to capture wide spreads + maker rebate.", enabled: true, priority: 5, complexity: "medium", edgeDurability: "high", minCapital: "$1K+", riskLevel: "low" },
  { id: "momentum_live", name: "Live Momentum Trading", description: "Buy overreactions during live events when price swings >15% in 2 minutes.", enabled: true, priority: 6, complexity: "medium", edgeDurability: "medium", minCapital: "$1K+", riskLevel: "high" },
  { id: "order_flow", name: "Order Flow Imbalance", description: "Detect heavy buy/sell clusters in order book as short-term directional signal.", enabled: false, priority: 9, complexity: "high", edgeDurability: "medium", minCapital: "$5K+", riskLevel: "high" },
  { id: "market_making", name: "Market Making", description: "Quote both sides around midpoint, earn bid-ask spread on fills. Requires capital.", enabled: false, priority: 10, complexity: "high", edgeDurability: "high", minCapital: "$20K+", riskLevel: "medium" },
];

let strategies: StrategyConfig[] = JSON.parse(JSON.stringify(DEFAULT_STRATEGIES));

export function getStrategies(): StrategyConfig[] { return strategies; }

export function updateStrategy(id: string, updates: Partial<StrategyConfig>): StrategyConfig | null {
  const idx = strategies.findIndex(s => s.id === id);
  if (idx < 0) return null;
  strategies[idx] = { ...strategies[idx], ...updates };
  return strategies[idx];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function plattCalibrate(rawProb: number): number {
  if (rawProb <= 0.01 || rawProb >= 0.99) return rawProb;
  const a = 1.3; // stretch factor
  const b = 0.0;
  const logOdds = Math.log(rawProb / (1 - rawProb));
  return clamp(1 / (1 + Math.exp(-(a * logOdds + b))), 0.02, 0.98);
}

async function fetchKalshiMarkets(series: string[]): Promise<any[]> {
  const allMarkets: any[] = [];
  for (const s of series) {
    try {
      const res = await fetch(`${KALSHI_BASE}/markets?status=open&limit=100&series_ticker=${s}`, {
        headers: { "Accept": "application/json", "User-Agent": "KalshiBot-Strategy/1.0" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      allMarkets.push(...(data?.markets || []));
    } catch { /* skip */ }
  }
  return allMarkets;
}

// ── Strategy Implementations ──────────────────────────────────────────────────

// Strategy 1: Intra-Market Arbitrage (YES+NO ≠ $1)
function runIntraArb(markets: any[]): StrategySignal[] {
  const signals: StrategySignal[] = [];
  const byEvent: Record<string, any[]> = {};
  for (const m of markets) {
    const ev = m.event_ticker;
    if (!byEvent[ev]) byEvent[ev] = [];
    byEvent[ev].push(m);
  }
  for (const [ev, mkts] of Object.entries(byEvent)) {
    if (mkts.length < 3) continue;
    let sumYes = 0;
    let validCount = 0;
    for (const m of mkts) {
      const yb = parseFloat(m.yes_bid_dollars || "0");
      if (yb > 0) { sumYes += yb; validCount++; }
    }
    if (validCount < 3) continue;
    if (sumYes < 0.97) {
      const gap = 0.97 - sumYes;
      if (gap > 0.02) {
        signals.push({
          id: `intra_arb-${ev}-${Date.now()}`, strategyId: "intra_arb", strategyName: "Intra-Market Arb",
          ticker: `${ev}-ARB`, title: `BUY-ALL ${ev} (${validCount} brackets, sum=${sumYes.toFixed(3)})`,
          action: "BUY_YES", side: "yes", priceCents: Math.round((sumYes / validCount) * 100),
          contracts: 1, edge: gap * 100, expectedProfit: gap,
          confidence: 0.95, reasoning: `Risk-free: buy all ${validCount} brackets for $${sumYes.toFixed(3)}, guaranteed $1.00 payout. ${(gap * 100).toFixed(1)}% return.`,
          urgency: "immediate", createdAt: new Date().toISOString(),
        });
      }
    } else if (sumYes > 1.03) {
      const gap = sumYes - 1.03;
      if (gap > 0.02) {
        signals.push({
          id: `intra_arb-${ev}-${Date.now()}`, strategyId: "intra_arb", strategyName: "Intra-Market Arb",
          ticker: `${ev}-ARB`, title: `SELL-ALL ${ev} (${validCount} brackets, sum=${sumYes.toFixed(3)})`,
          action: "SELL_YES", side: "yes", priceCents: Math.round((sumYes / validCount) * 100),
          contracts: 1, edge: gap * 100, expectedProfit: gap,
          confidence: 0.95, reasoning: `Risk-free: sell all ${validCount} brackets for $${sumYes.toFixed(3)}, max liability $1.00. ${(gap * 100).toFixed(1)}% return.`,
          urgency: "immediate", createdAt: new Date().toISOString(),
        });
      }
    }
  }
  return signals;
}

// Strategy 3: Contrarian NO Bias (~70% of markets resolve NO)
function runContrarianNo(markets: any[]): StrategySignal[] {
  const signals: StrategySignal[] = [];
  for (const m of markets) {
    const yesBid = parseFloat(m.yes_bid_dollars || "0");
    const yesAsk = parseFloat(m.yes_ask_dollars || "0");
    const vol = parseInt(m.volume_fp || "0", 10) || 0;
    if (vol < 200) continue;
    const mid = yesBid > 0 && yesAsk > 0 ? (yesBid + yesAsk) / 2 : yesBid || yesAsk;
    if (mid < 0.75 || mid > 0.94) continue; // Only YES 75-94¢
    // Historical base rate: ~70% resolve NO, so YES > 75¢ is over-inflated
    const discount = mid > 0.85 ? 0.12 : mid > 0.80 ? 0.08 : 0.05;
    const trueYes = mid - discount;
    const edge = (mid - trueYes) * 100;
    if (edge < 5) continue;
    const noPrice = 1 - mid;
    const contracts = Math.max(1, Math.floor(20 / Math.max(noPrice, 0.01)));
    const expectedProfit = contracts * discount;
    if (expectedProfit < 20) continue; // $20 minimum profit
    signals.push({
      id: `contrarian_no-${m.ticker}-${Date.now()}`, strategyId: "contrarian_no", strategyName: "Contrarian NO",
      ticker: m.ticker, title: m.title || m.ticker,
      action: "BUY_NO", side: "no", priceCents: Math.round(noPrice * 100),
      contracts, edge, expectedProfit: Math.round(expectedProfit * 100) / 100,
      confidence: 0.72, reasoning: `YES at ${(mid * 100).toFixed(0)}¢ exceeds 75% threshold. ~70% of markets resolve NO. Estimated discount: ${(discount * 100).toFixed(0)}%. BUY NO at ${Math.round(noPrice * 100)}¢.`,
      urgency: "limit", createdAt: new Date().toISOString(),
    });
  }
  return signals.sort((a, b) => b.edge - a.edge).slice(0, 5);
}

// Strategy 4: Endgame Sweep (buy near-certain contracts retail exits)
function runEndgameSweep(markets: any[]): StrategySignal[] {
  const signals: StrategySignal[] = [];
  const now = Date.now();
  for (const m of markets) {
    const yesBid = parseFloat(m.yes_bid_dollars || "0");
    const vol = parseInt(m.volume_fp || "0", 10) || 0;
    const oi = parseInt(m.open_interest_fp || "0", 10) || 0;
    if (yesBid < 0.92 || yesBid > 0.99) continue;
    if (vol < 500 || oi < 200) continue;
    const closeTime = m.expected_expiration_time || m.close_time;
    if (!closeTime) continue;
    const hoursToClose = (new Date(closeTime).getTime() - now) / 3_600_000;
    if (hoursToClose < 0 || hoursToClose > 72) continue;
    const profit = (1 - yesBid);
    const contracts = Math.max(1, Math.floor(20 / yesBid));
    const expectedProfit = contracts * profit;
    if (expectedProfit < 20) continue; // $20 minimum profit
    signals.push({
      id: `endgame-${m.ticker}-${Date.now()}`, strategyId: "endgame_sweep", strategyName: "Endgame Sweep",
      ticker: m.ticker, title: m.title || m.ticker,
      action: "BUY_YES", side: "yes", priceCents: Math.round(yesBid * 100),
      contracts, edge: profit * 100, expectedProfit: Math.round(expectedProfit * 100) / 100,
      confidence: 0.90, reasoning: `Near-certain outcome at ${(yesBid * 100).toFixed(0)}¢ with ${vol} volume, closes in ${hoursToClose.toFixed(0)}h. Collect $1.00 at resolution for ${(profit * 100).toFixed(1)}% return.`,
      urgency: "patient", createdAt: new Date().toISOString(),
    });
  }
  return signals.sort((a, b) => b.expectedProfit - a.expectedProfit).slice(0, 5);
}

// Strategy 5: Time Decay Exploitation
function runTimeDecay(markets: any[]): StrategySignal[] {
  const signals: StrategySignal[] = [];
  const now = Date.now();
  for (const m of markets) {
    const yesBid = parseFloat(m.yes_bid_dollars || "0");
    const yesAsk = parseFloat(m.yes_ask_dollars || "0");
    const vol = parseInt(m.volume_fp || "0", 10) || 0;
    if (vol < 200) continue;
    const mid = yesBid > 0 && yesAsk > 0 ? (yesBid + yesAsk) / 2 : yesBid || yesAsk;
    if (mid < 0.30 || mid > 0.70) continue;
    const closeTime = m.expected_expiration_time || m.close_time;
    if (!closeTime) continue;
    const hoursToClose = (new Date(closeTime).getTime() - now) / 3_600_000;
    if (hoursToClose < 1 || hoursToClose > 24) continue;
    // Time decay: as close approaches, NO becomes more valuable if YES hasn't moved
    const decayBoost = (24 - hoursToClose) / 24 * 0.08; // up to 8% boost near close
    const noValue = (1 - mid) + decayBoost;
    const edge = decayBoost * 100;
    if (edge < 3) continue;
    const noPrice = 1 - mid;
    const contracts = Math.max(1, Math.floor(15 / Math.max(noPrice, 0.01)));
    const expectedProfit = contracts * decayBoost;
    if (expectedProfit < 20) continue; // $20 minimum profit
    signals.push({
      id: `time_decay-${m.ticker}-${Date.now()}`, strategyId: "time_decay", strategyName: "Time Decay",
      ticker: m.ticker, title: m.title || m.ticker,
      action: "BUY_NO", side: "no", priceCents: Math.round(noPrice * 100),
      contracts, edge, expectedProfit: Math.round(expectedProfit * 100) / 100,
      confidence: 0.68, reasoning: `YES at ${(mid * 100).toFixed(0)}¢ with ${hoursToClose.toFixed(0)}h to close. Time decay adds ${(decayBoost * 100).toFixed(1)}% to NO value. Market hasn't priced in deadline proximity.`,
      urgency: "limit", createdAt: new Date().toISOString(),
    });
  }
  return signals.sort((a, b) => b.edge - a.edge).slice(0, 5);
}

// Strategy 6: FLB Exploit
function runFLBExploit(markets: any[]): StrategySignal[] {
  const signals: StrategySignal[] = [];
  for (const m of markets) {
    const yesBid = parseFloat(m.yes_bid_dollars || "0");
    const yesAsk = parseFloat(m.yes_ask_dollars || "0");
    const noBid = parseFloat(m.no_bid_dollars || "0");
    const vol = parseInt(m.volume_fp || "0", 10) || 0;
    if (vol < 300) continue;
    const mid = yesBid > 0 && yesAsk > 0 ? (yesBid + yesAsk) / 2 : yesBid || yesAsk;
    if (mid <= 0 || mid >= 1) continue;
    const spread = Math.max(0, yesAsk - yesBid);
    // Heavy favorites: >85¢ win more than price implies
    if (mid >= 0.85 && mid < 0.94 && spread < 0.04) {
      const actualWinRate = Math.min(0.99, mid * 1.035);
      const edge = (actualWinRate - mid) * 100;
      if (edge < 2) continue;
      const contracts = Math.max(1, Math.floor(20 / mid));
      const expectedProfit = contracts * (actualWinRate - mid);
      if (expectedProfit < 20) continue; // $20 minimum profit
      signals.push({
        id: `flb-${m.ticker}-${Date.now()}`, strategyId: "flb_exploit", strategyName: "FLB Exploit",
        ticker: m.ticker, title: m.title || m.ticker,
        action: "BUY_YES", side: "yes", priceCents: Math.round(mid * 100),
        contracts, edge, expectedProfit: Math.round(expectedProfit * 100) / 100,
        confidence: 0.80, reasoning: `Heavy favorite at ${(mid * 100).toFixed(0)}¢. Historical FLB: favorites >85¢ win ~${(actualWinRate * 100).toFixed(1)}% of the time (${(edge).toFixed(1)}% mispriced). Low-risk structural edge.`,
        urgency: "limit", createdAt: new Date().toISOString(),
      });
    }
    // Longshots: <15¢ are overpriced — sell YES / buy NO
    if (mid > 0.05 && mid <= 0.15 && noBid > 0 && spread < 0.05) {
      const actualLoss = mid * 0.72; // longshots win only ~72% of implied rate
      const edge = (mid - actualLoss) * 100;
      if (edge < 3) continue;
      const noPrice = 1 - mid;
      const contracts = Math.max(1, Math.floor(15 / Math.max(noPrice, 0.01)));
      const expectedProfit = contracts * (mid - actualLoss);
      if (expectedProfit < 1) continue;
      signals.push({
        id: `flb-${m.ticker}-no-${Date.now()}`, strategyId: "flb_exploit", strategyName: "FLB Exploit",
        ticker: m.ticker, title: m.title || m.ticker,
        action: "BUY_NO", side: "no", priceCents: Math.round(noPrice * 100),
        contracts, edge, expectedProfit: Math.round(expectedProfit * 100) / 100,
        confidence: 0.78, reasoning: `Longshot at ${(mid * 100).toFixed(0)}¢. Actual win rate ~${(actualLoss / mid * 100).toFixed(0)}% of implied. Buying NO captures the optimism tax.`,
        urgency: "limit", createdAt: new Date().toISOString(),
      });
    }
  }
  return signals.sort((a, b) => b.edge - a.edge).slice(0, 5);
}

// Strategy 8: Spread Capture (wide bid-ask spreads)
function runSpreadCapture(markets: any[]): StrategySignal[] {
  const signals: StrategySignal[] = [];
  for (const m of markets) {
    const yesBid = parseFloat(m.yes_bid_dollars || "0");
    const yesAsk = parseFloat(m.yes_ask_dollars || "0");
    const vol = parseInt(m.volume_fp || "0", 10) || 0;
    const oi = parseInt(m.open_interest_fp || "0", 10) || 0;
    if (vol < 200 || oi < 100) continue;
    if (yesBid <= 0 || yesAsk <= 0) continue;
    const spread = yesAsk - yesBid;
    if (spread < 0.04) continue; // Need at least 4¢ spread
    const mid = (yesBid + yesAsk) / 2;
    if (mid < 0.10 || mid > 0.90) continue;
    const edge = spread * 100 / 2; // Capture half the spread
    const contracts = Math.max(1, Math.floor(15 / mid));
    const expectedProfit = contracts * spread / 2 + contracts * 0.0005; // + maker rebate
    if (expectedProfit < 20) continue; // $20 minimum profit
    signals.push({
      id: `spread-${m.ticker}-${Date.now()}`, strategyId: "spread_capture", strategyName: "Spread Capture",
      ticker: m.ticker, title: m.title || m.ticker,
      action: "BUY_YES", side: "yes", priceCents: Math.round((yesBid + 0.01) * 100),
      contracts, edge, expectedProfit: Math.round(expectedProfit * 100) / 100,
      confidence: 0.65, reasoning: `Wide spread: ${(spread * 100).toFixed(0)}¢ (bid ${(yesBid * 100).toFixed(0)}¢ / ask ${(yesAsk * 100).toFixed(0)}¢). Post limit at mid-1¢ to capture ${(edge).toFixed(1)}% + 0.05% maker rebate.`,
      urgency: "patient", createdAt: new Date().toISOString(),
    });
  }
  return signals.sort((a, b) => b.edge - a.edge).slice(0, 5);
}

// ── Strategy Runner ──────────────────────────────────────────────────────────

function runStrategy(id: string, markets: any[]): StrategySignal[] {
  switch (id) {
    case "intra_arb": return runIntraArb(markets);
    case "contrarian_no": return runContrarianNo(markets);
    case "endgame_sweep": return runEndgameSweep(markets);
    case "time_decay": return runTimeDecay(markets);
    case "flb_exploit": return runFLBExploit(markets);
    case "spread_capture": return runSpreadCapture(markets);
    // These strategies are flagged but not yet generating signals (need more infra):
    case "platt_calibration": return []; // Applied as calibration layer, not standalone signals
    case "momentum_live": return []; // Handled by sports-agent.ts and live-sports-engine.ts
    case "order_flow": return []; // Needs order book depth data (premium API)
    case "market_making": return runNewMarketMaker(markets); // Target new/thin markets for spread capture
    default: return [];
  }
}

// Strategy 11: New Market Maker (PDF p.5, p.9)
// Target newly launched markets with thin order books — wider spreads available
// before institutional market makers arrive. Post tight quotes to capture spread.
function runNewMarketMaker(markets: any[]): StrategySignal[] {
  const signals: StrategySignal[] = [];
  for (const m of markets) {
    const vol = parseInt(m.volume_fp || "0", 10) || 0;
    const oi = parseInt(m.open_interest_fp || "0", 10) || 0;
    const yesBid = parseFloat(m.yes_bid_dollars || "0");
    const yesAsk = parseFloat(m.yes_ask_dollars || "0");
    if (yesBid <= 0 || yesAsk <= 0) continue;
    const spread = yesAsk - yesBid;
    const mid = (yesBid + yesAsk) / 2;
    if (mid < 0.15 || mid > 0.85) continue;

    // New/thin markets: low volume + low OI + wide spread
    if (vol < 500 && oi < 300 && spread >= 0.06) {
      // Post at mid - 1c as maker, profit = half spread + rebate
      const profitPerContract = spread / 2;
      const contracts = Math.max(1, Math.floor(15 / mid));
      const expectedProfit = contracts * profitPerContract;
      if (expectedProfit < 20) continue;
      signals.push({
        id: `newmkt-${m.ticker}-${Date.now()}`, strategyId: "market_making", strategyName: "New Market Maker",
        ticker: m.ticker, title: m.title || m.ticker,
        action: "BUY_YES", side: "yes", priceCents: Math.round((yesBid + 0.01) * 100),
        contracts, edge: profitPerContract * 100, expectedProfit: Math.round(expectedProfit * 100) / 100,
        confidence: 0.60, reasoning: `New/thin market: vol=${vol}, OI=${oi}, spread=${(spread * 100).toFixed(0)}c. Post maker order at ${Math.round((yesBid + 0.01) * 100)}c to capture ${(profitPerContract * 100).toFixed(0)}c spread. Arrives before institutional MMs.`,
        urgency: "patient", createdAt: new Date().toISOString(),
      });
    }
  }
  return signals.sort((a, b) => b.expectedProfit - a.expectedProfit).slice(0, 3);
}

// Apply Platt calibration to all confidence scores
function applyPlattCalibration(signals: StrategySignal[]): StrategySignal[] {
  return signals.map(s => ({
    ...s,
    confidence: plattCalibrate(s.confidence),
  }));
}

// ── Main Scanner ─────────────────────────────────────────────────────────────

const SERIES = [
  "KXNBAGAME", "KXNBAPTS", "KXHIGHNY", "KXFEDRATE", "KXCPI", "KXINX", "KXGDP",
  "KXBTC", "KXETH", "KXAPPROVAL", "KXUNEM", "KXNFLGAME", "KXMLBGAME", "KXNHLGAME",
];

export async function runStrategyScanner(): Promise<StrategyState> {
  const markets = await fetchKalshiMarkets(SERIES);
  const enabledStrategies = strategies.filter(s => s.enabled);
  let allSignals: StrategySignal[] = [];

  for (const strategy of enabledStrategies) {
    try {
      const signals = runStrategy(strategy.id, markets);
      allSignals.push(...signals);
    } catch (err) {
      console.error(`[Strategy Engine] Error in ${strategy.id}:`, err);
    }
  }

  // Apply Platt calibration if enabled
  if (strategies.find(s => s.id === "platt_calibration" && s.enabled)) {
    allSignals = applyPlattCalibration(allSignals);
  }

  // Sort by priority then edge
  allSignals.sort((a, b) => {
    const aPrio = strategies.find(s => s.id === a.strategyId)?.priority ?? 10;
    const bPrio = strategies.find(s => s.id === b.strategyId)?.priority ?? 10;
    if (aPrio !== bPrio) return aPrio - bPrio;
    return b.edge - a.edge;
  });

  return {
    strategies,
    signals: allSignals,
    lastScan: new Date().toISOString(),
    activeStrategyCount: enabledStrategies.length,
    totalSignals: allSignals.length,
  };
}

export { plattCalibrate };
