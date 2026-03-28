# Autonomous Bot Upgrade — Full Spec

## Source: Kalshi Prediction Market Gap-Finding & Auto-Trade Bot System Prompts

## KEY UPGRADES NEEDED

### 1. Upgrade Signal Engine with 5-Step Analysis Framework
Replace/enhance the current signal engine (server/signal-engine.ts) with the full framework:

**Step 1 — Universe Scan**
- Fetch top markets sorted by 24h volume
- Filter: open status, min $10k volume, 1hr-45day TTX, categories: ECONOMICS, POLITICS, FINANCIALS, WEATHER, CRYPTO
- Extract: ticker, title, yes_bid, yes_ask, no_bid, no_ask, volume, OI, close_time

**Step 2 — Model Probability**  
- Hard data: GFS ensemble (weather), actual market prices (already have)
- Cross-reference: Compare prices across multiple Kalshi brackets
- The model_probability is what we already compute (GFS ensemble, longshot calibration, etc.)

**Step 3 — Edge Calculation (from the doc)**
```
theoretical_edge = model_probability - yes_ask  (for YES)
theoretical_edge = (1 - model_probability) - no_ask  (for NO)
executable_edge = theoretical_edge - (spread / 2)
```
ACTIONABLE if: |executable_edge| >= 0.05, spread <= 0.08, depth >= 50 contracts

**Step 4 — Liquidity-Adjusted Kelly Sizing**
```
full_kelly = executable_edge / (1 - executable_edge)
half_kelly = full_kelly / 2
max_position = min(half_kelly * bankroll, depth * 0.25, 500)
```

**Step 5 — Gap Type Classification**
Classify each opportunity as:
- Type A: Stale Pricing (price hasn't moved despite new data)
- Type B: Thin Liquidity Mispricing (<$5k OI, price moved by single order)
- Type C: Cross-Platform Spread (not implementable without Polymarket API)
- Type D: Probability Distortion Bias (longshot/favorite bias — already have this)
- Type E: Event-Driven Catalyst Gap (upcoming scheduled event)

### 2. Add Risk Guardrails (NEVER OVERRIDE)
These must be hardcoded in the signal engine:
1. Skip markets with existing position
2. Skip markets with <48 depth at best bid/ask
3. Never >5% of bankroll per market
4. Never trade with executable_edge < 0.04
5. Log every decision with full reasoning
6. Rate limit: <10 req/sec on Kalshi

### 3. Three Bot Modes with Approval System

**Mode 1: HITL (Human in the Loop)** — Current default
- Bot finds gaps → queues in pending trades → you approve each one

**Mode 2: SUPERVISED AUTO** — New mode  
- Bot finds gaps → auto-executes trades that meet ALL criteria:
  - executable_edge >= min_auto_edge (default 8%)
  - confidence >= min_auto_confidence (default 80%)
  - position_size <= max_auto_cost (default $50)
  - spread <= 0.06
- Trades that DON'T meet auto criteria still go to HITL for approval
- All auto-executed trades are logged and visible in the dashboard
- Emergency stop: any 3 consecutive losses → auto-pause, require manual restart

**Mode 3: FULL AUTONOMOUS** — Requires explicit approval  
- Bot executes ALL trades meeting guardrails without human confirmation
- Emergency shutdown triggers:
  - Daily loss > 15% of bankroll → HALT
  - 3x consecutive API auth failures → HALT
  - Drawdown > 20% → HALT
  - Any CRITICAL risk signal → HALT
- To enable: user must type a confirmation phrase and toggle a switch
- Can be revoked at any time

### 4. Approval System for Autonomous Mode (NEW PAGE: /#/autonomous)
New page with:
- Current mode display: HITL / Supervised / Autonomous
- Mode upgrade flow:
  1. To go from HITL → Supervised: just toggle the switch in Settings
  2. To go from Supervised → Autonomous: requires:
     - Typing "I understand the risks" in an input field
     - Setting a daily loss limit ($)
     - Setting a max drawdown limit (%)
     - Confirming API key is connected
     - Clicking "Release Autonomous Mode"
- Emergency kill switch: big red "HALT ALL TRADING" button always visible
- Bot status dashboard: uptime, trades today, P&L today, win rate (last 20 trades)
- Activity feed: real-time log of auto-executed trades with reasoning

### 5. Exit Rules (from the doc)
```
profit_target_pct: 0.60       # Exit at 60% of max theoretical gain
stop_loss_pct: 0.40           # Exit if position down 40%
time_decay_exit_hours: 4      # Exit if within 4 hours of expiry
edge_erosion_exit: true       # Exit if model probability reverses to <0.02 edge
trailing_stop_enabled: true
trailing_stop_from_peak_pct: 0.25  # Trail 25% from peak unrealized gain
```

### 6. Emergency Shutdown Procedure
When triggered (daily loss limit, auth failures, drawdown):
1. Cancel ALL open orders via Kalshi API
2. Set bot status to HALTED
3. Log full state snapshot
4. Show red HALTED banner across entire app
5. Require manual restart with explicit confirmation

## IMPLEMENTATION PLAN

### Backend (server/routes.ts + server/signal-engine.ts):
- Add `bot_mode` column to settings: "hitl" | "supervised" | "autonomous"
- Add `daily_loss_limit`, `max_drawdown_limit`, `autonomous_confirmed` to settings
- Upgrade signal engine with executable_edge calculation and gap type classification
- Add auto-execution logic in the background scanner when mode = supervised/autonomous
- Add emergency shutdown endpoint: POST /api/bot/emergency-halt
- Add trade execution logging to audit table

### Frontend:
- New page: /#/autonomous — bot control center with mode selector + kill switch
- Update Settings with the 3-mode selector
- Update HITL page to show auto-executed trades
- Add HALTED state banner to App.tsx

### Schema:
- Add to settings: bot_mode, daily_loss_limit, max_drawdown_limit, autonomous_confirmed_at, auto_min_edge, auto_min_confidence
- Add to pending_trades: gap_type, executable_edge, kelly_size, auto_executed
