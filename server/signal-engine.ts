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
  signalType: "BUY_YES" | "BUY_NO" | "NO_TRADE";
  modelConfidence: number;
  modelName: string;
  edgeSource: string;
  reasoning: string;
  createdAt: string;
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
    edgeSource: "favorite_longshot_bias",
    reasoning,
    createdAt: new Date().toISOString(),
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
    edgeSource: "yes_no_asymmetry",
    reasoning: `At ${(midPrice*100).toFixed(0)}¢, taker flow is dominated by optimistic YES buyers (UI default bias). NO outperforms YES at 69 of 99 price levels. Dollar-weighted, YES returns -1.02% while NO returns +0.83%. Post-only NO limit orders also capture the 0.05% maker rebate.`,
    createdAt: new Date().toISOString(),
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
          edgeSource: "weather_model",
          reasoning: `GFS 31-member ensemble: ${memberTemps.length} members forecast ${targetDate} NYC high of ${meanTemp.toFixed(0)}°F (range ${Math.min(...memberTemps).toFixed(0)}-${Math.max(...memberTemps).toFixed(0)}°F).${pointForecast ? ` Point forecast: ${pointForecast.toFixed(0)}°F.` : ''} Ensemble gives ${(gfsProbability*100).toFixed(0)}% probability for this bracket vs. market price of ${(marketPrice*100).toFixed(0)}¢ — a ${Math.abs(edge).toFixed(1)}% edge. ${daysOut <= 2 ? 'Near-term forecast (high accuracy).' : 'Multi-day forecast — edge may narrow as resolution approaches.'}`,
          createdAt: new Date().toISOString(),
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

    return {
      ticker: market.ticker,
      title: market.title || market.ticker,
      eventTicker: market.event_ticker,
      edgeScore: parseFloat(makerEdge.toFixed(2)),
      trueProbability: parseFloat(midPrice.toFixed(3)),
      marketPrice: parseFloat(midPrice.toFixed(3)),
      signalType: "BUY_YES", // Market making — post limit orders on both sides
      modelConfidence: parseFloat(Math.min(0.78, 0.55 + (Math.min(oi, 10000) / 10000) * 0.23).toFixed(3)),
      modelName: "Spread-Structure",
      edgeSource: "market_maker_spread",
      reasoning: `Wide spread of ${(spread*100).toFixed(0)}¢ with ${oi.toFixed(0)} open interest. Post-only limit orders near the midpoint (${(midPrice*100).toFixed(0)}¢) capture the spread + Kalshi's 0.05% maker rebate. Makers earn +1.12% avg excess return vs. takers. Rebalance every 30-60s.`,
      createdAt: new Date().toISOString(),
    };
  }

  return null;
}

// ── Main Signal Generation ────────────────────────────────────────────────────

export async function generateLiveSignals(): Promise<LiveSignal[]> {
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
    }

    // Run weather model analysis
    const weatherSignals = await analyzeWeatherMarkets();
    allSignals.push(...weatherSignals);

    // Sort by absolute edge × confidence (best opportunities first)
    allSignals.sort((a, b) => {
      const scoreA = Math.abs(a.edgeScore) * a.modelConfidence;
      const scoreB = Math.abs(b.edgeScore) * b.modelConfidence;
      return scoreB - scoreA;
    });

    console.log(`[Signal Engine] Generated ${allSignals.length} live signals`);
  } catch (e) {
    console.error("[Signal Engine] Error:", e);
  }

  return allSignals;
}
