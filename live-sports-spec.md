# Live Sports In-Game Trading Engine Spec

## Overview
Build a real-time sports trading engine that monitors live NBA game scores via the ESPN API (free, no key) and automatically buys/sells Kalshi game winner markets as the game state changes. The engine exploits the 10-second+ TV broadcast latency vs live data feeds.

## ESPN API (free, no key needed)
- Scoreboard: https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
- Returns: all today's games with live scores, period, clock, team stats, game status
- Fields: status.period (1-4+OT), status.displayClock, competitors[].score, competitors[].team.abbreviation, status.type.state ("pre"/"in"/"post")

## Architecture

### server/live-sports-engine.ts (NEW FILE)
Core engine that:
1. Polls ESPN scoreboard every 15 seconds during active games
2. For each live game (status.type.state === "in"):
   a. Get current score differential
   b. Calculate a live win probability using a simple model:
      - Base: pre-game Kalshi price (market's prior)
      - Adjust for: score differential, period, clock remaining
      - Formula: win_prob = base_prob + (score_diff × period_weight)
        - Q1 weight: 0.005 per point (small adjustment early)
        - Q2 weight: 0.008 per point
        - Q3 weight: 0.012 per point
        - Q4 weight: 0.020 per point (big swings late)
        - OT weight: 0.030 per point
      - Clamp between 0.02 and 0.98
   c. Compare live_win_prob to current Kalshi market price
   d. If gap > 5%: generate a TRADE signal
   e. If we hold a position and the model flips (our side now losing): generate a SELL signal

3. For games that just ended (status.type.state === "post"):
   - Check if we have open positions
   - Contracts resolve automatically, but flag them in the activity feed

### Matching ESPN Games to Kalshi Markets
Kalshi NBA game tickers follow: KXNBAGAME-{DATE}{AWAY}{HOME}-{TEAM}
ESPN has team abbreviations. Map them:
- Parse the Kalshi ticker to extract the matchup
- Match to ESPN game by team abbreviations
- Example: KXNBAGAME-26MAR28SACATL → SAC @ ATL

### Trade Logic
When live_win_prob diverges from Kalshi price by >5%:
- If we DON'T have a position:
  - BUY the side the model favors
  - Size: half-Kelly capped at $100 per game
- If we DO have a position:
  - If our position is on the RIGHT side (model agrees): HOLD
  - If our position is on the WRONG side (model flipped): SELL immediately
  - If our position edge grew significantly: consider adding
- On game end: log result

### Risk Controls for Live Sports
- Max $100 per game (hard cap, never override)
- Max 3 simultaneous live game positions
- No trades in final 2 minutes of Q4 (spread too wide, convergence risk)
- If down >$50 on live sports today: stop live sports trading
- All trades are limit orders at or near the current best bid/ask

## Backend Integration

### New endpoint: GET /api/live-sports
Returns the current live sports state:
```json
{
  "activeGames": [
    {
      "espnGameId": "...",
      "away": "SAC", "home": "ATL",
      "awayScore": 45, "homeScore": 52,
      "period": 2, "clock": "3:42",
      "status": "in_progress",
      "kalshiTickers": { "home": "KXNBAGAME-...-ATL", "away": "KXNBAGAME-...-SAC" },
      "kalshiHomePrice": 0.89, "kalshiAwayPrice": 0.10,
      "modelHomeProb": 0.92, "modelAwayProb": 0.08,
      "edge": 0.03,
      "signal": "HOLD" | "BUY_HOME" | "BUY_AWAY" | "SELL" | "NONE",
      "reasoning": "ATL leads by 7 in Q2. Model: 92% vs market 89%. Edge too small to trade."
    }
  ],
  "upcomingGames": [...],
  "completedGames": [...],
  "liveSportsPnl": 0,
  "livePositions": 0
}
```

### Background process
setInterval every 15 seconds:
1. Fetch ESPN scoreboard
2. For each in-progress game:
   - Match to Kalshi markets
   - Calculate model probability
   - If autonomous mode AND edge > threshold: auto-execute
   - If HITL mode: queue in pending trades with tag "live_sports"
3. Log all decisions to audit trail

### New endpoint: POST /api/live-sports/toggle
Enable/disable the live sports engine. Stored in settings.

## Frontend: Live Sports Panel

### Option A: Add to existing Bot Control / Autonomous page
Add a "Live Sports Trading" card that shows:
- Toggle: ON/OFF for live sports engine
- Active games with live scores, model probability, Kalshi price, edge
- For each game: current position (if any), P&L
- Activity feed of live sports trades

### Option B: New dedicated page /#/live-sports
Full page with:
- Live scoreboard showing all active NBA games
- Each game card: team logos/names, live score, quarter/clock
- Model probability bar vs Kalshi price bar (visual comparison)
- "Edge" indicator when divergence is large
- Position tracker: what we hold, entry price, current P&L
- Auto-executed trades feed
- Total live sports P&L for today

Go with Option B — dedicated page.

## IMPORTANT NOTES
- ESPN API is FREE and doesn't need an API key
- Poll every 15 seconds (not too aggressive)
- The 10-second TV broadcast latency is the core edge — our data leads the market
- Keep trades small ($50-100 per game) since this is higher variance than weather/macro
- The engine should only run when there are active games (check status.type.state)
- When no games are in progress: show upcoming games with countdowns
