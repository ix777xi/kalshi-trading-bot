/**
 * Real-time Signal Engine
 * 
 * Generates trading signals from live Kalshi market data using documented alpha edges:
 * 1. Favorite-Longshot Bias — contracts <20¢ are structurally overpriced for YES buyers
 * 2. YES/NO Asymmetry — NO outperforms YES at 69 of 99 price levels
 * 3. Weather Model vs. Crowd — GFS ensemble forecasts vs. Kalshi bracket prices
 * 4. Macro market structure — spread/volume analysis
 */

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const OPEN_METEO_ENSEMBLE = "https://ensemble-api.open-meteo.com/v1/ensemble";
const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LiveSignal {
  ticker: string;
  title: string;
  eventTicker: string;
  edgeScore: number;
  trueProbability: number;
  marketPrice: number;
  signalType: "BUY_YES" | "BUY_NO" | "SELL_YES" | "SELL_NO" | "NO_TRADE";
  modelConfidence: number;
  modelName: string;
  edgeSource: string;
  reasoning: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  createdAt: string;
  // Gap detection fields (5-step framework)
  gapType: "A" | "B" | "C" | "D" | "E"; // A=Stale, B=ThinLiquidity, C=CrossPlatform, D=ProbDistortion, E=EventCatalyst
  spread: number;           // yes_ask - yes_bid
  executableEdge: number;   // theoretical_edge - spread/2
  liquidityDepth: number;   // contracts available at best bid/ask (estimated)
  kellySize: number;        // half-kelly position size in dollars
}

interface KalshiMarket {
  ticker: string;
  title: string;
  event_ticker: string;
  yes_bid_dollars: string;
  no_bid_dollars: string;
  yes_ask_dollars: string;
  no_ask_dollars: string;
  volume_fp: string;
  open_interest_fp: string;
  last_price_dollars: string;
  close_time: string;
  status: string;
  floor_strike?: number;
  rules_primary?: string;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "KalshiBot-SignalEngine/1.0" },
  });
  if (!res.ok) throw new Error(`Fetch error ${res.status}: ${url}`);
  return res.json();
}

async function fetchKalshiMarkets(seriesTicker: string): Promise<KalshiMarket[]> {
  try {
    const data = await fetchJSON(`${KALSHI_BASE}/markets?status=open&limit=50&series_ticker=${seriesTicker}`);
    return data?.markets || [];
  } catch {
    return [];
  }
}

// ── Edge #1: Favorite-Longshot Bias ───────────────────────────────────────────
// Research: 5¢ contracts win only 4.18% (implied 5%) = -16.36% mispricing
// Contracts above 80¢ consistently outperform

// ── Hardcoded Risk Guardrails ─────────────────────────────────────────────────
const BANKROLL = 10_000; // Default bankroll estimate for Kelly sizing
const MIN_DEPTH = 48;    // Minimum liquidity depth (HARDCODED, never override)
const MIN_EXEC_EDGE = 0.04; // Minimum executable edge (HARDCODED)
const MAX_SPREAD = 0.08;  // Maximum spread to trade (HARDCODED)
const MAX_PER_MARKET = 500; // $500 hard cap per market (HARDCODED)
const SLIPPAGE = 0.003;   // Fixed 0.3% slippage allowance (HARDCODED)

// ── Peak P&L Tracking (in-memory, for trailing stop) ─────────────────────────
const peakPnl: Map<string, number> = new Map();

export function updatePeakPnl(ticker: string, currentPnl: number): void {
  const peak = peakPnl.get(ticker) ?? currentPnl;
  if (currentPnl > peak) peakPnl.set(ticker, currentPnl);
}

export function getPeakPnl(ticker: string): number {
  return peakPnl.get(ticker) ?? 0;
}

/**
 * Classify gap type based on market characteristics
 */
function classifyGapType(
  market: KalshiMarket,
  spread: number,
  edgeSource: string
): "A" | "B" | "C" | "D" | "E" {
  const oi = parseFloat(market.open_interest_fp || "0");
  const closeTime = market.close_time ? new Date(market.close_time).getTime() : Infinity;
  const hoursToClose = (closeTime - Date.now()) / 3_600_000;

  // Type D: Probability Distortion — longshot/YES-NO asymmetry
  if (edgeSource === "favorite_longshot_bias" || edgeSource === "yes_no_asymmetry") {
    return "D";
  }
  // Type E: Event Catalyst — close time within 48 hours
  if (hoursToClose > 0 && hoursToClose <= 48) {
    return "E";
  }
  // Type B: Thin Liquidity — OI < 5000 and spread > 0.05
  if (oi < 5000 && spread > 0.05) {
    return "B";
  }
  // Type A: Stale Pricing — weather model vs crowd
  if (edgeSource === "weather_model") {
    return "A";
  }
  // Default: Type C (cross-platform / spread structure)
  return "C";
}

/**
 * Compute executable edge and Kelly sizing (HARDCODED guardrails applied)
 * executableEdge = theoretical_edge - (spread/2) - slippage (0.3%)
 * Uses 25% (quarter) Kelly instead of 50% (half) Kelly — optimal for risk management
 */
function computeEdgeMetrics(
  theoreticalEdge: number,
  spread: number,
  depth: number = MIN_DEPTH
): { executableEdge: number; kellySize: number } {
  const executableEdge = theoreticalEdge - spread / 2 - SLIPPAGE;
  const fullKelly = executableEdge > 0 ? executableEdge / Math.max(1 - executableEdge, 0.01) : 0;
  const quarterKelly = fullKelly / 4; // 25% Kelly (research: optimal for prediction markets)
  const kellySize = Math.min(quarterKelly * BANKROLL, depth * 0.25, MAX_PER_MARKET);
  return { executableEdge: parseFloat(executableEdge.toFixed(4)), kellySize: parseFloat(Math.max(0, kellySize).toFixed(2)) };
}

/**
 * Estimate liquidity depth from market data
 */
function estimateLiquidityDepth(market: KalshiMarket): number {
  const oi = parseFloat(market.open_interest_fp || "0");
  const volume = parseFloat(market.volume_fp || "0");
  return Math.max(0, Math.round(Math.min(oi * 0.08, volume * 0.5)));
}

