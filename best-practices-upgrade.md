# Best Practices Upgrade Spec — From Research

## Key Findings from Research

### 1. Execution Best Practices
- **Post-only limit orders always** (0.05% maker rebate vs 0.2% taker fee)
- **Exponential backoff on rate limits** (429s) — Kalshi Basic tier: 20 read/sec, 10 write/sec
- **Never market-order on thin books** — slippage destroys edge
- **Execution slippage averages 0.3%** — must account for this in edge calculation
- **Fractional Kelly (25% of full Kelly)** is optimal — full Kelly has 33% chance of halving bankroll

### 2. Model Decay & Recalibration
- **Models decay quarterly** — need regular recalibration
- **Walk-forward optimization** — continuously update parameters based on recent data
- **Track Closing Line Value (CLV)** — if entry price consistently beats closing price, model has genuine edge
- **1000+ trades needed** for statistical significance on win rate

### 3. Risk Management (from $4.4M bot case + academic research)
- **Timezone/speed arbitrage** is the most sustainable edge (not prediction superiority)
- **Max 5% bankroll per market** (never override)
- **Trailing stops from peak** — 25% from peak unrealized gain
- **Time-decay exit** — exit within 4 hours of expiry with no clear edge
- **Edge erosion exit** — exit if model probability reverses to <2% edge
- **Daily loss limit** — halt at 10-15% of bankroll
- **Correlation clustering** — avoid overexposure to correlated markets

### 4. Dashboard & Monitoring Best Practices
- **Win rate by strategy type** — track which edges are performing
- **Average hold time** — flag positions held >72 hours
- **Edge captured vs theoretical** — measure execution quality
- **Drawdown alerts** — trigger at 6% intraday
- **P&L attribution** — break down by edge type (weather, sports, bias, etc.)

### 5. Position Management
- **Trailing stop** — trail 25% from peak unrealized gain
- **Profit target** — exit at 60% of max theoretical gain (don't wait for resolution)
- **Stop loss** — exit at 40% loss (not 50% — tighter)
- **Time-based exit** — close positions approaching expiry (last 4 hours)
- **Merge YES+NO** positions back to $1 to free capital

## UPGRADES TO IMPLEMENT

### A. Enhanced Signal Engine — Executable Edge with Spread/Slippage
Update signal-engine.ts to calculate:
- executable_edge = theoretical_edge - (spread / 2) - 0.003 (slippage allowance)
- Only flag ACTIONABLE if executable_edge >= 0.04 AND spread <= 0.08

### B. Position Monitoring with Exit Rules
Add to the background scanner: check all current positions every scan and generate SELL signals for:
- Trailing stop: if position was up X% but has dropped back 25% from peak
- Time-decay: within 4 hours of market close_time
- Edge erosion: model probability reversed to <2% edge
- Profit target: unrealized gain >= 60% of max theoretical

### C. Performance Tracking Dashboard
Add to the Dashboard page:
- Win rate by edge type (weather, sports bias, longshot, spread)
- Average edge captured (entry price vs resolution)
- P&L by category chart (stacked bar)
- Execution quality: slippage per trade

### D. Improved Kelly Sizing
Update to use 25% Kelly (not 50%) as default:
- quarter_kelly = full_kelly / 4
- Cap at min(quarter_kelly * bankroll, depth * 0.25, 500)

### E. Rate Limiting
Add proper rate limiting to all Kalshi API calls:
- Max 10 requests per second (conservative, below Basic tier limit)
- Queue requests and process with 100ms spacing
- Exponential backoff on 429 responses

### F. Correlation Guard
Before opening a new position, check if we already hold positions in correlated markets:
- Same event (e.g., multiple brackets of same CPI report)
- Same category with >3 positions already open
- Block if max category exposure exceeded
