/**
 * Live Sports In-Game Trading Engine
 *
 * Monitors NBA games via ESPN's free API (no key required) and
 * generates trading signals for Kalshi KXNBAGAME markets based on
 * real-time score differentials vs. current Kalshi market prices.
 */

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LiveGame {
  espnId: string;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  period: number;
  clock: string;
  status: "pre" | "in" | "post";
  kalshiHomeTicker: string | null;
  kalshiAwayTicker: string | null;
  kalshiHomePrice: number;
  kalshiAwayPrice: number;
  modelHomeProb: number;
  modelAwayProb: number;
  homeEdge: number;
  awayEdge: number;
  signal: "BUY_HOME" | "BUY_AWAY" | "SELL_HOME" | "SELL_AWAY" | "HOLD" | "NONE";
  reasoning: string;
  gameTime: string; // scheduled start ISO string or "Live"
}

export interface LiveSportsState {
  activeGames: LiveGame[];
  upcomingGames: LiveGame[];
  completedGames: LiveGame[];
  tradesToday: number;
  livePnl: number;
  activePositions: number;
  lastScan: string;
  engineRunning: boolean;
}

// ── ESPN team abbreviation normalisation ─────────────────────────────────────
// ESPN sometimes uses different codes from Kalshi tickers. Normalise to 3-char.
const ESPN_TO_KALSHI: Record<string, string> = {
  GS: "GSW",
  NY: "NYK",
  NOP: "NO",
  SA: "SAS",
  UTA: "UTAH",
  WSH: "WAS",
  CHA: "CHA",
  OKC: "OKC",
};

function normalise(abbr: string): string {
  const up = abbr.toUpperCase();
  return ESPN_TO_KALSHI[up] ?? up;
}

// Month abbreviation → Kalshi 3-letter
const MONTH_TO_KALSHI = [
  "JAN","FEB","MAR","APR","MAY","JUN",
  "JUL","AUG","SEP","OCT","NOV","DEC",
];

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "KalshiBot-LiveSports/1.0",
    },
  });
  if (!res.ok) throw new Error(`Fetch error ${res.status}: ${url}`);
  return res.json();
}

// Simple in-memory cache to avoid hammering Kalshi
const kalshiCache: Record<string, { data: any; ts: number }> = {};
const KALSHI_CACHE_TTL = 12_000; // 12 seconds

