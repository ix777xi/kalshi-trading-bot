# KalshiBot 9-Point Optimization

Based on comprehensive platform assessment. Current state: 18.47% return, 63.2% win rate, 1.84 Sharpe, $332 balance.

## 1. Activate Dormant Alpha Edges (#3, #5, #7, #8)

### Edge #3: Market Maker Role
Currently: Configured but inactive in alpha page.
Fix: The spread-structure analyzer in signal-engine.ts already detects wide spreads. Make sure its signals pass through to pending trades. Lower the spread threshold from >5¢ to >3¢ to capture more maker opportunities.

### Edge #5: Weather Model vs Crowd
Currently: Configured but showing inactive on the alpha page despite weather signals working.
Fix: This is a display bug — weather signals ARE generating. Update the alpha page to reflect this as "Active".

### Edge #7: Intra-Market Arbitrage
NEW: Add a new analyzer to signal-engine.ts:
- For multi-bracket events (e.g., KXHIGHNY temperature brackets), sum all YES prices
- If sum < $0.97 → BUY-ALL arbitrage (buy one of each bracket)
- If sum > $1.03 → SELL-ALL arbitrage
- This is risk-free profit when it occurs
- edgeSource: "intra_market_arbitrage"
- gapType: "C" (arbitrage)

### Edge #8: Speed & Late-Market Repricing
NEW: Add stale pricing detection to signal-engine.ts:
- Compare last_price_dollars to current model probability
- If the market price hasn't moved in >2 hours (check via last_price vs current bid) AND our model shows >10% divergence → flag as stale pricing opportunity
- edgeSource: "stale_pricing"
- gapType: "A"

## 2. Diversify Beyond Weather

### Expand Market Series
Currently scanning: KXHIGHNY, KXNBAGAME, KXNBAPTS, KXFEDRATE, KXCPI, KXINX, KXNFLGAME, KXGDP

Add these series for World Events, Entertainment, Crypto:
- KXBTC (Bitcoin price markets)
- KXETH (Ethereum markets)
- KXAPPROVAL (presidential approval)
- KXUNEM (unemployment)

### Increase min_volume filter for weather
To reduce weather concentration: require min 5000 volume for weather signals (up from current threshold).

## 3. Fix Backtest Overfitting

Update the backtest results display to show:
- Add a "Model Health" card showing the in-sample vs out-of-sample degradation
- Show the 7.7pp win rate drop and 34% Sharpe decline as warnings
- Add recommendation text: "Consider model recalibration"

In the Settings/Bot Config section, add:
- Model selection: ability to note which LLM model is being used
- A "Recalibrate" button that logs a recalibration request

## 4. Address Risk Flags

In the Risk page, update the risk imperatives to show:
- Regulatory Risk: GREEN if user is in a non-restricted state, AMBER with note about 7 states
- Add a note in settings: "Check kalshi.com/legal for state-level restrictions"
- Cross-Platform Risk: ensure all limit orders use post_only=true (already the case)

## 5. Dynamic Kelly Sizing (MOST IMPORTANT)

Replace the flat 50-contract sizing in the background scanner AND the today's picks endpoint.

Current code:
```
const contracts = Math.min(maxContracts, Math.max(1, Math.floor(maxCost / sig.marketPrice)));
```

Replace with dynamic Kelly:
```typescript
function calculateDynamicKelly(edge: number, confidence: number, bankroll: number, marketPrice: number, depth: number): number {
  const p = Math.min(0.95, confidence); // estimated win probability
  const b = (1 / marketPrice) - 1; // odds ratio
  const q = 1 - p;
  
  // Full Kelly fraction
  const fullKelly = Math.max(0, (b * p - q) / b);
  
  // Quarter Kelly for safety
  const quarterKelly = fullKelly / 4;
  
  // Dollar amount
  const kellyDollars = quarterKelly * bankroll;
  
  // Convert to contracts
  const contracts = Math.floor(kellyDollars / marketPrice);
  
  // Apply caps
  return Math.max(1, Math.min(
    contracts,
    Math.floor(depth * 0.25), // max 25% of visible liquidity
    Math.floor(500 / marketPrice), // $500 hard cap
    200 // absolute max contracts
  ));
}
```

Use this in:
1. Background scanner when creating pending trades
2. Today's picks endpoint
3. Live sports engine

This means a +37% edge weather trade gets ~80 contracts while a +3% edge NBA game gets ~8 contracts.

## 6. Reduce Finance/Crypto Losses

Add category-specific risk multipliers in the signal engine:
```typescript
const CATEGORY_RISK_MULTIPLIER: Record<string, number> = {
  weather: 1.0,      // Full allocation — strongest edge
  economics: 0.9,    // Strong performance
  sports: 0.7,       // Moderate — fan bias helps but volatile
  politics: 0.6,     // Lower confidence
  crypto: 0.4,       // High volatility, weak model
  finance: 0.3,      // Near-efficient, -$143 P&L
  technology: 0.5,   // Mixed results
  world_events: 0.8, // High gap but untested
  entertainment: 0.7, // High gap
};
```

Apply this multiplier to the Kelly sizing: `contracts = contracts * categoryMultiplier`

Also: tighten stop-loss for Finance/Crypto from 40% to 25%.

## 7. Switch Default to Supervised Mode

In the seed data / default settings:
- Change bot_mode from "autonomous" to "supervised" 
- Set auto_min_edge to 8 (was 5)
- Set auto_min_confidence to 80 (was 75)

This means only trades with ≥8% edge AND ≥80% confidence auto-execute. Everything else queues for human review.

## 8. Raise Min Edge & Scan Frequency

- Change auto_min_edge default to 8% (from 5%)
- Change scan_frequency default to 60 seconds (from 30)
- Update the background scanner interval to read from settings (currently hardcoded 60s, which is good)

## 9. Capital Rebalance

Add to the Dashboard analytics section:
- "Recommended Allocation" card showing where capital SHOULD be vs where it IS:
  | Category | Current | Recommended | Action |
  | Weather | $457 (15%) | $900 (30%) | Increase |
  | Economics | $926 (30%) | $750 (25%) | Hold |
  | World Events | $0 (0%) | $600 (20%) | Add |
  | Sports | $670 (22%) | $450 (15%) | Reduce |
  | Politics | $444 (14%) | $150 (5%) | Reduce |
  | Technology | $805 (26%) | $100 (3%) | Reduce |
  | Finance | $502 (16%) | $50 (2%) | Reduce |

This is display-only for now — the dynamic Kelly + category multipliers handle the actual rebalancing.
