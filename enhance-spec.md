# Comprehensive Platform Enhancement Spec

## Issues Found in Audit

### 1. Market Detail View — Too Empty
When clicking a market, the detail view has minimal info and "No orderbook data" for many markets. Also the trade panel says "Configure RSA key" even in demo mode. FIX:
- Always show a demo trade panel (even without private key) — it just shows a "Demo Mode" notice instead of blocking trading entirely
- Add more market details: close time, last price, 24h volume, event ticker
- Show a price chart placeholder or last trades for the market
- The "Back" button and market info card should feel richer

### 2. Dashboard — Missing Interactivity
The dashboard KPI cards are static. FIX:
- Make KPI cards clickable — clicking "Positions" card goes to /#/positions, "Win Rate" goes to /#/backtest, etc.
- Add a "Quick Actions" row: [Place Trade] [Cancel All] [Pause Bot] buttons
- Agent health cards should be clickable — expand to show more details or link to logs

### 3. Orders Page — Demo Cancel Not Working Visually
When clicking cancel on demo orders, there should be a toast confirmation. Also "Cancel All Open" in demo mode should show a confirmation dialog. FIX:
- Add confirmation dialog before cancel all
- Show toast after successful cancel
- Filter controls should include date range options

### 4. Positions Page — Needs "Close Position" Button
Positions table shows data but has no action buttons. FIX:
- Add "Close" button per position (would create a sell order for the full quantity)
- Show total portfolio value more prominently
- Make position rows clickable to navigate to that market

### 5. Signals Page — Needs Action Buttons
Signal rows show edge data but you can't act on them. FIX:
- Add "Trade" button on high-edge signals that links to that market's trade view
- Add a "Refresh" button to reload signals

### 6. Risk Page — Sliders Need Live Feedback
The risk sliders work but don't give immediate feedback. FIX:
- Show "unsaved changes" indicator when sliders move from saved values
- Add reset to defaults button

### 7. Settings — Test Connection UX
The "Test Connection" button is disabled until a key is saved. FIX:
- After saving settings, auto-test connection
- Show clearer status: green checkmark / red X with message
- Add "Clear Private Key" button

### 8. Compliance — Needs Filtering
Audit log has export but no filtering. FIX:
- Add event type filter dropdown
- Add date range filter
- Add search by ticker

### 9. Alpha Edges — Needs "Activate" Buttons
Edge cards expand but you can't change their status. FIX:
- Add "Activate" / "Deactivate" toggle per edge
- When expanding, show implementation checklist (data source connected? Model configured? etc.)

### 10. Global UX Improvements (Best Practices from Research)
- Add keyboard shortcuts: Escape to go back, Ctrl+K for command palette search
- Add loading skeletons on all data-fetching pages (some already have them, ensure consistency)
- Add error states — show a retry button when API calls fail
- Toast notifications for ALL mutations (save, cancel, bot control, etc.)
- Breadcrumb navigation on sub-pages (market detail, backtest detail)
- Mobile responsive — at minimum don't break on tablet widths

## IMPLEMENTATION PRIORITY
1. Dashboard quick actions + clickable KPIs
2. Market detail enrichment + demo trade panel always visible
3. Positions close button + click-to-market
4. Signals trade button
5. Orders confirmation dialogs + toasts
6. Compliance filtering
7. Settings auto-test + clear key
8. Risk unsaved changes indicator
9. Alpha activate toggles
10. Global toast consistency