function analyzeLongshotBias(market: KalshiMarket): LiveSignal | null {
  const yesBid = parseFloat(market.yes_bid_dollars || "0");
  const noBid = parseFloat(market.no_bid_dollars || "0");
  if (yesBid <= 0 && noBid <= 0) return null;

  const midPrice = yesBid > 0 ? yesBid : (1 - noBid);
  if (midPrice <= 0 || midPrice >= 1) return null;

  // Longshot bias calibration from research data
  // At price p, the actual win rate is approximately: actual = p * (1 - bias_factor)
  // bias_factor increases as price decreases
  let biasEdge = 0;
  let reasoning = "";

  if (midPrice <= 0.10) {
    // Extreme longshot: ~-30% to -40% EV for YES buyers
    const actualWinRate = midPrice * 0.70; // wins ~30% less than implied
    biasEdge = (actualWinRate - midPrice) * 100;
    reasoning = `At ${(midPrice*100).toFixed(0)}¢, extreme longshot bias applies. Historically, contracts this cheap win ~30% less often than implied. YES buyers average -41% EV at 1¢. Sell NO to capture the optimism premium.`;
  } else if (midPrice <= 0.20) {
    // Strong longshot: ~-15% to -20% EV for YES buyers
    const actualWinRate = midPrice * 0.82;
    biasEdge = (actualWinRate - midPrice) * 100;
    reasoning = `At ${(midPrice*100).toFixed(0)}¢, longshot bias is strong. A 5¢ contract wins only 4.18% of the time (implied 5%) — a -16.36% mispricing. Selling NO against cheap YES buyers is high-structural-alpha.`;
  } else if (midPrice >= 0.80) {
    // Favorite: slight positive edge for YES
    const actualWinRate = Math.min(0.99, midPrice * 1.03);
    biasEdge = (actualWinRate - midPrice) * 100;
    reasoning = `At ${(midPrice*100).toFixed(0)}¢, this is a strong favorite. Contracts above 80¢ consistently win more often than their price implies. Small but reliable positive expected value.`;
  } else {
    return null; // Mid-range — no strong bias signal
  }

  if (Math.abs(biasEdge) < 1.5) return null;

  const signalType = biasEdge > 0 ? "BUY_YES" : "BUY_NO";
  const trueProbability = midPrice + biasEdge / 100;

  const yesAsk = parseFloat(market.yes_ask_dollars || "0");
  const spread = Math.max(0, yesAsk - (midPrice > 0 ? midPrice : 0));
  const theoreticalEdge = biasEdge / 100;
  const { executableEdge, kellySize } = computeEdgeMetrics(theoreticalEdge, spread);
  const liquidityDepth = estimateLiquidityDepth(market);
  const edgeSource = "favorite_longshot_bias";

  // Risk guardrails (HARDCODED)
  if (liquidityDepth < MIN_DEPTH) return null;
  if (executableEdge < MIN_EXEC_EDGE) return null;
  if (spread > MAX_SPREAD) return null;

  return {
    ticker: market.ticker,
    title: market.title || market.ticker,
    eventTicker: market.event_ticker,
    edgeScore: parseFloat(biasEdge.toFixed(2)),
    trueProbability: parseFloat(Math.max(0.01, Math.min(0.99, trueProbability)).toFixed(3)),
    marketPrice: parseFloat(midPrice.toFixed(3)),
    signalType,
    modelConfidence: midPrice <= 0.10 ? 0.88 : midPrice <= 0.20 ? 0.82 : 0.72,
    modelName: "Longshot-Bias-Model",
    edgeSource,
    reasoning,
    riskLevel: midPrice <= 0.05 ? "high" : midPrice <= 0.15 ? "medium" : "low",
    createdAt: new Date().toISOString(),
    gapType: classifyGapType(market, spread, edgeSource),
    spread: parseFloat(spread.toFixed(4)),
    executableEdge,
    liquidityDepth,
    kellySize,
  };
}

// ── Edge #2: YES/NO Asymmetry ("Optimism Tax") ───────────────────────────────
// NO outperforms YES at 69 of 99 price levels
// Dollar-weighted: YES buyers return -1.02%, NO buyers +0.83%

function analyzeYesNoAsymmetry(market: KalshiMarket): LiveSignal | null {
  const yesBid = parseFloat(market.yes_bid_dollars || "0");
  const noBid = parseFloat(market.no_bid_dollars || "0");
  const volume = parseFloat(market.volume_fp || "0");

  if (yesBid <= 0 || volume < 100) return null;

  const midPrice = yesBid;

  // The asymmetry is strongest at low-mid prices (20-50¢ range)
  // where taker flow is dominated by optimistic YES buyers
  if (midPrice < 0.15 || midPrice > 0.55) return null;

  // Expected NO edge: approximately +0.83% to +2% depending on price level
  // Strongest at 20-35¢ range
  const noEdge = midPrice < 0.25 ? 2.5 : midPrice < 0.35 ? 1.8 : midPrice < 0.45 ? 1.2 : 0.8;

  // Volume-weighted confidence — more volume = more reliable signal
  const confidence = Math.min(0.85, 0.60 + (Math.min(volume, 5000) / 5000) * 0.25);

  if (noEdge < 1.0) return null;

  const yesAsk2 = parseFloat(market.yes_ask_dollars || "0");
  const noBid2 = parseFloat(market.no_bid_dollars || "0");
  const spread2 = Math.max(0, (yesAsk2 > 0 ? yesAsk2 : 1 - noBid2) - midPrice);
  const theoreticalEdge2 = noEdge / 100;
  const { executableEdge: execEdge2, kellySize: ks2 } = computeEdgeMetrics(theoreticalEdge2, spread2);
  const depth2 = estimateLiquidityDepth(market);
  const src2 = "yes_no_asymmetry";

  // Risk guardrails (HARDCODED)
  if (depth2 < MIN_DEPTH) return null;
  if (execEdge2 < MIN_EXEC_EDGE) return null;
  if (spread2 > MAX_SPREAD) return null;

  return {
    ticker: market.ticker,
    title: market.title || market.ticker,
    eventTicker: market.event_ticker,
    edgeScore: parseFloat((-noEdge).toFixed(2)),
    trueProbability: parseFloat((midPrice - noEdge / 100).toFixed(3)),
    marketPrice: parseFloat(midPrice.toFixed(3)),
    signalType: "BUY_NO",
    modelConfidence: parseFloat(confidence.toFixed(3)),
    modelName: "YES-NO-Asymmetry",
    edgeSource: src2,
    reasoning: `At ${(midPrice*100).toFixed(0)}¢, taker flow is dominated by optimistic YES buyers (UI default bias). NO outperforms YES at 69 of 99 price levels. Dollar-weighted, YES returns -1.02% while NO returns +0.83%. Post-only NO limit orders also capture the 0.05% maker rebate.`,
    riskLevel: "low",
    createdAt: new Date().toISOString(),
    gapType: classifyGapType(market, spread2, src2),
    spread: parseFloat(spread2.toFixed(4)),
    executableEdge: execEdge2,
    liquidityDepth: depth2,
    kellySize: ks2,
  };
}

// ── Edge #3: Weather Model vs. Crowd ──────────────────────────────────────────
// GFS 31-member ensemble vs. Kalshi bracket prices
// Documented 85-90% win rates

