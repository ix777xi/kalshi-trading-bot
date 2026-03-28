/**
 * Multi-Sport Autonomous Trading Agent
 *
 * Scans ESPN + Kalshi across 10 sports, computes model probabilities,
 * applies Kelly sizing with risk management, and generates trading signals.
 */

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SportConfig {
  id: string;
  name: string;
  enabled: boolean;
  kalshiSeries: string[];
  espnEndpoint: string;
  maxExposurePct: number;
  edgeThreshold: number;
  modelWeight: number;
}

export interface SportsSignal {
  id: string;
  sport: string;
  event: string;
  side: string;
  ticker: string;
  kalshiPrice: number;
  modelProbability: number;
  edge: number;
  action: "BUY_YES" | "BUY_NO" | "SELL_YES" | "SELL_NO" | "NO_TRADE";
  kellyFraction: number;
  positionSizeUsd: number;
  reasoning: string;
  confidence: number;
  riskLevel: "low" | "medium" | "high";
  dataSource: string;
  createdAt: string;
  isLive: boolean;
  score?: string;
  period?: string;
  momentum?: "home" | "away" | "neutral";
}

export interface SportsAgentState {
  running: boolean;
  bankroll: number;
  dailyPnl: number;
  dailyPnlPct: number;
  tradesToday: number;
  openPositions: number;
  sportExposure: Record<string, number>;
  signals: SportsSignal[];
  sports: SportConfig[];
  lastScan: string;
  riskStatus: "normal" | "caution" | "halted";
}

// ── Sport Configurations ──────────────────────────────────────────────────────

const SPORTS: SportConfig[] = [
  {
    id: "nba", name: "NBA Basketball", enabled: true,
    kalshiSeries: ["KXNBAGAME", "KXNBAPTS"],
    espnEndpoint: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
    maxExposurePct: 40, edgeThreshold: 5, modelWeight: 0.85,
  },
  {
    id: "mlb", name: "MLB Baseball", enabled: true,
    kalshiSeries: ["KXMLBGAME"],
    espnEndpoint: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
    maxExposurePct: 30, edgeThreshold: 5, modelWeight: 0.80,
  },
  {
    id: "nhl", name: "NHL Hockey", enabled: true,
    kalshiSeries: ["KXNHLGAME"],
    espnEndpoint: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
    maxExposurePct: 30, edgeThreshold: 5, modelWeight: 0.80,
  },
  {
    id: "soccer", name: "Soccer", enabled: true,
    kalshiSeries: ["KXSOCCERGAME", "KXINTLFRIENDLYGAME", "KXMLS"],
    espnEndpoint: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard",
    maxExposurePct: 25, edgeThreshold: 6, modelWeight: 0.70,
  },
  {
    id: "nfl", name: "NFL Football", enabled: true,
    kalshiSeries: ["KXNFLGAME"],
    espnEndpoint: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
    maxExposurePct: 40, edgeThreshold: 5, modelWeight: 0.85,
  },
  {
    id: "golf", name: "Golf", enabled: false,
    kalshiSeries: ["KXGOLF"],
    espnEndpoint: "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard",
    maxExposurePct: 15, edgeThreshold: 8, modelWeight: 0.60,
  },
  {
    id: "ufc", name: "UFC/MMA", enabled: false,
    kalshiSeries: ["KXUFC"],
    espnEndpoint: "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard",
    maxExposurePct: 20, edgeThreshold: 7, modelWeight: 0.65,
  },
  {
    id: "cbb", name: "College Basketball", enabled: true,
    kalshiSeries: ["KXCBBGAME", "KXNCAA"],
    espnEndpoint: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
    maxExposurePct: 25, edgeThreshold: 6, modelWeight: 0.75,
  },
  {
    id: "tennis", name: "Tennis", enabled: false,
    kalshiSeries: ["KXTENNIS"],
    espnEndpoint: "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard",
    maxExposurePct: 15, edgeThreshold: 7, modelWeight: 0.65,
  },
  {
    id: "esports", name: "Esports", enabled: false,
    kalshiSeries: ["KXESPORTS", "KXCS2", "KXVALORANT", "KXLOL"],
    espnEndpoint: "",
    maxExposurePct: 15, edgeThreshold: 6, modelWeight: 0.70,
  },
];

// Mutable in-memory store
let sportsConfigs: SportConfig[] = SPORTS.map(s => ({ ...s }));

export function getDefaultSports(): SportConfig[] {
  return sportsConfigs.map(s => ({ ...s }));
}

export function updateSportConfig(sportId: string, updates: Partial<SportConfig>): void {
  const idx = sportsConfigs.findIndex(s => s.id === sportId);
  if (idx === -1) return;
  sportsConfigs[idx] = { ...sportsConfigs[idx], ...updates, id: sportsConfigs[idx].id };
}