async function kalshiFetchCached(path: string): Promise<any> {
  const now = Date.now();
  if (kalshiCache[path] && now - kalshiCache[path].ts < KALSHI_CACHE_TTL) {
    return kalshiCache[path].data;
  }
  const res = await fetch(`${KALSHI_BASE}${path}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "KalshiBot-LiveSports/1.0",
    },
  });
  if (!res.ok) throw new Error(`Kalshi API error: ${res.status}`);
  const data = await res.json();
  kalshiCache[path] = { data, ts: now };
  return data;
}

// ── 1. Fetch ESPN scoreboard ───────────────────────────────────────────────────

interface ESPNGame {
  id: string;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  period: number;
  clock: string;
  status: "pre" | "in" | "post";
  gameTime: string;
}

export async function fetchESPNScoreboard(): Promise<ESPNGame[]> {
  try {
    const data = await fetchJSON(ESPN_SCOREBOARD);
    const events: any[] = data?.events ?? [];
    const games: ESPNGame[] = [];

    for (const event of events) {
      const comp: any[] = event?.competitions?.[0]?.competitors ?? [];
      if (comp.length < 2) continue;

      // ESPN competitions: home/away indicated by homeAway field
      let homeTeam: any = null;
      let awayTeam: any = null;
      for (const c of comp) {
        if (c.homeAway === "home") homeTeam = c;
        else awayTeam = c;
      }
      if (!homeTeam || !awayTeam) continue;

      const statusType = event?.competitions?.[0]?.status?.type;
      const state = statusType?.state ?? "pre"; // "pre" | "in" | "post"
      let status: "pre" | "in" | "post" = "pre";
      if (state === "in") status = "in";
      else if (state === "post") status = "post";

      const period = event?.competitions?.[0]?.status?.period ?? 1;
      const clock = event?.competitions?.[0]?.status?.displayClock ?? "0:00";

      games.push({
        id: event.id,
        away: (awayTeam.team?.abbreviation ?? "").toUpperCase(),
        home: (homeTeam.team?.abbreviation ?? "").toUpperCase(),
        awayScore: parseInt(awayTeam.score ?? "0", 10) || 0,
        homeScore: parseInt(homeTeam.score ?? "0", 10) || 0,
        period,
        clock,
        status,
        gameTime: event?.competitions?.[0]?.date ?? new Date().toISOString(),
      });
    }

    return games;
  } catch (e) {
    console.error("[Live Sports] ESPN fetch error:", e);
    return [];
  }
}

// ── 2. Match ESPN games to Kalshi KXNBAGAME markets ──────────────────────────

interface KalshiMarketInfo {
  ticker: string;
  team: string; // which team this market is for
  yesBid: number;
  yesAsk: number;
}

// Build a ticker date string like "26MAR28" from a Date
function tickerDate(d: Date): string {
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mon = MONTH_TO_KALSHI[d.getUTCMonth()];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}${mon}${dd}`;
}

async function fetchKalshiNBAMarkets(): Promise<KalshiMarketInfo[]> {
  try {
    const data = await kalshiFetchCached(
      "/markets?status=open&limit=100&series_ticker=KXNBAGAME"
    );
    const markets: any[] = data?.markets ?? [];
    return markets
      .filter((m: any) => m.ticker?.startsWith("KXNBAGAME"))
      .map((m: any) => ({
        ticker: m.ticker,
        team: "", // filled below
        yesBid: parseFloat(m.yes_bid_dollars ?? "0") || 0,
        yesAsk: parseFloat(m.yes_ask_dollars ?? "0") || 0,
      }));
  } catch (e) {
    console.error("[Live Sports] Kalshi NBA market fetch error:", e);
    return [];
  }
}

// Parse ticker: KXNBAGAME-26MAR28SACATL-ATL
// Returns { away, home, team } or null
function parseTicker(ticker: string): { away: string; home: string; team: string } | null {
  // Pattern: KXNBAGAME-{DATE}{AWAY}{HOME}-{TEAM}
  const match = ticker.match(/^KXNBAGAME-\d{2}[A-Z]{3}\d{2}([A-Z]+)([A-Z]+)-([A-Z]+)$/);
  if (!match) return null;
  // The away/home split is ambiguous since team codes vary in length (2-4 chars).
  // We'll try all possible splits.
  const combined = match[1] + match[2]; // e.g. "SACATL"
  const team = match[3]; // e.g. "ATL"

  // Try to find the split point where both halves are valid team codes
  // by checking if team matches one of the halves
  for (let i = 2; i <= combined.length - 2; i++) {
    const away = combined.slice(0, i);
    const home = combined.slice(i);
    if (away === team || home === team) {
      return { away, home, team };
    }
  }
  // Fallback: team is last 3 chars of the combined away+home
  return null;
}

// Alternative simpler parser: extract the suffix team and figure out matchup
function parseTickerV2(ticker: string): { away: string; home: string; team: string } | null {
  // KXNBAGAME-{YY}{MON}{DD}{AWAY}{HOME}-{TEAM}
  const outerMatch = ticker.match(/^KXNBAGAME-\d{2}[A-Z]{3}\d{2}([A-Z]+)-([A-Z]+)$/);
  if (!outerMatch) return null;
  const awayHome = outerMatch[1]; // e.g. "SACATL"
  const team = outerMatch[2];     // e.g. "ATL"

  // Try all splits
  for (let i = 2; i <= awayHome.length - 2; i++) {
    const away = awayHome.slice(0, i);
    const home = awayHome.slice(i);
    if (away === team || home === team) {
      return { away, home, team };
    }
  }
  return null;
}

export async function matchKalshiMarkets(
  games: ESPNGame[]
): Promise<Array<{ game: ESPNGame; homeMarket: KalshiMarketInfo | null; awayMarket: KalshiMarketInfo | null }>> {
  const kalshiMarkets = await fetchKalshiNBAMarkets();
  const results = [];

  for (const game of games) {
    const awayNorm = normalise(game.away);
    const homeNorm = normalise(game.home);

    let homeMarket: KalshiMarketInfo | null = null;
    let awayMarket: KalshiMarketInfo | null = null;

    for (const km of kalshiMarkets) {
      const parsed = parseTickerV2(km.ticker);
      if (!parsed) continue;

      const { away, home, team } = parsed;
      // Match: both teams must match (with normalisation tolerance)
      const awayMatch =
        away === awayNorm ||
        away === game.away ||
        awayNorm.startsWith(away) ||
        away.startsWith(awayNorm);
      const homeMatch =
        home === homeNorm ||
        home === game.home ||
        homeNorm.startsWith(home) ||
        home.startsWith(homeNorm);

      if (awayMatch && homeMatch) {
        const enriched: KalshiMarketInfo = { ...km, team };
        if (team === homeNorm || team === game.home || homeNorm.startsWith(team) || team.startsWith(homeNorm)) {
          homeMarket = enriched;
        } else {
          awayMarket = enriched;
        }
      }
    }

    results.push({ game, homeMarket, awayMarket });
  }

  return results;
}

// ── 3. Live win probability model ────────────────────────────────────────────

const PERIOD_WEIGHT: Record<number, number> = {
  1: 0.005,
  2: 0.008,
  3: 0.012,
  4: 0.020,
  5: 0.030, // OT
  6: 0.030,
  7: 0.030,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function calculateLiveWinProb(
  homeScore: number,
  awayScore: number,
  period: number,
  preGameHomePrice: number
): { homeProb: number; awayProb: number } {
  const base = clamp(preGameHomePrice, 0.02, 0.98);
  const scoreDiff = homeScore - awayScore; // positive = home leading
  const weight = PERIOD_WEIGHT[period] ?? PERIOD_WEIGHT[4];

  const homeProb = clamp(base + scoreDiff * weight, 0.02, 0.98);
  const awayProb = clamp(1 - homeProb, 0.02, 0.98);

  return {
    homeProb: parseFloat(homeProb.toFixed(4)),
    awayProb: parseFloat(awayProb.toFixed(4)),
  };
}

// ── 4. Clock-to-minutes helper ───────────────────────────────────────────────

function clockToMinutes(clock: string): number {
  // Format: "MM:SS" or "M:SS"
  const parts = clock.split(":");
  if (parts.length !== 2) return 99;
  const mins = parseInt(parts[0], 10) || 0;
  const secs = parseInt(parts[1], 10) || 0;
  return mins + secs / 60;
}

// ── 5. Main signal generation ─────────────────────────────────────────────────

const EDGE_THRESHOLD = 0.05; // 5% minimum edge to trade
const MAX_POSITIONS = 3;

// Simple in-memory trade tracker (resets on server restart)
let tradesToday = 0;
let activePositionTickers = new Set<string>();

export async function generateLiveSportsSignals(): Promise<LiveSportsState> {
  const now = new Date().toISOString();
  const espnGames = await fetchESPNScoreboard();
  const matched = await matchKalshiMarkets(espnGames);

  const activeGames: LiveGame[] = [];
  const upcomingGames: LiveGame[] = [];
  const completedGames: LiveGame[] = [];

  for (const { game, homeMarket, awayMarket } of matched) {
    const kalshiHomePrice = homeMarket
      ? (homeMarket.yesBid + homeMarket.yesAsk) / 2 || homeMarket.yesBid || homeMarket.yesAsk
      : 0.5;
    const kalshiAwayPrice = awayMarket
      ? (awayMarket.yesBid + awayMarket.yesAsk) / 2 || awayMarket.yesBid || awayMarket.yesAsk
      : 1 - kalshiHomePrice;

    // Pre-game price as base for model
    const preGameHomePrice =
      kalshiHomePrice > 0 && kalshiHomePrice < 1 ? kalshiHomePrice : 0.5;

    const { homeProb, awayProb } = calculateLiveWinProb(
      game.homeScore,
      game.awayScore,
      game.period,
      preGameHomePrice
    );

    const homeEdge = homeProb - kalshiHomePrice;
    const awayEdge = awayProb - kalshiAwayPrice;

    // Determine signal
    let signal: LiveGame["signal"] = "NONE";
    let reasoning = "";

    if (game.status === "in") {
      // Block trades in final 2 min of Q4
      const minsLeft = clockToMinutes(game.clock);
      const isQ4Final2 = game.period === 4 && minsLeft <= 2;

      if (isQ4Final2) {
        signal = "HOLD";
        reasoning = `Final 2 minutes of Q4 — spread is too wide and convergence risk is high. No new trades.`;
      } else if (activePositionTickers.size >= MAX_POSITIONS) {
        signal = "HOLD";
        reasoning = `Max simultaneous positions (${MAX_POSITIONS}) reached. Waiting for existing positions to resolve.`;
      } else if (homeEdge > EDGE_THRESHOLD) {
        signal = "BUY_HOME";
        reasoning = `${game.home} leads ${game.homeScore}-${game.awayScore} in Q${game.period} (${game.clock}). Model: ${(homeProb * 100).toFixed(0)}% vs Kalshi: ${(kalshiHomePrice * 100).toFixed(0)}¢. Edge: +${(homeEdge * 100).toFixed(1)}%. Buy home.`;
      } else if (awayEdge > EDGE_THRESHOLD) {
        signal = "BUY_AWAY";
        reasoning = `${game.away} leads ${game.awayScore}-${game.homeScore} in Q${game.period} (${game.clock}). Model: ${(awayProb * 100).toFixed(0)}% vs Kalshi: ${(kalshiAwayPrice * 100).toFixed(0)}¢. Edge: +${(awayEdge * 100).toFixed(1)}%. Buy away.`;
      } else if (homeEdge < -EDGE_THRESHOLD) {
        signal = "SELL_HOME";
        reasoning = `Model shows ${game.home} is overpriced — model: ${(homeProb * 100).toFixed(0)}% vs Kalshi: ${(kalshiHomePrice * 100).toFixed(0)}¢. Edge: ${(homeEdge * 100).toFixed(1)}%. Consider selling home.`;
      } else if (awayEdge < -EDGE_THRESHOLD) {
        signal = "SELL_AWAY";
        reasoning = `Model shows ${game.away} is overpriced — model: ${(awayProb * 100).toFixed(0)}% vs Kalshi: ${(kalshiAwayPrice * 100).toFixed(0)}¢. Edge: ${(awayEdge * 100).toFixed(1)}%. Consider selling away.`;
      } else {
        signal = "HOLD";
        const maxEdge = Math.max(Math.abs(homeEdge), Math.abs(awayEdge));
        reasoning = `${game.home} ${game.homeScore} — ${game.away} ${game.awayScore}, Q${game.period} ${game.clock}. Max edge: ${(maxEdge * 100).toFixed(1)}% (threshold: ${EDGE_THRESHOLD * 100}%). No trade.`;
      }
    } else if (game.status === "pre") {
      reasoning = `Upcoming: ${game.away} @ ${game.home} — ${new Date(game.gameTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    } else {
      reasoning = `Final: ${game.away} ${game.awayScore} — ${game.home} ${game.homeScore}`;
    }

    const liveGame: LiveGame = {
      espnId: game.id,
      away: game.away,
      home: game.home,
      awayScore: game.awayScore,
      homeScore: game.homeScore,
      period: game.period,
      clock: game.clock,
      status: game.status,
      kalshiHomeTicker: homeMarket?.ticker ?? null,
      kalshiAwayTicker: awayMarket?.ticker ?? null,
      kalshiHomePrice: parseFloat(kalshiHomePrice.toFixed(4)),
      kalshiAwayPrice: parseFloat(kalshiAwayPrice.toFixed(4)),
      modelHomeProb: homeProb,
      modelAwayProb: awayProb,
      homeEdge: parseFloat(homeEdge.toFixed(4)),
      awayEdge: parseFloat(awayEdge.toFixed(4)),
      signal,
      reasoning,
      gameTime: game.gameTime,
    };

    if (game.status === "in") activeGames.push(liveGame);
    else if (game.status === "pre") upcomingGames.push(liveGame);
    else completedGames.push(liveGame);
  }

  // Sort active by period desc (latest games first)
  activeGames.sort((a, b) => b.period - a.period);
  // Sort upcoming by gameTime
  upcomingGames.sort(
    (a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()
  );

  return {
    activeGames,
    upcomingGames,
    completedGames,
    tradesToday,
    livePnl: 0, // Would be computed from open positions in a full implementation
    activePositions: activePositionTickers.size,
    lastScan: now,
    engineRunning: true,
  };
}