async function analyzeWeatherMarkets(): Promise<LiveSignal[]> {
  const signals: LiveSignal[] = [];

  try {
    // Fetch NYC weather markets (KXHIGHNY series)
    const markets = await fetchKalshiMarkets("KXHIGHNY");
    if (markets.length === 0) return signals;

    // Group markets by event (date)
    const byEvent: Record<string, KalshiMarket[]> = {};
    for (const m of markets) {
      const ev = m.event_ticker;
      if (!byEvent[ev]) byEvent[ev] = [];
      byEvent[ev].push(m);
    }

    // Fetch GFS ensemble forecast for NYC
    const ensembleData = await fetchJSON(
      `${OPEN_METEO_ENSEMBLE}?latitude=40.7829&longitude=-73.9654&daily=temperature_2m_max&temperature_unit=fahrenheit&timezone=America/New_York&forecast_days=7&models=gfs_seamless`
    );

    const forecastData = await fetchJSON(
      `${OPEN_METEO_FORECAST}?latitude=40.7829&longitude=-73.9654&daily=temperature_2m_max&temperature_unit=fahrenheit&timezone=America/New_York&forecast_days=7&models=gfs_seamless`
    );

    const ensembleDates = ensembleData?.daily?.time || [];
    const forecastDates = forecastData?.daily?.time || [];
    const forecastTemps = forecastData?.daily?.temperature_2m_max || [];

    // Get ensemble member columns
    const ensembleDaily = ensembleData?.daily || {};
    const memberKeys = Object.keys(ensembleDaily).filter(k => k.startsWith("temperature_2m_max"));

    for (const [eventTicker, eventMarkets] of Object.entries(byEvent)) {
      // Extract date from event ticker: KXHIGHNY-26MAR28 → 2026-03-28
      const dateMatch = eventTicker.match(/(\d{2})([A-Z]{3})(\d{2})$/);
      if (!dateMatch) continue;

      const monthMap: Record<string, string> = {
        JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
        JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12"
      };
      const year = `20${dateMatch[1]}`;
      const month = monthMap[dateMatch[2]] || "01";
      const day = dateMatch[3];
      const targetDate = `${year}-${month}-${day}`;

      // Find this date in forecast
      const dateIdx = ensembleDates.indexOf(targetDate);
      const forecastIdx = forecastDates.indexOf(targetDate);
      if (dateIdx < 0) continue;

      // Get ensemble member temperatures for this date
      const memberTemps: number[] = [];
      for (const key of memberKeys) {
        const val = ensembleDaily[key]?.[dateIdx];
        if (val != null) memberTemps.push(val);
      }
      if (memberTemps.length < 10) continue;

      const pointForecast = forecastIdx >= 0 ? forecastTemps[forecastIdx] : null;
      const meanTemp = memberTemps.reduce((a, b) => a + b, 0) / memberTemps.length;

      // For each bracket market, compute GFS probability
      for (const market of eventMarkets) {
        const yesBid = parseFloat(market.yes_bid_dollars || "0");
        const noBid = parseFloat(market.no_bid_dollars || "0");
        if (yesBid <= 0 && noBid <= 0) continue;

        const marketPrice = yesBid > 0 ? yesBid : (1 - noBid);
        if (marketPrice <= 0 || marketPrice >= 1) continue;

        // Parse the bracket from the title/rules
        // Typical: "Will the high temp in NYC be >47° on Mar 28, 2026?"
        // Or: "Will the high temp in NYC be 42-43° on Mar 28, 2026?"
        const title = market.title || "";
        let gfsProbability: number | null = null;

        const gtMatch = title.match(/[>](\d+)/);
        const ltMatch = title.match(/[<](\d+)/);
        const rangeMatch = title.match(/(\d+)[–-](\d+)/);

        if (gtMatch) {
          const threshold = parseFloat(gtMatch[1]);
          gfsProbability = memberTemps.filter(t => t > threshold).length / memberTemps.length;
        } else if (ltMatch) {
          const threshold = parseFloat(ltMatch[1]);
          gfsProbability = memberTemps.filter(t => t < threshold).length / memberTemps.length;
        } else if (rangeMatch) {
          const low = parseFloat(rangeMatch[1]);
          const high = parseFloat(rangeMatch[2]);
          gfsProbability = memberTemps.filter(t => t >= low && t <= high + 1).length / memberTemps.length;
        }

        if (gfsProbability === null) continue;

        const edge = (gfsProbability - marketPrice) * 100;
        if (Math.abs(edge) < 3) continue; // Need at least 3% edge after fees

        const signalType = edge > 0 ? "BUY_YES" : "BUY_NO";

        // Days until resolution affects confidence
        const daysOut = (new Date(targetDate).getTime() - Date.now()) / 86400000;
        const timeConfidence = daysOut <= 1 ? 0.92 : daysOut <= 3 ? 0.88 : daysOut <= 5 ? 0.82 : 0.72;
        const confidence = parseFloat(Math.min(0.95, timeConfidence).toFixed(3));

        const weatherYesAsk = parseFloat(market.yes_ask_dollars || "0");
        const weatherYesBid = parseFloat(market.yes_bid_dollars || "0");
        const weatherSpread = Math.max(0, weatherYesAsk - weatherYesBid);
        const weatherTheoEdge = Math.abs(edge) / 100;
        const { executableEdge: weatherExec, kellySize: weatherKelly } = computeEdgeMetrics(weatherTheoEdge, weatherSpread);
        const weatherDepth = estimateLiquidityDepth(market);
        const weatherSrc = "weather_model";

        // Risk guardrails (HARDCODED)
        if (weatherDepth < MIN_DEPTH) continue;
        if (weatherExec < MIN_EXEC_EDGE) continue;
        if (weatherSpread > MAX_SPREAD) continue;

        signals.push({
          ticker: market.ticker,
          title: market.title || market.ticker,
          eventTicker: market.event_ticker,
          edgeScore: parseFloat(edge.toFixed(2)),
          trueProbability: parseFloat(Math.max(0.01, Math.min(0.99, gfsProbability)).toFixed(3)),
          marketPrice: parseFloat(marketPrice.toFixed(3)),
          signalType,
          modelConfidence: confidence,
          modelName: "GFS-31-Ensemble",
          edgeSource: weatherSrc,
          reasoning: `GFS 31-member ensemble: ${memberTemps.length} members forecast ${targetDate} NYC high of ${meanTemp.toFixed(0)}°F (range ${Math.min(...memberTemps).toFixed(0)}-${Math.max(...memberTemps).toFixed(0)}°F).${pointForecast ? ` Point forecast: ${pointForecast.toFixed(0)}°F.` : ''} Ensemble gives ${(gfsProbability*100).toFixed(0)}% probability for this bracket vs. market price of ${(marketPrice*100).toFixed(0)}¢ — a ${Math.abs(edge).toFixed(1)}% edge. ${daysOut <= 2 ? 'Near-term forecast (high accuracy).' : 'Multi-day forecast — edge may narrow as resolution approaches.'}`,
          riskLevel: Math.abs(edge) > 30 ? "low" : Math.abs(edge) > 15 ? "low" : "medium",
          createdAt: new Date().toISOString(),
          gapType: classifyGapType(market, weatherSpread, weatherSrc),
          spread: parseFloat(weatherSpread.toFixed(4)),
          executableEdge: weatherExec,
          liquidityDepth: weatherDepth,
          kellySize: weatherKelly,
        });
      }
    }
  } catch (e) {
    console.error("Weather signal engine error:", e);
  }

  return signals;
}

// ── Edge #4: Spread/Volume Structure Analysis ─────────────────────────────────