// ── Agent-wide config ─────────────────────────────────────────────────────────

let agentConfig = {
  bankroll: 386.52,
  dailyLossLimitPct: 15,
  maxPerEventPct: 5,
};

export function getAgentConfig() {
  return { ...agentConfig };
}

export function updateAgentConfig(updates: { bankroll?: number; dailyLossLimitPct?: number; maxPerEventPct?: number }) {
  if (updates.bankroll !== undefined) agentConfig.bankroll = updates.bankroll;
  if (updates.dailyLossLimitPct !== undefined) agentConfig.dailyLossLimitPct = updates.dailyLossLimitPct;
  if (updates.maxPerEventPct !== undefined) agentConfig.maxPerEventPct = updates.maxPerEventPct;
}

// ── In-memory tracking ────────────────────────────────────────────────────────

let dailyPnl = 0;
let tradesToday = 0;
let openPositions = 0;
const sportExposure: Record<string, number> = {};

// ── Fetch helpers ─────────────────────────────────────────────────────────────

const espnCache: Record<string, { data: any; ts: number }> = {};
const ESPN_CACHE_TTL = 15_000;

async function fetchESPN(url: string): Promise<any> {
  if (!url) return null;
  const now = Date.now();
  if (espnCache[url] && now - espnCache[url].ts < ESPN_CACHE_TTL) {
    return espnCache[url].data;
  }
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "KalshiBot-SportsAgent/1.0",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    espnCache[url] = { data, ts: now };
    return data;
  } catch {
    return espnCache[url]?.data ?? null;
  }
}

const kalshiMarketCache: Record<string, { data: any[]; ts: number }> = {};
const KALSHI_CACHE_TTL = 12_000;

