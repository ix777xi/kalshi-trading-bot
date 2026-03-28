import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TrendingUp, TrendingDown, Target, Shield, DollarSign, CheckCircle2, AlertTriangle, Zap, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Event mapping ─────────────────────────────────────────────────────────────

const EVENT_MAP: Record<string, { name: string; category: string; description: string }> = {
  "PRES-2024-D": { name: "Democratic Presidential Win", category: "Politics", description: "Will the Democratic candidate win the 2024 Presidential election?" },
  "FED-RATE-JUL": { name: "Fed Rate Cut — July", category: "Economics", description: "Will the Federal Reserve cut interest rates at the July FOMC meeting?" },
  "NBA-EAST-BOS": { name: "Celtics Win Eastern Conference", category: "Sports", description: "Will the Boston Celtics win the NBA Eastern Conference finals?" },
  "TEMP-NYC-JUL": { name: "NYC Heat Wave — July", category: "Weather", description: "Will the average temperature in NYC exceed 85°F during July?" },
  "AAPL-1T-2024": { name: "Apple $1T Market Cap", category: "Technology", description: "Will Apple's market capitalization reach $1 trillion by end of 2024?" },
  "BTC-100K-Q3": { name: "Bitcoin Above $100K", category: "Crypto", description: "Will Bitcoin trade above $100,000 at any point during Q3?" },
  "UK-ELEC-LAB": { name: "Labour Wins UK Election", category: "Politics", description: "Will the Labour Party win the next UK general election?" },
  "GDP-US-Q2": { name: "US GDP Growth > 2.5%", category: "Economics", description: "Will US real GDP growth exceed 2.5% annualized in Q2?" },
  "SUPERBOWL-KC": { name: "Chiefs Win Super Bowl LIX", category: "Sports", description: "Will the Kansas City Chiefs win Super Bowl LIX?" },
  "CPI-3PCT-AUG": { name: "CPI Below 3% — August", category: "Economics", description: "Will the Consumer Price Index year-over-year reading fall below 3% in August?" },
  "EURO24-ESP": { name: "Spain Wins Euro 2024", category: "Sports", description: "Will Spain win the UEFA Euro 2024 tournament?" },
  "OIL-80-Q4": { name: "Crude Oil Above $80 — Q4", category: "Commodities", description: "Will WTI crude oil prices stay above $80/barrel through Q4?" },
  "SENATE-DEM": { name: "Democrats Hold Senate", category: "Politics", description: "Will the Democratic Party maintain control of the US Senate?" },
  "NVDA-500B": { name: "Nvidia $500B+ Market Cap", category: "Technology", description: "Will Nvidia's market capitalization exceed $500 billion?" },
  "RAIN-LA-JUN": { name: "Rain in Los Angeles — June", category: "Weather", description: "Will measurable rainfall (>0.01 in) occur in Los Angeles during June?" },
  "FED-HIKE-SEP": { name: "Fed Rate Hike — September", category: "Economics", description: "Will the Federal Reserve raise interest rates at the September FOMC meeting?" },
  "NFLX-200M": { name: "Netflix 200M Subscribers", category: "Technology", description: "Will Netflix reach 200 million paid subscribers globally?" },
  "TSLA-250": { name: "Tesla Above $250", category: "Technology", description: "Will Tesla stock trade above $250 during Q3?" },
  "EURO-PAR": { name: "Euro Parity with USD", category: "Economics", description: "Will the EUR/USD exchange rate reach 1:1 parity?" },
  "UNEM-4PCT": { name: "Unemployment Above 4%", category: "Economics", description: "Will the US unemployment rate rise above 4%?" },
};

function getEventInfo(ticker: string) {
  return EVENT_MAP[ticker] || { name: ticker, category: "Other", description: `Prediction market contract: ${ticker}` };
}