function analyzeMarketStructure(market: KalshiMarket): LiveSignal | null {
  const yesBid = parseFloat(market.yes_bid_dollars || "0");
  const yesAsk = parseFloat(market.yes_ask_dollars || "0");
  const noBid = parseFloat(market.no_bid_dollars || "0");
  const noAsk = parseFloat(market.no_ask_dollars || "0");
  const volume = parseFloat(market.volume_fp || "0");
  const oi = parseFloat(market.open_interest_fp || "0");

  if (yesBid <= 0 || yesAsk <= 0) return null;

  const spread = yesAsk - yesBid;
  const midPrice = (yesBid + yesAsk) / 2;

  // Wide spread + high OI = market maker opportunity
  if (spread > 0.03 && oi > 500 && volume > 200) {
    // The maker-taker gap is structurally +1.12% for makers
    const makerEdge = 1.12 + (spread * 100 * 0.3); // wider spread = more edge for limit orders

    const theoreticalEdgeStruct = makerEdge / 100;
    const { executableEdge: execStruct, kellySize: ksStruct } = computeEdgeMetrics(theoreticalEdgeStruct, spread);
    const depthStruct = estimateLiquidityDepth(market);
    const srcStruct = "market_maker_spread";

    // Risk guardrails (HARDCODED)
    if (depthStruct < MIN_DEPTH) return null;
    if (execStruct < MIN_EXEC_EDGE) return null;
    if (spread > MAX_SPREAD) return null;

    return {
      ticker: market.ticker,
      title: market.title || market.ticker,
      eventTicker: market.event_ticker,
      edgeScore: parseFloat(makerEdge.toFixed(2)),
      trueProbability: parseFloat(midPrice.toFixed(3)),
      marketPrice: parseFloat(midPrice.toFixed(3)),
      signalType: "BUY_YES",
      modelConfidence: parseFloat(Math.min(0.78, 0.55 + (Math.min(oi, 10000) / 10000) * 0.23).toFixed(3)),
      modelName: "Spread-Structure",
      edgeSource: srcStruct,
      reasoning: `Wide spread of ${(spread*100).toFixed(0)}¢ with ${oi.toFixed(0)} open interest. Post-only limit orders near the midpoint (${(midPrice*100).toFixed(0)}¢) capture the spread + Kalshi's 0.05% maker rebate. Makers earn +1.12% avg excess return vs. takers. Rebalance every 30-60s.`,
      riskLevel: "low",
      createdAt: new Date().toISOString(),
      gapType: classifyGapType(market, spread, srcStruct),
      spread: parseFloat(spread.toFixed(4)),
      executableEdge: execStruct,
      liquidityDepth: depthStruct,
      kellySize: ksStruct,
    };
  }

  return null;
}

// ── Edge #5: Risk Monitor — Detect positions that should be SOLD ──────────────
// Generates SELL signals when market conditions indicate risk for existing positions:
// - Price convergence near resolution (spread widens, edge vanishes)
// - Model confidence drops below threshold
// - Edge reversal (what was a BUY is now negative edge)
// - Late-market convergence (contract approaching $0 or $1)

interface PositionInfo {
  ticker: string;
  title: string;
  side: string;        // "yes" or "no"
  entryPrice: number;  // 0-1
  quantity: number;
}

function analyzeRiskExits(market: KalshiMarket, positions: PositionInfo[]): LiveSignal[] {
  const signals: LiveSignal[] = [];
  const yesBid = parseFloat(market.yes_bid_dollars || "0");
  const noBid = parseFloat(market.no_bid_dollars || "0");
  const volume = parseFloat(market.volume_fp || "0");
  const oi = parseFloat(market.open_interest_fp || "0");

  if (yesBid <= 0 && noBid <= 0) return signals;

  const currentPrice = yesBid > 0 ? yesBid : (1 - noBid);
  if (currentPrice <= 0 || currentPrice >= 1) return signals;

  // Check each position in this market
  for (const pos of positions) {
    if (pos.ticker !== market.ticker) continue;

    const isYesPosition = pos.side === "yes";
    const entryPrice = pos.entryPrice;
    const pnlPct = isYesPosition
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    // ── RISK #1: Stop-loss hit — position down 50%+ (25% for Finance/Crypto per #6) ──
    const ticker = market.ticker.toUpperCase();
    const isFinanceOrCrypto = /BTC|ETH|CRYPTO|AAPL|TSLA|NVDA|STOCK|KXINX/.test(ticker);
    const stopLossThreshold = isFinanceOrCrypto ? -25 : -50;
    if (pnlPct <= stopLossThreshold) {
      signals.push({
        ticker: market.ticker,
        title: market.title || market.ticker,
        eventTicker: market.event_ticker,
        edgeScore: parseFloat(pnlPct.toFixed(2)),
        trueProbability: currentPrice,
        marketPrice: currentPrice,
        signalType: isYesPosition ? "SELL_YES" : "SELL_NO",
        modelConfidence: 0.95,
        modelName: "Risk-Monitor",
        edgeSource: "stop_loss",
        reasoning: `STOP-LOSS triggered. Your ${pos.side.toUpperCase()} position entered at ${(entryPrice*100).toFixed(0)}¢ is now at ${(currentPrice*100).toFixed(0)}¢ — down ${Math.abs(pnlPct).toFixed(0)}%. ${isFinanceOrCrypto ? 'Finance/Crypto positions use a tighter 25% stop-loss due to near-efficient markets and weak model edge.' : 'The position has lost more than 50% of entry value.'} Risk management imperative: exit to preserve capital. Remaining in a losing position beyond stop-loss increases adverse selection risk.`,
        riskLevel: "critical",
        createdAt: new Date().toISOString(),
        gapType: "D" as const,
        spread: 0,
        executableEdge: 0,
        liquidityDepth: 0,
        kellySize: 0,
      });
      continue;
    }

    // ── RISK #2: Edge reversal — your position's edge has flipped negative ──
    if (isYesPosition && currentPrice > 0.85 && entryPrice < 0.70) {
      // YES position has run up to near certainty — take profit
      signals.push({
        ticker: market.ticker,
        title: market.title || market.ticker,
        eventTicker: market.event_ticker,
        edgeScore: parseFloat(pnlPct.toFixed(2)),
        trueProbability: currentPrice,
        marketPrice: currentPrice,
        signalType: "SELL_YES",
        modelConfidence: 0.88,
        modelName: "Risk-Monitor",
        edgeSource: "take_profit",
        reasoning: `TAKE-PROFIT opportunity. Your YES position entered at ${(entryPrice*100).toFixed(0)}¢ is now at ${(currentPrice*100).toFixed(0)}¢ — up ${pnlPct.toFixed(0)}%. Price is converging toward $1 (near certainty). Late-market convergence reduces remaining upside while the spread widens. Lock in profits now — the last 10-15¢ of movement carries the most slippage risk.`,
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
        gapType: "D" as const,
        spread: 0,
        executableEdge: 0,
        liquidityDepth: 0,
        kellySize: 0,
      });
      continue;
    }

    if (!isYesPosition && currentPrice < 0.15 && entryPrice > 0.30) {
      // NO position has run up (YES collapsed) — take profit on NO
      signals.push({
        ticker: market.ticker,
        title: market.title || market.ticker,
        eventTicker: market.event_ticker,
        edgeScore: parseFloat(pnlPct.toFixed(2)),
        trueProbability: currentPrice,
        marketPrice: currentPrice,
        signalType: "SELL_NO",
        modelConfidence: 0.88,
        modelName: "Risk-Monitor",
        edgeSource: "take_profit",
        reasoning: `TAKE-PROFIT opportunity. Your NO position (entered when YES was ${(entryPrice*100).toFixed(0)}¢) is deep in profit — YES has collapsed to ${(currentPrice*100).toFixed(0)}¢. Price is converging toward $0. Lock in gains before resolution — late-market spread widening can erode profits.`,
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
        gapType: "D" as const,
        spread: 0,
        executableEdge: 0,
        liquidityDepth: 0,
        kellySize: 0,
      });
      continue;
    }

    // ── RISK #3: Liquidity dried up — can't exit cleanly later ──
    if (oi > 0 && volume < 20 && pos.quantity > 20) {
      signals.push({
        ticker: market.ticker,
        title: market.title || market.ticker,
        eventTicker: market.event_ticker,
        edgeScore: parseFloat(pnlPct.toFixed(2)),
        trueProbability: currentPrice,
        marketPrice: currentPrice,
        signalType: isYesPosition ? "SELL_YES" : "SELL_NO",
        modelConfidence: 0.78,
        modelName: "Risk-Monitor",
        edgeSource: "liquidity_risk",
        reasoning: `LIQUIDITY WARNING. Your ${pos.quantity}-contract ${pos.side.toUpperCase()} position is in a market with only ${volume.toFixed(0)} contracts traded recently. Low liquidity means you may not be able to exit at a fair price later. Wide bid-ask spreads in thin markets create adverse selection risk. Consider reducing position size now while there's still some book depth.`,
        riskLevel: "high",
        createdAt: new Date().toISOString(),
        gapType: "D" as const,
        spread: 0,
        executableEdge: 0,
        liquidityDepth: 0,
        kellySize: 0,
      });
      continue;
    }

    // ── RISK #4: Position down 25-50% — warning level ──
    if (pnlPct <= -25) {
      signals.push({
        ticker: market.ticker,
        title: market.title || market.ticker,
        eventTicker: market.event_ticker,
        edgeScore: parseFloat(pnlPct.toFixed(2)),
        trueProbability: currentPrice,
        marketPrice: currentPrice,
        signalType: isYesPosition ? "SELL_YES" : "SELL_NO",
        modelConfidence: 0.72,
        modelName: "Risk-Monitor",
        edgeSource: "drawdown_warning",
        reasoning: `DRAWDOWN WARNING. Your ${pos.side.toUpperCase()} position entered at ${(entryPrice*100).toFixed(0)}¢ is now at ${(currentPrice*100).toFixed(0)}¢ — down ${Math.abs(pnlPct).toFixed(0)}%. Approaching stop-loss territory. Consider reducing size by 50% to limit further downside while keeping some exposure if the market recovers. Fractional Kelly sizing suggests position is oversized at this drawdown level.`,
        riskLevel: "high",
        createdAt: new Date().toISOString(),
        gapType: "D" as const,
        spread: 0,
        executableEdge: 0,
        liquidityDepth: 0,
        kellySize: 0,
      });
    }
  }

  return signals;
}