async function fetchKalshiSeries(seriesTicker: string): Promise<any[]> {
  const now = Date.now();
  if (kalshiMarketCache[seriesTicker] && now - kalshiMarketCache[seriesTicker].ts < KALSHI_CACHE_TTL) {
    return kalshiMarketCache[seriesTicker].data;
  }
  try {
    const res = await fetch(`${KALSHI_BASE}/markets?status=open&limit=100&series_ticker=${seriesTicker}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "KalshiBot-SportsAgent/1.0",
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const markets = data?.markets ?? [];
    kalshiMarketCache[seriesTicker] = { data: markets, ts: now };
    return markets;
  } catch {
    return kalshiMarketCache[seriesTicker]?.data ?? [];
  }
}

// ── ESPN Data Parsing ─────────────────────────────────────────────────────────

interface ESPNEvent {
  id: string;
  home: string;
  away: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number;
  awayScore: number;
  homeRecord: string;
  awayRecord: string;
  homeWinPct: number;
  awayWinPct: number;
  status: "pre" | "in" | "post";
  period: number;
  clock: string;
  gameTime: string;
}

function parseESPNEvents(data: any): ESPNEvent[] {
  if (!data?.events) return [];
  const events: ESPNEvent[] = [];

  for (const event of data.events) {
    const comp = event?.competitions?.[0];
    if (!comp?.competitors || comp.competitors.length < 2) continue;

    let homeTeam: any = null;
    let awayTeam: any = null;
    for (const c of comp.competitors) {
      if (c.homeAway === "home") homeTeam = c;
      else awayTeam = c;
    }
    if (!homeTeam || !awayTeam) continue;

    const statusType = comp.status?.type;
    const state = statusType?.state ?? "pre";
    let status: "pre" | "in" | "post" = "pre";
    if (state === "in") status = "in";
    else if (state === "post") status = "post";

    const homeRecord = homeTeam.records?.[0]?.summary ?? "0-0";
    const awayRecord = awayTeam.records?.[0]?.summary ?? "0-0";

    function parseWinPct(record: string): number {
      const parts = record.split("-");
      if (parts.length < 2) return 0.5;
      const wins = parseInt(parts[0], 10) || 0;
      const losses = parseInt(parts[1], 10) || 0;
      const total = wins + losses;
      return total > 0 ? wins / total : 0.5;
    }

    events.push({
      id: event.id,
      home: homeTeam.team?.displayName ?? homeTeam.team?.shortDisplayName ?? "Home",
      away: awayTeam.team?.displayName ?? awayTeam.team?.shortDisplayName ?? "Away",
      homeAbbr: (homeTeam.team?.abbreviation ?? "").toUpperCase(),
      awayAbbr: (awayTeam.team?.abbreviation ?? "").toUpperCase(),
      homeScore: parseInt(homeTeam.score ?? "0", 10) || 0,
      awayScore: parseInt(awayTeam.score ?? "0", 10) || 0,
      homeRecord,
      awayRecord,
      homeWinPct: parseWinPct(homeRecord),
      awayWinPct: parseWinPct(awayRecord),
      status,
      period: comp.status?.period ?? 1,
      clock: comp.status?.displayClock ?? "0:00",
      gameTime: comp.date ?? new Date().toISOString(),
    });
  }

  return events;
}

// ── Model Probability Computation ─────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Intelligence Layer 1: Favorite-Longshot Bias ──────────────────────────────
// Empirically, low-priced YES contracts are overpriced; high-priced contracts are underpriced.
// Magnitude varies by sport: sports markets are less efficient than politics/finance.

const FLB_ADJUSTMENTS: Record<string, Record<string, number>> = {
  // price_range → adjustment
  nba:    { "0-10": -0.04, "10-20": -0.025, "20-30": -0.015, "70-80": 0.015, "80-90": 0.025, "90-95": 0.035 },
  nfl:    { "0-10": -0.04, "10-20": -0.03,  "20-30": -0.02,  "70-80": 0.02,  "80-90": 0.03,  "90-95": 0.04 },
  mlb:    { "0-10": -0.03, "10-20": -0.02,  "20-30": -0.01,  "70-80": 0.01,  "80-90": 0.02,  "90-95": 0.025 },
  nhl:    { "0-10": -0.03, "10-20": -0.02,  "20-30": -0.01,  "70-80": 0.015, "80-90": 0.025, "90-95": 0.03 },
  soccer: { "0-10": -0.05, "10-20": -0.035, "20-30": -0.02,  "70-80": 0.02,  "80-90": 0.035, "90-95": 0.045 },
  cbb:    { "0-10": -0.05, "10-20": -0.03,  "20-30": -0.02,  "70-80": 0.02,  "80-90": 0.03,  "90-95": 0.04 },
  default:{ "0-10": -0.03, "10-20": -0.02,  "20-30": -0.01,  "70-80": 0.01,  "80-90": 0.02,  "90-95": 0.03 },
};

function favoriteLongshotCorrection(price: number, sportId: string): number {
  const pricePct = price * 100;
  const table = FLB_ADJUSTMENTS[sportId] ?? FLB_ADJUSTMENTS.default;
  for (const [range, adj] of Object.entries(table)) {
    const [lo, hi] = range.split("-").map(Number);
    if (pricePct >= lo && pricePct < hi) return adj;
  }
  return 0;
}

// ── Intelligence Layer 2: Home Advantage by Sport ─────────────────────────────
// Home advantage varies significantly by sport.
const HOME_ADVANTAGE: Record<string, number> = {
  nba: 0.035,    // ~3.5% — NBA home advantage has shrunk post-COVID
  nfl: 0.030,    // ~3.0% — NFL home field
  mlb: 0.025,    // ~2.5% — MLB smallest home edge
  nhl: 0.030,    // ~3.0% — NHL ice advantage
  soccer: 0.045, // ~4.5% — Soccer strongest home advantage
  cbb: 0.050,    // ~5.0% — College BB loudest crowds, biggest edge
  ufc: 0.010,    // ~1.0% — Minimal for fighting
  tennis: 0.005, // ~0.5% — Negligible in tennis
  golf: 0.000,   // 0% — No home advantage in golf
  esports: 0.015,// ~1.5% — Small edge for "home" side in esports
};

// ── Intelligence Layer 3: Historical Comeback Rates ───────────────────────────
// Used to detect when market overreacts to a deficit in live games.
// Format: { deficit: comeback_probability } at various game stages
const COMEBACK_RATES: Record<string, Record<string, Record<number, number>>> = {
  nba: {
    q1: { 5: 0.65, 10: 0.55, 15: 0.40, 20: 0.28, 25: 0.15 },
    q2: { 5: 0.58, 10: 0.42, 15: 0.28, 20: 0.15, 25: 0.07 },
    q3: { 5: 0.50, 10: 0.32, 15: 0.18, 20: 0.08, 25: 0.03 },
    q4: { 5: 0.38, 10: 0.18, 15: 0.06, 20: 0.02, 25: 0.005 },
  },
  nfl: {
    q1: { 3: 0.72, 7: 0.58, 10: 0.48, 14: 0.35, 21: 0.18 },
    q2: { 3: 0.65, 7: 0.50, 10: 0.38, 14: 0.25, 21: 0.10 },
    q3: { 3: 0.55, 7: 0.38, 10: 0.25, 14: 0.14, 21: 0.05 },
    q4: { 3: 0.42, 7: 0.22, 10: 0.10, 14: 0.04, 21: 0.01 },
  },
  nhl: {
    p1: { 1: 0.60, 2: 0.40, 3: 0.22 },
    p2: { 1: 0.50, 2: 0.28, 3: 0.12 },
    p3: { 1: 0.38, 2: 0.15, 3: 0.05 },
  },
  mlb: {
    early: { 1: 0.62, 2: 0.50, 3: 0.38, 4: 0.28, 5: 0.18 },  // innings 1-3
    mid:   { 1: 0.55, 2: 0.40, 3: 0.28, 4: 0.18, 5: 0.10 },  // innings 4-6
    late:  { 1: 0.42, 2: 0.25, 3: 0.14, 4: 0.07, 5: 0.03 },  // innings 7-9
  },
};

function getComebackProb(sportId: string, deficit: number, period: number): number | null {
  const rates = COMEBACK_RATES[sportId];
  if (!rates) return null;

  let stageKey: string;
  if (sportId === "nba" || sportId === "cbb") {
    stageKey = `q${Math.min(period, 4)}`;
  } else if (sportId === "nfl") {
    stageKey = `q${Math.min(period, 4)}`;
  } else if (sportId === "nhl") {
    stageKey = `p${Math.min(period, 3)}`;
  } else if (sportId === "mlb") {
    stageKey = period <= 3 ? "early" : period <= 6 ? "mid" : "late";
  } else {
    return null;
  }

  const stageCurve = rates[stageKey];
  if (!stageCurve) return null;

  // Find closest deficit key
  const deficits = Object.keys(stageCurve).map(Number).sort((a, b) => a - b);
  const absDef = Math.abs(deficit);
  let closestRate = 0.5;
  for (const d of deficits) {
    if (absDef <= d) {
      closestRate = stageCurve[d];
      break;
    }
    closestRate = stageCurve[d];
  }
  return closestRate;
}

// ── Intelligence Layer 4: Stale Price Detection ──────────────────────────────
// Track price history to detect when Kalshi prices haven't adjusted to new info.
const priceMemory: Map<string, { prices: number[]; lastUpdate: number }> = new Map();

function detectStalePrice(ticker: string, currentPrice: number): { isStale: boolean; priceVelocity: number } {
  const now = Date.now();
  const history = priceMemory.get(ticker);

  if (history) {
    history.prices.push(currentPrice);
    if (history.prices.length > 20) history.prices.shift();
    history.lastUpdate = now;
  } else {
    priceMemory.set(ticker, { prices: [currentPrice], lastUpdate: now });
    return { isStale: false, priceVelocity: 0 };
  }

  const prices = priceMemory.get(ticker)!.prices;
  if (prices.length < 3) return { isStale: false, priceVelocity: 0 };

  // Price velocity: how fast is the price moving?
  const recent = prices.slice(-3);
  const velocity = (recent[recent.length - 1] - recent[0]) / recent.length;

  // Stale = price hasn't moved more than 0.5¢ in last 5+ readings during a live game
  const last5 = prices.slice(-5);
  const maxDiff = Math.max(...last5) - Math.min(...last5);
  const isStale = prices.length >= 5 && maxDiff < 0.005;

  return { isStale, priceVelocity: velocity };
}

// ── Intelligence Layer 5: Cross-Market Correlation ───────────────────────────
// Track moneyline vs spread/total for the same event to detect lagging adjustments.
const eventPriceMap: Map<string, { moneyline: number; spreads: number[]; totals: number[] }> = new Map();

function detectCrossMarketLag(
  eventTicker: string,
  marketType: "moneyline" | "spread" | "total",
  price: number
): number {
  let data = eventPriceMap.get(eventTicker);
  if (!data) {
    data = { moneyline: 0, spreads: [], totals: [] };
    eventPriceMap.set(eventTicker, data);
  }

  if (marketType === "moneyline") {
    data.moneyline = price;
  } else if (marketType === "spread") {
    data.spreads.push(price);
    if (data.spreads.length > 10) data.spreads.shift();
  } else {
    data.totals.push(price);
    if (data.totals.length > 10) data.totals.shift();
  }

  // If moneyline suggests a big favorite but spread hasn't adjusted, there's alpha
  if (data.moneyline > 0 && data.spreads.length > 0) {
    const spreadAvg = data.spreads.reduce((a, b) => a + b, 0) / data.spreads.length;
    const divergence = Math.abs(data.moneyline - spreadAvg) - 0.05;
    if (divergence > 0) return divergence;
  }
  return 0;
}

// ── Enhanced Pre-Game Model ──────────────────────────────────────────────────

function computePreGameProb(
  kalshiPrice: number,
  homeWinPct: number,
  awayWinPct: number,
  isHomeTeam: boolean,
  sportId: string = "nba"
): number {
  const base = clamp(kalshiPrice, 0.02, 0.98);

  // Layer 1: FLB correction (sport-specific)
  const flbAdj = favoriteLongshotCorrection(base, sportId);

  // Layer 2: Home advantage (sport-specific)
  const homeAdv = isHomeTeam
    ? (HOME_ADVANTAGE[sportId] ?? 0.03)
    : -(HOME_ADVANTAGE[sportId] ?? 0.03);

  // Layer 3: Team strength differential from records
  const teamWinPct = isHomeTeam ? homeWinPct : awayWinPct;
  const oppWinPct = isHomeTeam ? awayWinPct : homeWinPct;
  const totalWins = teamWinPct + oppWinPct;
  // Stronger teams get bigger record adjustment
  const recordAdj = totalWins > 0
    ? (teamWinPct / totalWins - 0.5) * 0.15 // 15% weight on record differential
    : 0;

  // Layer 4: Elo-like strength estimate
  // Teams with >65% win rate get extra boost, teams <35% get penalized
  let eloAdj = 0;
  if (teamWinPct > 0.65) eloAdj = (teamWinPct - 0.65) * 0.20;
  else if (teamWinPct < 0.35) eloAdj = (teamWinPct - 0.35) * 0.20;

  return clamp(base + flbAdj + homeAdv + recordAdj + eloAdj, 0.03, 0.97);
}

// ── Enhanced Live Game Model ─────────────────────────────────────────────────

const PERIOD_WEIGHTS: Record<string, Record<number, number>> = {
  nba: { 1: 0.005, 2: 0.008, 3: 0.012, 4: 0.020, 5: 0.030 },
  cbb: { 1: 0.008, 2: 0.018, 3: 0.025 },
  nhl: { 1: 0.04, 2: 0.06, 3: 0.10, 4: 0.12 },
  soccer: { 1: 0.02, 2: 0.04, 3: 0.06 },
  nfl: { 1: 0.003, 2: 0.005, 3: 0.008, 4: 0.015, 5: 0.020 },
  mlb: { 1: 0.008, 2: 0.010, 3: 0.012, 4: 0.014, 5: 0.016, 6: 0.020, 7: 0.025, 8: 0.035, 9: 0.050 },
};

function computeLiveWinProb(
  sportId: string,
  homeScore: number,
  awayScore: number,
  period: number,
  preGamePrice: number,
  isHomeTeam: boolean
): number {
  const base = clamp(preGamePrice, 0.02, 0.98);
  const scoreDiff = isHomeTeam ? homeScore - awayScore : awayScore - homeScore;
  const weights = PERIOD_WEIGHTS[sportId] ?? PERIOD_WEIGHTS.nba;
  const maxPeriod = Math.max(...Object.keys(weights).map(Number));
  const weight = weights[period] ?? weights[maxPeriod] ?? 0.01;

  // Base probability from score differential
  let liveProb = clamp(base + scoreDiff * weight, 0.02, 0.98);

  // Layer: Comeback rate adjustment
  // If trailing, check if market is underpricing the comeback probability
  if (scoreDiff < 0) {
    const comebackRate = getComebackProb(sportId, scoreDiff, period);
    if (comebackRate !== null) {
      // Blend: 60% live model + 40% comeback historical rate
      liveProb = liveProb * 0.60 + comebackRate * 0.40;
    }
  }

  // Layer: Late-game convergence — prices should converge toward 0 or 1
  // In final period, widen the adjustment to account for resolution
  const isFinalPeriod = (
    (sportId === "nba" && period >= 4) ||
    (sportId === "nfl" && period >= 4) ||
    (sportId === "nhl" && period >= 3) ||
    (sportId === "mlb" && period >= 7) ||
    (sportId === "soccer" && period >= 2)
  );
  if (isFinalPeriod && Math.abs(scoreDiff) > 0) {
    // Push probability further toward the leader in final period
    const convergencePush = scoreDiff > 0 ? 0.03 : -0.03;
    liveProb = clamp(liveProb + convergencePush, 0.02, 0.98);
  }

  return clamp(liveProb, 0.02, 0.98);
}

// ── Momentum Detection (Enhanced) ────────────────────────────────────────────
// Use score differential relative to period to detect momentum shifts.
// In early periods, a 10-point lead in NBA is less significant than Q4.

function detectMomentum(
  homeScore: number,
  awayScore: number,
  period: number,
  sportId: string = "nba"
): "home" | "away" | "neutral" {
  const diff = homeScore - awayScore;

  // Sport-specific momentum thresholds
  const thresholds: Record<string, Record<string, number>> = {
    nba: { early: 15, mid: 10, late: 7 },
    nfl: { early: 14, mid: 10, late: 7 },
    nhl: { early: 2, mid: 2, late: 1 },
    mlb: { early: 4, mid: 3, late: 2 },
    soccer: { early: 2, mid: 1, late: 1 },
    cbb: { early: 12, mid: 8, late: 5 },
  };

  const t = thresholds[sportId] ?? thresholds.nba;
  const maxPeriod = sportId === "mlb" ? 9 : sportId === "nhl" ? 3 : sportId === "soccer" ? 2 : 4;
  const stage = period <= Math.ceil(maxPeriod / 3) ? "early"
    : period <= Math.ceil(maxPeriod * 2 / 3) ? "mid" : "late";
  const threshold = t[stage] ?? 10;

  if (diff >= threshold) return "home";
  if (diff <= -threshold) return "away";
  return "neutral";
}

function momentumBoost(momentum: "home" | "away" | "neutral", isHomeTeam: boolean): number {
  if (momentum === "neutral") return 0;
  if ((momentum === "home" && isHomeTeam) || (momentum === "away" && !isHomeTeam)) return 0.04;
  return -0.03;
}

// ── Kelly Position Sizing ─────────────────────────────────────────────────────

function calculateQuarterKelly(
  edge: number,
  modelProb: number,
  bankroll: number,
  maxPerEvent: number,
  sportMultiplier: number
): { kellyFraction: number; positionSizeUsd: number } {
  if (edge <= 0 || modelProb <= 0 || modelProb >= 1) {
    return { kellyFraction: 0, positionSizeUsd: 0 };
  }
  const odds = 1 / (1 - modelProb);
  const fullKelly = edge / (odds - 1);
  const quarterKelly = fullKelly * 0.25 * sportMultiplier;
  const kellyFraction = clamp(quarterKelly, 0, 1);
  const rawSize = kellyFraction * bankroll;
  const positionSizeUsd = clamp(rawSize, 1, maxPerEvent);
  return { kellyFraction, positionSizeUsd: Math.round(positionSizeUsd * 100) / 100 };
}

// ── Risk Management ───────────────────────────────────────────────────────────

function checkRiskLimits(
  currentDailyPnl: number,
  bankroll: number,
  exposure: Record<string, number>,
  sport: SportConfig,
  proposedSize: number
): { allowed: boolean; reason?: string } {
  const lossLimitPct = agentConfig.dailyLossLimitPct;
  const dailyPnlPct = (currentDailyPnl / bankroll) * 100;

  if (dailyPnlPct <= -lossLimitPct) {
    return { allowed: false, reason: `Daily loss limit hit (${dailyPnlPct.toFixed(1)}% < -${lossLimitPct}%)` };
  }

  const currentExposure = exposure[sport.id] ?? 0;
  const exposurePct = ((currentExposure + proposedSize) / bankroll) * 100;
  if (exposurePct > sport.maxExposurePct) {
    return { allowed: false, reason: `${sport.name} exposure would exceed ${sport.maxExposurePct}% max (${exposurePct.toFixed(1)}%)` };
  }

  const singleEventMax = bankroll * (agentConfig.maxPerEventPct / 100);
  if (proposedSize > singleEventMax) {
    return { allowed: false, reason: `Position $${proposedSize.toFixed(2)} exceeds single event max $${singleEventMax.toFixed(2)}` };
  }

  return { allowed: true };
}

function computeRiskStatus(currentDailyPnl: number, bankroll: number): "normal" | "caution" | "halted" {
  const pct = (currentDailyPnl / bankroll) * 100;
  if (pct <= -agentConfig.dailyLossLimitPct) return "halted";
  if (pct <= -10) return "caution";
  return "normal";
}

// ── Core Scan Function ────────────────────────────────────────────────────────

async function scanSport(sport: SportConfig): Promise<SportsSignal[]> {
  const signals: SportsSignal[] = [];
  const { bankroll, maxPerEventPct } = agentConfig;
  const maxPerEvent = bankroll * (maxPerEventPct / 100);

  // Fetch ESPN data
  const espnData = sport.espnEndpoint ? await fetchESPN(sport.espnEndpoint) : null;
  const espnEvents = espnData ? parseESPNEvents(espnData) : [];

  // Fetch Kalshi markets for all series
  const allMarkets: any[] = [];
  for (const series of sport.kalshiSeries) {
    const markets = await fetchKalshiSeries(series);
    allMarkets.push(...markets);
  }

  if (allMarkets.length === 0) {
    return [];
  }

  for (const market of allMarkets) {
    const ticker = market.ticker ?? "";
    const title = market.title ?? "";
    const yesBid = parseFloat(market.yes_bid_dollars ?? "0") || 0;
    const yesAsk = parseFloat(market.yes_ask_dollars ?? "0") || 0;
    const volume = parseInt(market.volume_fp ?? "0", 10) || 0;

    // Volume filter: minimum 500 contracts
    if (volume < 500) continue;

    const midPrice = yesBid > 0 && yesAsk > 0 ? (yesBid + yesAsk) / 2 : yesBid || yesAsk;
    if (midPrice <= 0 || midPrice >= 1) continue;

    // Extreme price filter: skip contracts priced above 95¢ or below 5¢
    // These have no profit potential and Kalshi often rejects orders at these levels
    if (midPrice >= 0.95 || midPrice <= 0.05) continue;

    // Try to match to an ESPN event for enrichment
    const matchedEvent = espnEvents.find(e => {
      const lowerTitle = title.toLowerCase();
      const homeAbbr = e.homeAbbr.toLowerCase();
      const awayAbbr = e.awayAbbr.toLowerCase();
      const homeName = e.home.toLowerCase();
      const awayName = e.away.toLowerCase();
      return (
        lowerTitle.includes(homeAbbr) || lowerTitle.includes(awayAbbr) ||
        lowerTitle.includes(homeName) || lowerTitle.includes(awayName) ||
        ticker.toUpperCase().includes(e.homeAbbr) || ticker.toUpperCase().includes(e.awayAbbr)
      );
    });

    // Determine if this is a home or away team market
    const isHomeTeam = matchedEvent
      ? (title.toLowerCase().includes(matchedEvent.home.toLowerCase()) || ticker.toUpperCase().includes(matchedEvent.homeAbbr))
      : true; // default assumption

    const isLive = matchedEvent?.status === "in";
    const homeWinPct = matchedEvent?.homeWinPct ?? 0.5;
    const awayWinPct = matchedEvent?.awayWinPct ?? 0.5;

    let modelProb: number;
    let momentum: "home" | "away" | "neutral" = "neutral";

    if (isLive && matchedEvent) {
      modelProb = computeLiveWinProb(
        sport.id,
        matchedEvent.homeScore,
        matchedEvent.awayScore,
        matchedEvent.period,
        midPrice,
        isHomeTeam
      );
      momentum = detectMomentum(matchedEvent.homeScore, matchedEvent.awayScore, matchedEvent.period, sport.id);
      modelProb = clamp(modelProb + momentumBoost(momentum, isHomeTeam), 0.02, 0.98);
    } else {
      modelProb = computePreGameProb(midPrice, homeWinPct, awayWinPct, isHomeTeam, sport.id);
    }

    // Intelligence Layer 4: Stale price detection
    const staleInfo = detectStalePrice(ticker, midPrice);

    // Intelligence Layer 5: Cross-market correlation
    const eventTicker = market.event_ticker || ticker.split("-").slice(0, -1).join("-");
    const marketType = ticker.includes("PTS") || ticker.includes("TOTAL") ? "total"
      : ticker.includes("SPREAD") ? "spread" : "moneyline";
    const crossMarketAlpha = detectCrossMarketLag(eventTicker, marketType, midPrice);

    // If price is stale during a live game, boost model confidence
    if (staleInfo.isStale && isLive) {
      // Stale price = market hasn't caught up to score changes
      // Boost model probability in the direction the score suggests
      const staleBoost = staleInfo.priceVelocity > 0 ? 0.02 : staleInfo.priceVelocity < 0 ? -0.02 : 0;
      modelProb = clamp(modelProb + staleBoost, 0.03, 0.97);
    }

    // Cross-market alpha adds to the edge
    if (crossMarketAlpha > 0.02) {
      modelProb = clamp(modelProb + crossMarketAlpha * 0.5, 0.03, 0.97);
    }

    const edge = modelProb - midPrice;
    const edgePct = edge * 100;

    // Filter by edge threshold
    if (Math.abs(edgePct) < sport.edgeThreshold) continue;

    // Determine action
    let action: SportsSignal["action"] = "NO_TRADE";
    let side = "yes";
    if (edgePct >= sport.edgeThreshold) {
      action = "BUY_YES";
      side = "yes";
    } else if (edgePct <= -sport.edgeThreshold) {
      action = "BUY_NO";
      side = "no";
    }

    if (action === "NO_TRADE") continue;

    // Kelly sizing
    const absEdge = Math.abs(edge);
    const { kellyFraction, positionSizeUsd } = calculateQuarterKelly(
      absEdge, modelProb, bankroll, maxPerEvent, sport.modelWeight
    );

    if (positionSizeUsd < 1) continue;

    // Risk check
    const riskCheck = checkRiskLimits(dailyPnl, bankroll, sportExposure, sport, positionSizeUsd);

    // Apply caution mode: halve position sizes
    const riskStatus = computeRiskStatus(dailyPnl, bankroll);
    const finalSize = riskStatus === "caution" ? positionSizeUsd / 2 : positionSizeUsd;

    const confidence = clamp(sport.modelWeight * (0.5 + Math.abs(edgePct) / 20), 0, 1);
    const riskLevel: SportsSignal["riskLevel"] = Math.abs(edgePct) > 15 ? "high" : Math.abs(edgePct) > 8 ? "medium" : "low";

    const eventName = matchedEvent
      ? `${matchedEvent.away} @ ${matchedEvent.home}`
      : title;

    const scoreStr = matchedEvent && isLive
      ? `${matchedEvent.awayScore}-${matchedEvent.homeScore}`
      : undefined;
    const periodStr = matchedEvent && isLive
      ? `Q${matchedEvent.period} ${matchedEvent.clock}`
      : undefined;

    // Build intelligence context for reasoning
    const intel: string[] = [];
    if (staleInfo.isStale && isLive) intel.push("STALE PRICE detected");
    if (crossMarketAlpha > 0.02) intel.push(`Cross-mkt lag +${(crossMarketAlpha * 100).toFixed(1)}%`);
    if (momentum !== "neutral") intel.push(`Momentum: ${momentum}`);
    const comebackRate = isLive && matchedEvent && (isHomeTeam ? matchedEvent.homeScore < matchedEvent.awayScore : matchedEvent.awayScore < matchedEvent.homeScore)
      ? getComebackProb(sport.id, isHomeTeam ? matchedEvent.homeScore - matchedEvent.awayScore : matchedEvent.awayScore - matchedEvent.homeScore, matchedEvent.period)
      : null;
    if (comebackRate !== null) intel.push(`Comeback rate: ${(comebackRate * 100).toFixed(0)}%`);
    const intelStr = intel.length > 0 ? ` [${intel.join(" | ")}]` : "";

    const reasoning = isLive && matchedEvent
      ? `${sport.name}: ${matchedEvent.away} ${matchedEvent.awayScore} - ${matchedEvent.home} ${matchedEvent.homeScore} (${periodStr}). Model: ${(modelProb * 100).toFixed(0)}% vs Kalshi: ${(midPrice * 100).toFixed(0)}¢. Edge: ${edgePct >= 0 ? "+" : ""}${edgePct.toFixed(1)}%.${intelStr} ${riskCheck.allowed ? `${action} $${finalSize.toFixed(2)}` : `BLOCKED: ${riskCheck.reason}`}`
      : `${sport.name}: ${eventName}. Model: ${(modelProb * 100).toFixed(0)}% vs Kalshi: ${(midPrice * 100).toFixed(0)}¢. Edge: ${edgePct >= 0 ? "+" : ""}${edgePct.toFixed(1)}%.${intelStr} ${riskCheck.allowed ? `${action} $${finalSize.toFixed(2)}` : `BLOCKED: ${riskCheck.reason}`}`;

    signals.push({
      id: `${sport.id}-${ticker}-${Date.now()}`,
      sport: sport.id,
      event: eventName,
      side,
      ticker,
      kalshiPrice: midPrice,
      modelProbability: modelProb,
      edge: edgePct,
      action: riskCheck.allowed ? action : "NO_TRADE",
      kellyFraction,
      positionSizeUsd: riskCheck.allowed ? finalSize : 0,
      reasoning,
      confidence,
      riskLevel,
      dataSource: [
        "Kalshi",
        matchedEvent ? "ESPN Live" : null,
        staleInfo.isStale ? "Stale-Detect" : null,
        crossMarketAlpha > 0.02 ? "Cross-Mkt" : null,
        comebackRate !== null ? "Comeback-Model" : null,
      ].filter(Boolean).join(" + "),
      createdAt: new Date().toISOString(),
      isLive,
      score: scoreStr,
      period: periodStr,
      momentum,
    });
  }

  return signals;
}

export async function scanAllSports(sports: SportConfig[]): Promise<SportsSignal[]> {
  const allSignals: SportsSignal[] = [];
  const enabledSports = sports.filter(s => s.enabled);

  // Scan each sport sequentially to avoid rate limiting
  for (const sport of enabledSports) {
    try {
      const signals = await scanSport(sport);
      allSignals.push(...signals);
    } catch (err) {
      console.error(`[Sports Agent] Error scanning ${sport.name}:`, err);
    }
  }

  // Sort by absolute edge descending
  allSignals.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  return allSignals;
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

export async function runSportsAgentScan(
  enabledSports?: SportConfig[]
): Promise<SportsAgentState> {
  const sports = enabledSports ?? sportsConfigs;
  const { bankroll } = agentConfig;

  const signals = await scanAllSports(sports);
  const riskStatus = computeRiskStatus(dailyPnl, bankroll);
  const dailyPnlPct = bankroll > 0 ? (dailyPnl / bankroll) * 100 : 0;

  return {
    running: true,
    bankroll,
    dailyPnl,
    dailyPnlPct,
    tradesToday,
    openPositions,
    sportExposure: { ...sportExposure },
    signals,
    sports: sports.map(s => ({ ...s })),
    lastScan: new Date().toISOString(),
    riskStatus,
  };
}