function getEdgeType(ticker: string): { label: string; color: string } {
  const t = ticker.toUpperCase();
  if (/TEMP|RAIN|WEATH|HIGH|LOW|SNOW/i.test(t)) return { label: "Weather", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" };
  if (/FED|CPI|GDP|UNEM|RATE/i.test(t)) return { label: "Macro", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  if (/NBA|NFL|NHL|MLB|SUPERBOWL/i.test(t)) return { label: "Sports", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" };
  if (/BTC|ETH|CRYPTO/i.test(t)) return { label: "Crypto", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };
  if (/PRES|SENATE|ELEC|GOV/i.test(t)) return { label: "Politics", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
  return { label: "Market", color: "bg-gray-500/20 text-gray-400 border-gray-500/30" };
}

function getReasoning(sig: Signal): string {
  const event = getEventInfo(sig.ticker);
  const trueProb = (sig.trueProbability * 100).toFixed(0);
  const mktPrice = (sig.marketPrice * 100).toFixed(0);
  const edge = Math.abs(sig.edgeScore).toFixed(1);

  if (sig.signalType === "BUY_YES") {
    if (sig.marketPrice > 0.6) return `${event.name} is underpriced at ${mktPrice}¢. Our model sees ${trueProb}% true probability — a +${edge}% edge. Historically, favorites above 50¢ outperform implied probability.`;
    if (/TEMP|RAIN|WEATH/i.test(sig.ticker)) return `GFS weather ensemble forecasts diverge from crowd pricing on ${event.name}. Model: ${trueProb}% vs market ${mktPrice}¢. Weather models have shown 85-90% win rates when divergence is this large.`;
    if (/FED|CPI|GDP/i.test(sig.ticker)) return `Kalshi's implied probability on ${event.name} diverges from consensus forecasts. When Kalshi diverges >0.1pp from Bloomberg consensus, it's right 75-81% of the time. Edge: +${edge}%.`;
    return `${event.name} appears underpriced at ${mktPrice}¢. Our ${sig.modelName} model estimates ${trueProb}% true probability — a +${edge}% edge after fees.`;
  }

  if (sig.signalType === "BUY_NO") {
    if (sig.marketPrice < 0.2) return `Classic longshot bias on ${event.name}. At ${mktPrice}¢, YES buyers average -41% EV while NO buyers average +23%. Sell YES / buy NO to capture the optimism premium.`;
    if (/NBA|NFL|SUPERBOWL/i.test(sig.ticker)) return `Fan loyalty bias is inflating ${event.name} at ${mktPrice}¢. Sports markets carry a 2.23pp maker-taker gap. Selling against emotional YES buyers is high-structural-alpha.`;
    return `${event.name} is overpriced at ${mktPrice}¢. Model sees only ${trueProb}% true probability — a ${edge}% edge favoring NO. NO outperforms YES at 69 of 99 price levels on Kalshi.`;
  }

  return "";
}

type Signal = {
  id: number; ticker: string; edgeScore: number; trueProbability: number;
  marketPrice: number; signalType: string; modelConfidence: number;
  modelName: string; createdAt: string;
};

type Settings = { hasPrivateKey: boolean };

// ── Trade Card Component ──────────────────────────────────────────────────────

function TradeCard({ sig, hasPrivateKey }: { sig: Signal; hasPrivateKey: boolean }) {
  const [contracts, setContracts] = useState(10);
  const [showConfirm, setShowConfirm] = useState(false);
  const [executed, setExecuted] = useState(false);
  const { toast } = useToast();

  const event = getEventInfo(sig.ticker);
  const edgeType = getEdgeType(sig.ticker);
  const isYes = sig.signalType === "BUY_YES";
  const side = isYes ? "yes" : "no";
  const action = "buy";
  const priceCents = Math.round(sig.marketPrice * 100);
  const pricePerContract = sig.marketPrice;
  const estimatedCost = (contracts * pricePerContract).toFixed(2);
  const potentialProfit = (contracts * (1 - pricePerContract)).toFixed(2);
  const reasoning = getReasoning(sig);

  const placeTrade = useMutation({
    mutationFn: async () => {
      const body = {
        ticker: sig.ticker,
        side,
        action,
        count: contracts,
        type: "limit",
        yes_price: isYes ? priceCents : undefined,
        no_price: !isYes ? (100 - priceCents) : undefined,
        client_order_id: crypto.randomUUID(),
        post_only: true,
      };
      return apiRequest("POST", "/api/live/orders", body);
    },
    onSuccess: () => {
      setExecuted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/live/orders"] });
      toast({ title: "Order placed", description: `${contracts} contracts ${side.toUpperCase()} on ${event.name} at ${priceCents}¢` });
    },
    onError: (err: any) => {
      toast({ title: "Trade failed", description: err?.message || "Could not place order", variant: "destructive" });
    },
  });

  const handleConfirmTrade = () => {
    setShowConfirm(false);
    placeTrade.mutate();
  };

  return (
    <Card className={`transition-all ${executed ? "ring-1 ring-profit/40 bg-profit/5" : ""}`} data-testid={`hitl-card-${sig.id}`}>
      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold">{event.name}</h3>
              <Badge variant="outline" className={`text-[10px] px-1.5 border ${edgeType.color}`}>{edgeType.label}</Badge>
              <Badge variant={isYes ? "outline" : "outline"} className={`text-xs ${isYes ? "border-profit text-profit" : "border-loss text-loss"}`}>
                {isYes ? "BUY YES" : "BUY NO"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{event.description}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`text-xl font-bold mono ${isYes ? "text-profit" : "text-loss"}`}>
              {sig.edgeScore > 0 ? "+" : ""}{sig.edgeScore.toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Edge</div>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-muted/30 rounded-md p-2 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Model Prob</div>
            <div className="mono text-sm font-semibold">{(sig.trueProbability * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-muted/30 rounded-md p-2 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Market</div>
            <div className="mono text-sm">{priceCents}¢</div>
          </div>
          <div className="bg-muted/30 rounded-md p-2 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Confidence</div>
            <div className={`mono text-sm font-semibold ${sig.modelConfidence >= 0.8 ? "text-profit" : ""}`}>
              {(sig.modelConfidence * 100).toFixed(0)}%
            </div>
          </div>
          <div className="bg-muted/30 rounded-md p-2 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Model</div>
            <div className="text-xs truncate">{sig.modelName}</div>
          </div>
        </div>

        {/* Reasoning */}
        <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary mb-1.5">
            <Target className="w-3.5 h-3.5" />
            Why this trade
          </div>
          <p className="text-xs text-foreground/80 leading-relaxed">{reasoning}</p>
        </div>

        {/* Trade Controls */}
        {executed ? (
          <div className="flex items-center gap-2 bg-profit/10 border border-profit/20 rounded-lg p-3">
            <CheckCircle2 className="w-5 h-5 text-profit" />
            <div>
              <div className="text-sm font-medium text-profit">Order Placed</div>
              <div className="text-xs text-muted-foreground">{contracts} contracts {side.toUpperCase()} at {priceCents}¢ — ${estimatedCost}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Contracts</span>
                  <span className="mono font-medium">{contracts}</span>
                </div>
                <Slider
                  data-testid={`slider-contracts-${sig.id}`}
                  value={[contracts]}
                  onValueChange={v => setContracts(v[0])}
                  min={1}
                  max={100}
                  step={1}
                  className="w-full"
                />
              </div>
              <div className="w-20">
                <Input
                  data-testid={`input-contracts-${sig.id}`}
                  type="number"
                  min={1}
                  max={1000}
                  value={contracts}
                  onChange={e => setContracts(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-8 text-sm mono text-center"
                />
              </div>
            </div>

            {/* Cost Summary */}
            <div className="flex items-center justify-between text-xs bg-muted/30 rounded-md px-3 py-2">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-muted-foreground">Cost: </span>
                  <span className="mono font-semibold">${estimatedCost}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Max Profit: </span>
                  <span className="mono font-semibold text-profit">${potentialProfit}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Return: </span>
                  <span className="mono font-semibold text-profit">
                    {((parseFloat(potentialProfit) / parseFloat(estimatedCost)) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Execute Button */}
            <Button
              data-testid={`button-execute-${sig.id}`}
              className={`w-full h-10 font-semibold ${isYes ? "bg-profit hover:bg-profit/90 text-profit-foreground" : "bg-loss hover:bg-loss/90 text-white"}`}
              onClick={() => setShowConfirm(true)}
              disabled={placeTrade.isPending || !hasPrivateKey}
            >
              {placeTrade.isPending ? (
                "Placing Order..."
              ) : !hasPrivateKey ? (
                <>
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Configure API Key in Settings to Trade
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Execute: {isYes ? "BUY YES" : "BUY NO"} — {contracts} contracts @ {priceCents}¢
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Trade</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>You are about to place a real order on Kalshi:</p>
                <div className="bg-muted/30 rounded-md p-3 space-y-1 text-sm">
                  <div><span className="text-muted-foreground">Event:</span> <span className="font-medium">{event.name}</span></div>
                  <div><span className="text-muted-foreground">Action:</span> <span className={`font-medium ${isYes ? "text-profit" : "text-loss"}`}>{isYes ? "BUY YES" : "BUY NO"}</span></div>
                  <div><span className="text-muted-foreground">Contracts:</span> <span className="mono font-medium">{contracts}</span></div>
                  <div><span className="text-muted-foreground">Price:</span> <span className="mono font-medium">{priceCents}¢ per contract</span></div>
                  <div><span className="text-muted-foreground">Total Cost:</span> <span className="mono font-semibold">${estimatedCost}</span></div>
                  <div><span className="text-muted-foreground">Max Profit:</span> <span className="mono font-semibold text-profit">${potentialProfit}</span></div>
                  <div><span className="text-muted-foreground">Order Type:</span> <span className="font-medium">Limit (Post-Only)</span></div>
                </div>
                <p className="text-xs text-muted-foreground">This will place a real order using your Kalshi API credentials. Post-only orders qualify for the 0.05% maker rebate.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-trade"
              className={isYes ? "bg-profit hover:bg-profit/90" : "bg-loss hover:bg-loss/90"}
              onClick={handleConfirmTrade}
            >
              Confirm & Place Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HumanInTheLoop() {
  const { data: signals, isLoading } = useQuery<Signal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 15000,
  });

  const { data: settingsData } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const hasPrivateKey = settingsData?.hasPrivateKey ?? false;

  // Filter to high-confidence actionable signals only
  const topSignals = (signals || [])
    .filter(s => s.signalType !== "NO_TRADE" && Math.abs(s.edgeScore) >= 4 && s.modelConfidence >= 0.65)
    .sort((a, b) => {
      // Sort by confidence × edge magnitude
      const scoreA = a.modelConfidence * Math.abs(a.edgeScore);
      const scoreB = b.modelConfidence * Math.abs(b.edgeScore);
      return scoreB - scoreA;
    })
    .slice(0, 10);

  const buyYesCount = topSignals.filter(s => s.signalType === "BUY_YES").length;
  const buyNoCount = topSignals.filter(s => s.signalType === "BUY_NO").length;
  const avgConfidence = topSignals.length > 0
    ? (topSignals.reduce((sum, s) => sum + s.modelConfidence, 0) / topSignals.length * 100).toFixed(0)
    : "0";
  const avgEdge = topSignals.length > 0
    ? (topSignals.reduce((sum, s) => sum + Math.abs(s.edgeScore), 0) / topSignals.length).toFixed(1)
    : "0";

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
          <User className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Human in the Loop</h1>
          <p className="text-xs text-muted-foreground">Top predictions ranked by confidence and edge. Review, size, and execute.</p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold mono text-primary">{topSignals.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Actionable</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold mono">
              <span className="text-profit">{buyYesCount}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-loss">{buyNoCount}</span>
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">YES / NO</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold mono">{avgConfidence}%</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Confidence</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold mono">{avgEdge}%</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Edge</div>
          </CardContent>
        </Card>
      </div>

      {/* Connection Warning */}
      {!hasPrivateKey && (
        <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Configure your RSA private key in <a href="#/settings" className="underline font-medium">Settings</a> to execute trades. You can review predictions without it.</span>
        </div>
      )}

      {/* Trade Cards */}
      {isLoading ? (
        <div className="space-y-3">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-64 rounded-lg" />)}
        </div>
      ) : topSignals.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Shield className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <div className="text-sm font-medium mb-1">No high-confidence signals right now</div>
            <div className="text-xs">Signals require at least 4% edge and 65% model confidence to appear here. Check back soon.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {topSignals.map((sig, idx) => (
            <TradeCard key={sig.id} sig={sig} hasPrivateKey={hasPrivateKey} />
          ))}
        </div>
      )}

      {/* Footer Disclaimer */}
      <div className="text-[10px] text-muted-foreground/50 text-center pt-2">
        Predictions are model-generated estimates. Trading on Kalshi involves risk of loss. Past performance does not guarantee future results. CFTC-regulated.
      </div>
    </div>
  );
}