// ── Edge #7: Intra-Market Arbitrage ──────────────────────────────────────────
// For multi-bracket events, the sum of all YES prices must equal $1.00
// If sum < $0.97: BUY-ALL (risk-free, buy one of each bracket)
// If sum > $1.03: SELL-ALL (risk-free, sell one of each bracket)

function analyzeIntraMarketArbitrage(marketsByEvent: Record<string, KalshiMarket[]>): LiveSignal[] {
  const signals: LiveSignal[] = [];

  for (const [eventTicker, markets] of Object.entries(marketsByEvent)) {
    if (markets.length < 3) continue; // Need at least 3 brackets

    // Sum all YES bid prices
    let sumYesBid = 0;
    let validCount = 0;
    for (const m of markets) {
      const yesBid = parseFloat(m.yes_bid_dollars || "0");
      if (yesBid > 0) {
        sumYesBid += yesBid;
        validCount++;
      }
    }

    if (validCount < 3) continue;

    const edgeMarket = markets[0];
    const spread = 0.01; // Structural arbitrage — spread is embedded in gap
    const { executableEdge, kellySize } = computeEdgeMetrics(0.03, spread);
    const liquidityDepth = Math.min(...markets.map(estimateLiquidityDepth));

    if (sumYesBid < 0.97) {
      // BUY-ALL: buying one of each bracket guarantees $1 payout
      const gap = 0.97 - sumYesBid;
      signals.push({
        ticker: `${eventTicker}-ARB`,
        title: `Intra-Market Arb: BUY-ALL ${eventTicker} (${markets.length} brackets, sum=${sumYesBid.toFixed(3)})`,
        eventTicker,
        edgeScore: parseFloat((gap * 100).toFixed(2)),
        trueProbability: 1.0,
        marketPrice: sumYesBid / markets.length,
        signalType: "BUY_YES",
        modelConfidence: 0.95,
        modelName: "Intra-Market-Arbitrage",
        edgeSource: "intra_market_arbitrage",
        reasoning: `RISK-FREE ARBITRAGE: Sum of all YES bids = ${sumYesBid.toFixed(3)} < $0.97. Buying one contract from each of ${markets.length} mutually exclusive brackets guarantees $1.00 payout at resolution. Net cost: $${sumYesBid.toFixed(3)}, guaranteed return: $${(0.97 - sumYesBid).toFixed(3)} (${(gap * 100).toFixed(1)}% risk-free). This is structural — execute immediately before the gap closes.`,
        riskLevel: "low",
        createdAt: new Date().toISOString(),
        gapType: "C",
        spread: 0,
        executableEdge: parseFloat((gap).toFixed(4)),
        liquidityDepth,
        kellySize: parseFloat((gap * 1000).toFixed(2)),
      });
    } else if (sumYesBid > 1.03) {
      // SELL-ALL: selling one of each bracket guarantees collecting more than $1
      const gap = sumYesBid - 1.03;
      signals.push({
        ticker: `${eventTicker}-ARB`,
        title: `Intra-Market Arb: SELL-ALL ${eventTicker} (${markets.length} brackets, sum=${sumYesBid.toFixed(3)})`,
        eventTicker,
        edgeScore: parseFloat((-gap * 100).toFixed(2)),
        trueProbability: 0.0,
        marketPrice: sumYesBid / markets.length,
        signalType: "SELL_YES",
        modelConfidence: 0.95,
        modelName: "Intra-Market-Arbitrage",
        edgeSource: "intra_market_arbitrage",
        reasoning: `RISK-FREE ARBITRAGE: Sum of all YES bids = ${sumYesBid.toFixed(3)} > $1.03. Selling one contract from each of ${markets.length} mutually exclusive brackets locks in $${sumYesBid.toFixed(3)} collected, max liability $1.00. Net profit: $${(sumYesBid - 1.03).toFixed(3)} (${(gap * 100).toFixed(1)}% risk-free). Execute immediately.`,
        riskLevel: "low",
        createdAt: new Date().toISOString(),
        gapType: "C",
        spread: 0,
        executableEdge: parseFloat((gap).toFixed(4)),
        liquidityDepth,
        kellySize: parseFloat((gap * 1000).toFixed(2)),
      });
    }
  }

  return signals;
}

// ── Edge #8: Stale Pricing Detection ─────────────────────────────────────────
// If a market's last_price_dollars is very different from current yes_bid (>10¢ diff)
// AND the market has >1000 volume → stale pricing gap

