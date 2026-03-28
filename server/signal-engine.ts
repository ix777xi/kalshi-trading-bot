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
const MAX_PER_MARKET = 500; // $500 hard cap per market (HARDCODED)

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
 */
function computeEdgeMetrics(
  theoreticalEdge: number,
  spread: number
): { executableEdge: number; kellySize: number } {
  const executableEdge = theoreticalEdge - spread / 2;
  const fullKelly = executableEdge > 0 ? executableEdge / Math.max(1 - executableEdge, 0.01) : 0;
  const halfKelly = fullKelly / 2;
  const kellySize = Math.min(halfKelly * BANKROLL, MAX_PER_MARKET);
  return { executableEdge: parseFloat(executableEdge.toFixed(4)), kellySize: parseFloat(kellySize.toFixed(2)) };
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
  if (spread > 0.05 && oi > 500 && volume > 200) {
    // The maker-taker gap is structurally +1.12% for makers
    const makerEdge = 1.12 + (spread * 100 * 0.3); // wider spread = more edge for limit orders

    const theoreticalEdgeStruct = makerEdge / 100;
    const { executableEdge: execStruct, kellySize: ksStruct } = computeEdgeMetrics(theoreticalEdgeStruct, spread);
    const depthStruct = estimateLiquidityDepth(market);
    const srcStruct = "market_maker_spread";

    // Risk guardrails (HARDCODED)
    if (depthStruct < MIN_DEPTH) return null;
    if (execStruct < MIN_EXEC_EDGE) return null;

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

    // ── RISK #1: Stop-loss hit — position down 50%+ ──
    if (pnlPct <= -50) {
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
        reasoning: `STOP-LOSS triggered. Your ${pos.side.toUpperCase()} position entered at ${(entryPrice*100).toFixed(0)}¢ is now at ${(currentPrice*100).toFixed(0)}¢ — down ${Math.abs(pnlPct).toFixed(0)}%. The position has lost more than 50% of entry value. Risk management imperative: exit to preserve capital. Remaining in a losing position beyond stop-loss increases adverse selection risk.`,
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

// ── Main Signal Generation ────────────────────────────────────────────────────

export async function generateLiveSignals(existingPositions?: PositionInfo[]): Promise<LiveSignal[]> {
  console.log("[Signal Engine] Generating live signals...");
  const allSignals: LiveSignal[] = [];

  try {
    // Fetch markets from all active series
    const series = ["KXHIGHNY", "KXNBAGAME", "KXNBAPTS", "KXFEDRATE", "KXCPI", "KXINX", "KXNFLGAME", "KXGDP"];

    const allMarkets: KalshiMarket[] = [];
    await Promise.all(series.map(async (s) => {
      const markets = await fetchKalshiMarkets(s);
      allMarkets.push(...markets);
    }));

    console.log(`[Signal Engine] Fetched ${allMarkets.length} live markets`);

    // Run bias analyzers on each market
    for (const market of allMarkets) {
      const longshotSignal = analyzeLongshotBias(market);
      if (longshotSignal) allSignals.push(longshotSignal);

      const asymmetrySignal = analyzeYesNoAsymmetry(market);
      if (asymmetrySignal) allSignals.push(asymmetrySignal);

      const structureSignal = analyzeMarketStructure(market);
      if (structureSignal) allSignals.push(structureSignal);

      // Run risk exit analysis if we have positions
      if (existingPositions && existingPositions.length > 0) {
        const exitSignals = analyzeRiskExits(market, existingPositions);
        allSignals.push(...exitSignals);
      }
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

// Export the PositionInfo type for use in routes
export type { PositionInfo };