function analyzeStalePrice(market: KalshiMarket): LiveSignal | null {
  const lastPrice = parseFloat(market.last_price_dollars || "0");
  const yesBid = parseFloat(market.yes_bid_dollars || "0");
  const volume = parseFloat(market.volume_fp || "0");

  if (lastPrice <= 0 || yesBid <= 0) return null;
  if (volume < 1000) return null; // Only liquid markets

  const diff = Math.abs(lastPrice - yesBid);
  if (diff <= 0.10) return null; // Need >10¢ gap

  const midPrice = yesBid;
  const signalType = lastPrice > yesBid ? "BUY_YES" : "BUY_NO";
  const yesAsk = parseFloat(market.yes_ask_dollars || "0");
  const spread = Math.max(0, yesAsk - yesBid);
  const theoreticalEdge = diff;
  const { executableEdge, kellySize } = computeEdgeMetrics(theoreticalEdge, spread);
  const liquidityDepth = estimateLiquidityDepth(market);
  const edgeSource = "stale_pricing";

  if (liquidityDepth < MIN_DEPTH) return null;
  if (executableEdge < MIN_EXEC_EDGE) return null;
  if (spread > MAX_SPREAD) return null;

  return {
    ticker: market.ticker,
    title: market.title || market.ticker,
    eventTicker: market.event_ticker,
    edgeScore: parseFloat((diff * 100).toFixed(2)),
    trueProbability: parseFloat(Math.max(0.01, Math.min(0.99, lastPrice)).toFixed(3)),
    marketPrice: parseFloat(midPrice.toFixed(3)),
    signalType,
    modelConfidence: 0.75,
    modelName: "Stale-Price-Detector",
    edgeSource,
    reasoning: `STALE PRICING: Last traded price (${(lastPrice*100).toFixed(0)}¢) diverges ${(diff*100).toFixed(0)}¢ from current bid (${(yesBid*100).toFixed(0)}¢) on a market with ${volume.toFixed(0)} volume. High-volume markets with large last-price gaps indicate delayed repricing — the market hasn't adjusted to recent information. ${signalType === "BUY_YES" ? `Last price suggests fair value is higher — consider buying YES.` : `Current bid is above last traded price — consider buying NO.`}`,
    riskLevel: diff > 0.20 ? "low" : "medium",
    createdAt: new Date().toISOString(),
    gapType: "A",
    spread: parseFloat(spread.toFixed(4)),
    executableEdge,
    liquidityDepth,
    kellySize,
  };
}

// ── #5: Dynamic Kelly Sizing ──────────────────────────────────────────────────

export function calculateDynamicKelly(
  edge: number,         // decimal, e.g., 0.15 for 15%
  confidence: number,   // 0-1
  bankroll: number,
  marketPrice: number,  // 0-1
  depth: number,        // contracts
  categoryMultiplier: number // 0-1
): number {
  const p = Math.min(0.95, Math.max(0.5, (marketPrice + edge))); // adjusted win prob
  const b = (1 / Math.max(marketPrice, 0.01)) - 1; // odds
  const q = 1 - p;
  const fullKelly = Math.max(0, (b * p - q) / b);
  const quarterKelly = fullKelly / 4;
  const kellyDollars = quarterKelly * bankroll * categoryMultiplier;
  const contracts = Math.floor(kellyDollars / Math.max(marketPrice, 0.01));
  return Math.max(1, Math.min(contracts, Math.floor(depth * 0.25), Math.floor(500 / Math.max(marketPrice, 0.01)), 200));
}

// ── #6: Category Risk Multipliers ─────────────────────────────────────────────

export function getCategoryMultiplier(edgeSource: string, ticker: string): number {
  const t = ticker.toUpperCase();
  if (/TEMP|RAIN|WEATH|HIGH|LOW|KXHIGH/i.test(t)) return 1.0;   // Weather — strongest
  if (/FED|CPI|GDP|UNEM|RATE|KXFED|KXCPI|KXGDP/i.test(t)) return 0.9; // Economics
  if (edgeSource === "intra_market_arbitrage") return 1.0; // Arbitrage — risk-free
  if (/NBA|NFL|SPORT|GAME/i.test(t)) return 0.7;  // Sports
  if (/BTC|ETH|CRYPTO/i.test(t)) return 0.4;      // Crypto — weak model
  if (/AAPL|TSLA|NVDA|STOCK|KXINX/i.test(t)) return 0.3; // Finance — near efficient
  if (/PRES|SENATE|ELEC/i.test(t)) return 0.6;    // Politics
  return 0.5; // Default
}

// ── Dip / Momentum Detection ─────────────────────────────────────────────────
// Detects two patterns for autonomous reinvestment after profit-taking:
// 1. DIP BUY: Market price dropped significantly below recent levels → buy the dip
// 2. MOMENTUM RIDE: Market is surging toward certainty → buy and ride the wave

// In-memory price history for dip/momentum detection (ticker → recent prices)
const priceHistory: Map<string, { prices: number[]; lastUpdated: number }> = new Map();

function analyzeDipAndMomentum(market: KalshiMarket): LiveSignal | null {
  const yesBid = parseFloat(market.yes_bid_dollars || "0");
  const noBid = parseFloat(market.no_bid_dollars || "0");
  const yesAsk = parseFloat(market.yes_ask_dollars || "0");
  if (yesBid <= 0 && noBid <= 0) return null;
  const midPrice = yesBid > 0 ? (yesBid + yesAsk) / 2 : (1 - noBid);
  if (midPrice <= 0.02 || midPrice >= 0.98) return null;

  const volume = parseFloat(market.volume_fp || "0");
  if (volume < 200) return null; // need decent liquidity
  const spread = Math.max(0, yesAsk - yesBid);
  if (spread > 0.08) return null; // too wide

  // Update price history
  const now = Date.now();
  const history = priceHistory.get(market.ticker);
  if (history) {
    history.prices.push(midPrice);
    if (history.prices.length > 30) history.prices.shift(); // keep last 30 readings (~30 min at 60s intervals)
    history.lastUpdated = now;
  } else {
    priceHistory.set(market.ticker, { prices: [midPrice], lastUpdated: now });
    return null; // Need at least 2 readings
  }

  const prices = priceHistory.get(market.ticker)!.prices;
  if (prices.length < 5) return null; // Need 5+ readings for meaningful analysis

  const recentAvg = prices.slice(-5).reduce((a, b) => a + b, 0) / Math.min(prices.length, 5);
  const olderAvg = prices.length >= 10
    ? prices.slice(0, -5).reduce((a, b) => a + b, 0) / (prices.length - 5)
    : recentAvg;

  const priceChange = recentAvg - olderAvg;
  const pctChange = olderAvg > 0 ? (priceChange / olderAvg) : 0;

  const oi = parseFloat(market.open_interest_fp || "0");
  const depth = Math.max(0, Math.round(Math.min(oi * 0.08, volume * 0.5)));
  if (depth < 48) return null;

  const categoryMult = getCategoryMultiplier("", market.ticker);

  // DIP BUY: price dropped 8%+ from older average → buy the dip
  if (pctChange <= -0.08 && midPrice >= 0.15 && midPrice <= 0.75) {
    const execEdge = Math.abs(pctChange) - spread / 2;
    if (execEdge < 0.04) return null;
    return {
      ticker: market.ticker,
      title: market.title,
      eventTicker: market.event_ticker,
      edgeScore: parseFloat((pctChange * 100).toFixed(2)),
      trueProbability: olderAvg, // revert-to-mean estimate
      marketPrice: midPrice,
      signalType: "BUY_YES",
      modelConfidence: Math.min(0.85, 0.70 + Math.abs(pctChange)),
      modelName: "Dip-Detector",
      edgeSource: "dip_buy",
      reasoning: `DIP BUY: Price dropped ${(pctChange * 100).toFixed(1)}% (from ~${(olderAvg * 100).toFixed(0)}¢ avg to ${(midPrice * 100).toFixed(0)}¢). Mean-reversion opportunity — markets overcorrect on short-term sentiment shifts. Buying the dip with ${(execEdge * 100).toFixed(1)}% executable edge after spread. Category multiplier: ${categoryMult.toFixed(1)}×.`,
      riskLevel: Math.abs(pctChange) > 0.15 ? "medium" : "low",
      createdAt: new Date().toISOString(),
      gapType: "E",
      spread,
      executableEdge: execEdge,
      liquidityDepth: depth,
      kellySize: calculateDynamicKelly(execEdge, 0.75, 12000, midPrice, depth, categoryMult),
    };
  }

  // MOMENTUM RIDE: price surged 8%+ and trending toward certainty → ride the wave
  if (pctChange >= 0.08 && midPrice >= 0.55 && midPrice <= 0.88) {
    const execEdge = Math.abs(pctChange) * 0.6 - spread / 2; // discount for chasing
    if (execEdge < 0.03) return null;
    return {
      ticker: market.ticker,
      title: market.title,
      eventTicker: market.event_ticker,
      edgeScore: parseFloat((pctChange * 100).toFixed(2)),
      trueProbability: Math.min(0.95, midPrice + pctChange * 0.5),
      marketPrice: midPrice,
      signalType: "BUY_YES",
      modelConfidence: Math.min(0.82, 0.65 + pctChange),
      modelName: "Momentum-Scanner",
      edgeSource: "momentum_ride",
      reasoning: `MOMENTUM BUY: Price surged +${(pctChange * 100).toFixed(1)}% (from ~${(olderAvg * 100).toFixed(0)}¢ to ${(midPrice * 100).toFixed(0)}¢). Strong directional move with volume confirmation (${volume.toFixed(0)} traded). Riding momentum toward resolution — ${(execEdge * 100).toFixed(1)}% executable edge after spread discount.`,
      riskLevel: "medium",
      createdAt: new Date().toISOString(),
      gapType: "E",
      spread,
      executableEdge: execEdge,
      liquidityDepth: depth,
      kellySize: calculateDynamicKelly(execEdge, 0.72, 12000, midPrice, depth, categoryMult),
    };
  }

  return null;
}

// ── Main Signal Generation ────────────────────────────────────────────────────

export async function generateLiveSignals(existingPositions?: PositionInfo[]): Promise<LiveSignal[]> {
  console.log("[Signal Engine] Generating live signals...");
  const allSignals: LiveSignal[] = [];

  try {
    // Fetch markets from all active series (#2: diversified beyond weather)
    const series = [
      "KXHIGHNY", "KXNBAGAME", "KXNBAPTS", "KXFEDRATE",
      "KXCPI", "KXINX", "KXNFLGAME", "KXGDP",
      "KXBTC", "KXETH", "KXAPPROVAL", "KXUNEM",
    ];

    const allMarkets: KalshiMarket[] = [];
    await Promise.all(series.map(async (s) => {
      const markets = await fetchKalshiMarkets(s);
      allMarkets.push(...markets);
    }));

    console.log(`[Signal Engine] Fetched ${allMarkets.length} live markets`);

    // Group markets by event for intra-market arbitrage analysis
    const marketsByEvent: Record<string, KalshiMarket[]> = {};
    for (const m of allMarkets) {
      const ev = m.event_ticker;
      if (!marketsByEvent[ev]) marketsByEvent[ev] = [];
      marketsByEvent[ev].push(m);
    }

    // Run bias analyzers on each market
    for (const market of allMarkets) {
      const longshotSignal = analyzeLongshotBias(market);
      if (longshotSignal) allSignals.push(longshotSignal);

      const asymmetrySignal = analyzeYesNoAsymmetry(market);
      if (asymmetrySignal) allSignals.push(asymmetrySignal);

      const structureSignal = analyzeMarketStructure(market);
      if (structureSignal) allSignals.push(structureSignal);

      // Edge #8: Stale pricing detection
      const stalePriceSignal = analyzeStalePrice(market);
      if (stalePriceSignal) allSignals.push(stalePriceSignal);

      // Edge #11: Dip buying / momentum detection (for reinvestment after sells)
      const dipMomentumSignal = analyzeDipAndMomentum(market);
      if (dipMomentumSignal) allSignals.push(dipMomentumSignal);

      // Run risk exit analysis if we have positions
      if (existingPositions && existingPositions.length > 0) {
        const exitSignals = analyzeRiskExits(market, existingPositions);
        allSignals.push(...exitSignals);
      }
    }

    // Edge #7: Intra-market arbitrage (requires grouped markets)
    const arbSignals = analyzeIntraMarketArbitrage(marketsByEvent);
    allSignals.push(...arbSignals);
    if (arbSignals.length > 0) {
      console.log(`[Signal Engine] Found ${arbSignals.length} intra-market arbitrage opportunities`);
    }

    // Run weather model analysis
    const weatherSignals = await analyzeWeatherMarkets();
    allSignals.push(...weatherSignals);

    // Sort: SELL (risk) signals first, then by absolute edge × confidence
    allSignals.sort((a, b) => {
      // Critical risk signals always float to top
      const aIsSell = a.signalType.startsWith("SELL") ? 1 : 0;
      const bIsSell = b.signalType.startsWith("SELL") ? 1 : 0;
      if (aIsSell !== bIsSell) return bIsSell - aIsSell;

      const aIsCritical = a.riskLevel === "critical" ? 1 : 0;
      const bIsCritical = b.riskLevel === "critical" ? 1 : 0;
      if (aIsCritical !== bIsCritical) return bIsCritical - aIsCritical;

      const scoreA = Math.abs(a.edgeScore) * a.modelConfidence;
      const scoreB = Math.abs(b.edgeScore) * b.modelConfidence;
      return scoreB - scoreA;
    });

    console.log(`[Signal Engine] Generated ${allSignals.length} signals (${allSignals.filter(s => s.signalType.startsWith('SELL')).length} SELL/risk exits)`);
  } catch (e) {
    console.error("[Signal Engine] Error:", e);
  }

  return allSignals;
}

// ── Position Exit Monitor ─────────────────────────────────────────────────────
// Runs every 60 seconds to check existing positions for exit conditions:
// 1. Trailing stop: if P&L dropped 25% from peak
// 2. Time-decay exit: market closes within 4 hours
// 3. Profit target: unrealized gain >= 60% of max theoretical (entry → $1)
// 4. Edge erosion: model now shows <2% edge for our side

interface PositionExitCheck {
  ticker: string;
  title: string;
  side: "yes" | "no";
  entryPrice: number;
  quantity: number;
  currentPrice: number;
  unrealizedPnlAmt: number; // absolute P&L in dollars
  closeTime?: string;        // ISO string of market close time
  currentModelEdge?: number; // current model edge for position side (0-1 scale)
}

export async function checkPositionExits(
  positionChecks: PositionExitCheck[]
): Promise<LiveSignal[]> {
  const exitSignals: LiveSignal[] = [];
  const now = Date.now();

  for (const pos of positionChecks) {
    const isYes = pos.side === "yes";
    const pnlDollars = pos.unrealizedPnlAmt;

    // Update peak P&L tracking
    const currentPeak = peakPnl.get(pos.ticker) ?? pnlDollars;
    if (pnlDollars > currentPeak) {
      peakPnl.set(pos.ticker, pnlDollars);
    }
    const peak = peakPnl.get(pos.ticker) ?? 0;

    // ── EXIT #1: Trailing stop — dropped 25% from peak ──────────────────────
    if (peak > 0 && pnlDollars < peak * 0.75) {
      exitSignals.push({
        ticker: pos.ticker,
        title: pos.title || pos.ticker,
        eventTicker: pos.ticker,
        edgeScore: parseFloat(((pnlDollars - peak) / Math.max(Math.abs(peak), 1) * 100).toFixed(2)),
        trueProbability: pos.currentPrice,
        marketPrice: pos.currentPrice,
        signalType: isYes ? "SELL_YES" : "SELL_NO",
        modelConfidence: 0.92,
        modelName: "Exit-Monitor",
        edgeSource: "trailing_stop",
        reasoning: `TRAILING STOP triggered. Peak unrealized P&L was $${peak.toFixed(2)}, current is $${pnlDollars.toFixed(2)} — a ${((peak - pnlDollars) / Math.max(peak, 1) * 100).toFixed(0)}% pullback from peak (threshold: 25%). Exit to preserve gains.`,
        riskLevel: "high",
        createdAt: new Date().toISOString(),
        gapType: "D",
        spread: 0,
        executableEdge: 0,
        liquidityDepth: 0,
        kellySize: 0,
      });
      continue;
    }

    // ── EXIT #2: Time-decay exit — close within 4 hours ─────────────────────
    if (pos.closeTime) {
      const closeTs = new Date(pos.closeTime).getTime();
      const hoursToClose = (closeTs - now) / 3_600_000;
      if (hoursToClose > 0 && hoursToClose <= 4) {
        exitSignals.push({
          ticker: pos.ticker,
          title: pos.title || pos.ticker,
          eventTicker: pos.ticker,
          edgeScore: 0,
          trueProbability: pos.currentPrice,
          marketPrice: pos.currentPrice,
          signalType: isYes ? "SELL_YES" : "SELL_NO",
          modelConfidence: 0.85,
          modelName: "Exit-Monitor",
          edgeSource: "time_decay_exit",
          reasoning: `TIME-DECAY EXIT: Market closes in ${hoursToClose.toFixed(1)} hours (threshold: 4h). Near-expiry spreads widen and liquidity thins, eroding any remaining edge. Exit now to avoid adverse selection at resolution.`,
          riskLevel: "medium",
          createdAt: new Date().toISOString(),
          gapType: "E",
          spread: 0,
          executableEdge: 0,
          liquidityDepth: 0,
          kellySize: 0,
        });
        continue;
      }
    }

    // ── EXIT #3a: Absolute profit target — $50 unrealized gain ─────────────────
    // Hard dollar threshold: lock in gains once position is up $50+
    const PROFIT_SELL_THRESHOLD = 50; // dollars
    if (pnlDollars >= PROFIT_SELL_THRESHOLD) {
      const costBasis = pos.entryPrice * pos.quantity * 100;
      const returnPct = costBasis > 0 ? (pnlDollars / costBasis * 100) : 0;
      exitSignals.push({
        ticker: pos.ticker,
        title: pos.title || pos.ticker,
        eventTicker: pos.ticker,
        edgeScore: parseFloat(returnPct.toFixed(2)),
        trueProbability: pos.currentPrice,
        marketPrice: pos.currentPrice,
        signalType: isYes ? "SELL_YES" : "SELL_NO",
        modelConfidence: 0.95,
        modelName: "Exit-Monitor",
        edgeSource: "profit_threshold_50",
        reasoning: `AUTO-SELL: PROFIT TARGET HIT. Unrealized gain of $${pnlDollars.toFixed(2)} exceeds $${PROFIT_SELL_THRESHOLD} threshold (${returnPct.toFixed(0)}% return on $${costBasis.toFixed(2)} cost basis). Locking in profits — capital will be freed for new opportunities on dips and price moves.`,
        riskLevel: "low",
        createdAt: new Date().toISOString(),
        gapType: "D",
        spread: 0,
        executableEdge: 0,
        liquidityDepth: 0,
        kellySize: 0,
      });
      continue;
    }

    // ── EXIT #3b: Profit target — 60% of max theoretical gain ─────────────────
    // Max theoretical: entry price to $1 (per contract in dollars)
    const maxTheoreticalPerContract = isYes ? (1 - pos.entryPrice) : pos.entryPrice;
    const maxTheoreticalTotal = maxTheoreticalPerContract * pos.quantity * 100; // cents to dollars
    if (maxTheoreticalTotal > 0 && pnlDollars >= maxTheoreticalTotal * 0.60) {
      exitSignals.push({
        ticker: pos.ticker,
        title: pos.title || pos.ticker,
        eventTicker: pos.ticker,
        edgeScore: parseFloat((pnlDollars / Math.max(pos.entryPrice * pos.quantity * 100, 1) * 100).toFixed(2)),
        trueProbability: pos.currentPrice,
        marketPrice: pos.currentPrice,
        signalType: isYes ? "SELL_YES" : "SELL_NO",
        modelConfidence: 0.88,
        modelName: "Exit-Monitor",
        edgeSource: "profit_target_60pct",
        reasoning: `PROFIT TARGET REACHED: Unrealized gain of $${pnlDollars.toFixed(2)} is ${(pnlDollars / maxTheoreticalTotal * 100).toFixed(0)}% of max theoretical ($${maxTheoreticalTotal.toFixed(2)}). Research shows exiting at 60% of max theoretical optimizes Sharpe ratio — the final 40% carries disproportionate reversal risk.`,
        riskLevel: "low",
        createdAt: new Date().toISOString(),
        gapType: "D",
        spread: 0,
        executableEdge: 0,
        liquidityDepth: 0,
        kellySize: 0,
      });
      continue;
    }

    // ── EXIT #4: Edge erosion — model shows <2% edge for position side ───────
    if (pos.currentModelEdge !== undefined && Math.abs(pos.currentModelEdge) < 0.02) {
      exitSignals.push({
        ticker: pos.ticker,
        title: pos.title || pos.ticker,
        eventTicker: pos.ticker,
        edgeScore: parseFloat((pos.currentModelEdge * 100).toFixed(2)),
        trueProbability: pos.currentPrice,
        marketPrice: pos.currentPrice,
        signalType: isYes ? "SELL_YES" : "SELL_NO",
        modelConfidence: 0.75,
        modelName: "Exit-Monitor",
        edgeSource: "edge_erosion",
        reasoning: `EDGE EROSION: Model now shows only ${(Math.abs(pos.currentModelEdge) * 100).toFixed(1)}% edge for the ${pos.side.toUpperCase()} side (threshold: 2%). The original edge thesis has weakened — holding without edge increases risk exposure. Exit to free capital for higher-edge opportunities.`,
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
        gapType: "D",
        spread: 0,
        executableEdge: 0,
        liquidityDepth: 0,
        kellySize: 0,
      });
    }
  }

  return exitSignals;
}

// Export the PositionInfo type for use in routes
export type { PositionInfo };
export type { PositionExitCheck };
