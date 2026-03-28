import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { Zap, RefreshCw, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, AlertTriangle, Target, Shield } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

// ── Event name + description mapping ─────────────────────────────────────────

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

// ── Edge type classification ──────────────────────────────────────────────────

function getEdgeType(ticker: string): { label: string; color: string } {
  const t = ticker.toUpperCase();
  if (/TEMP|RAIN|WEATH|HIGH|LOW|SNOW|KXHIGH/i.test(t)) return { label: "Weather Model", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" };
  if (/FED|CPI|GDP|UNEM|RATE|ECON|KXFED|KXCPI|KXGDP/i.test(t)) return { label: "Macro Divergence", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  if (/NBA|NFL|NHL|MLB|SPORT|GAME|PTS|REB|AST|SUPERBOWL|KXNBA|KXNFL/i.test(t)) return { label: "Sports Bias", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" };
  if (/BTC|ETH|CRYPTO|COIN|KXBTC|KXETH/i.test(t)) return { label: "Cross-Platform", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };
  if (/PRES|SENATE|ELEC|GOV|VOTE|POLI/i.test(t)) return { label: "YES/NO Asymmetry", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
  return { label: "Longshot Bias", color: "bg-orange-500/20 text-orange-400 border-orange-500/40" };
}

// ── Generate actionable recommendation ────────────────────────────────────────

function getRecommendation(sig: Signal): { action: string; reasoning: string; risk: string; icon: "up" | "down" | "neutral" } {
  const event = getEventInfo(sig.ticker);
  const edgeType = getEdgeType(sig.ticker);
  const edgePct = Math.abs(sig.edgeScore).toFixed(1);
  const trueProb = (sig.trueProbability * 100).toFixed(0);
  const mktPrice = (sig.marketPrice * 100).toFixed(0);
  const conf = (sig.modelConfidence * 100).toFixed(0);

  if (sig.signalType === "BUY_YES") {
    const isFavorite = sig.marketPrice > 0.6;
    const isLongshot = sig.marketPrice < 0.2;
    let action = `Buy YES on "${event.name}" at ${mktPrice}¢.`;
    let reasoning = `Our ${sig.modelName} model estimates a ${trueProb}% true probability vs. the market's ${mktPrice}¢ price — a +${edgePct}% edge (${conf}% confidence). `;

    if (edgeType.label === "Weather Model") {
      reasoning += `GFS ensemble forecasts diverge from the crowd-priced weather expectation, creating a model-vs-crowd edge.`;
    } else if (edgeType.label === "Macro Divergence") {
      reasoning += `Kalshi's implied probability diverges from consensus economic forecasts. Historically, when Kalshi diverges >0.1pp from Bloomberg consensus, Kalshi is right 75-81% of the time.`;
    } else if (edgeType.label === "Sports Bias") {
      reasoning += `Fan loyalty bias is pushing the market price lower than statistical models suggest. Sports markets carry a 2.23pp maker-taker gap driven by emotional betting.`;
    } else if (isFavorite) {
      reasoning += `This is a high-probability favorite contract — contracts above 50¢ have historically outperformed their implied probability across all categories.`;
    } else if (isLongshot) {
      reasoning += `Caution: this is a longshot contract. While the edge appears positive, contracts below 20¢ carry deeply negative expected value on average. Consider reduced position sizing.`;
    } else {
      reasoning += `The market appears to be underpricing this outcome. Positive edge suggests the market hasn't fully incorporated available information.`;
    }

    const risk = isLongshot
      ? "High risk — longshot contracts have structurally negative EV. Use fractional Kelly sizing (25% of full Kelly)."
      : sig.modelConfidence < 0.7
      ? "Moderate risk — model confidence is below 70%. Consider smaller position size."
      : "Standard risk — use fractional Kelly (25-50%) position sizing.";

    return { action, reasoning, risk, icon: "up" };
  }

  if (sig.signalType === "BUY_NO") {
    let action = `Buy NO (sell YES) on "${event.name}" at ${mktPrice}¢.`;
    let reasoning = `Our ${sig.modelName} model estimates only a ${trueProb}% true probability, but the market is pricing it at ${mktPrice}¢ — a ${edgePct}% mispricing favoring NO. `;

    if (edgeType.label === "YES/NO Asymmetry") {
      reasoning += `This fits the documented "Optimism Tax" — YES buyers disproportionately overpay at these price levels. NO outperforms YES at 69 of 99 price levels on Kalshi.`;
    } else if (edgeType.label === "Sports Bias") {
      reasoning += `Fan loyalty bias is inflating this contract's YES price. Selling against emotional YES buyers is the highest-structural-alpha position in sports markets.`;
    } else if (sig.marketPrice < 0.2) {
      reasoning += `At ${mktPrice}¢, YES buyers have historically averaged -41% EV while NO buyers average +23% EV — a 64pp divergence. This is the classic longshot bias.`;
    } else {
      reasoning += `The market is overpricing this outcome. Providing NO liquidity captures the optimism premium built into the YES side.`;
    }

    const risk = sig.modelConfidence < 0.7
      ? "Moderate risk — model confidence below 70%. Use smaller position and post-only limit orders for maker fee savings."
      : "Standard risk — post-only NO limit orders capture the 0.05% maker rebate vs. 0.2% taker fee.";

    return { action, reasoning, risk, icon: "down" };
  }

  // NO_TRADE
  const action = `No action on "${event.name}."`;
  const reasoning = `Edge of ${sig.edgeScore > 0 ? "+" : ""}${sig.edgeScore.toFixed(2)}% is below the 3% threshold after accounting for Kalshi taker fees (0.07 × contracts × P × (1−P)). The ${sig.modelName} model sees the market as approximately fairly priced at ${mktPrice}¢.`;
  const risk = "No capital at risk. Continue monitoring for edge expansion.";

  return { action, reasoning, risk, icon: "neutral" };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Signal = {
  id: number; ticker: string; edgeScore: number; trueProbability: number;
  marketPrice: number; signalType: string; modelConfidence: number;
  modelName: string; createdAt: string;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Signals() {
  const [filterType, setFilterType] = useState("all");
  const [minEdge, setMinEdge] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: signals, isLoading, refetch } = useQuery<Signal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 15000,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      const count = signals?.length || 0;
      toast({ title: "Signals refreshed", description: `Loaded ${count} signal${count !== 1 ? "s" : ""}.` });
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e?.message || "Failed to refresh signals", variant: "destructive" });
    } finally {
      setIsRefreshing(false);
    }
  };

  const filtered = (signals || []).filter(s => {
    if (filterType !== "all" && s.signalType !== filterType) return false;
    if (minEdge && Math.abs(s.edgeScore) < parseFloat(minEdge)) return false;
    return true;
  });

  const buyYes = (signals || []).filter(s => s.signalType === "BUY_YES").length;
  const buyNo = (signals || []).filter(s => s.signalType === "BUY_NO").length;
  const noTrade = (signals || []).filter(s => s.signalType === "NO_TRADE").length;

  return (
    <div className="p-4 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-2 h-8 rounded bg-profit" />
          <div>
            <div className="text-xs text-muted-foreground">BUY YES</div>
            <div className="text-xl font-semibold mono text-profit">{buyYes}</div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-2 h-8 rounded bg-loss" />
          <div>
            <div className="text-xs text-muted-foreground">BUY NO</div>
            <div className="text-xl font-semibold mono text-loss">{buyNo}</div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-2 h-8 rounded bg-muted-foreground" />
          <div>
            <div className="text-xs text-muted-foreground">NO TRADE</div>
            <div className="text-xl font-semibold mono text-muted-foreground">{noTrade}</div>
          </div>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-36 h-9 text-sm" data-testid="select-signal-type">
            <SelectValue placeholder="Signal type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Signals</SelectItem>
            <SelectItem value="BUY_YES">BUY YES</SelectItem>
            <SelectItem value="BUY_NO">BUY NO</SelectItem>
            <SelectItem value="NO_TRADE">NO TRADE</SelectItem>
          </SelectContent>
        </Select>
        <Input data-testid="input-min-edge" type="number" placeholder="Min edge %" className="w-32 h-9 text-sm" value={minEdge} onChange={e => setMinEdge(e.target.value)} />
        <div className="text-xs text-muted-foreground mono">{filtered.length} signals</div>
        <Button variant="outline" size="sm" className="ml-auto h-9 gap-1.5 text-xs" data-testid="button-refresh-signals" onClick={handleRefresh} disabled={isRefreshing || isLoading}>
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Signal Cards */}
      <div className="space-y-2">
        {isLoading
          ? Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
          : filtered.map(sig => {
              const event = getEventInfo(sig.ticker);
              const edgeType = getEdgeType(sig.ticker);
              const rec = getRecommendation(sig);
              const isExpanded = expandedId === sig.id;
              const isYes = sig.signalType === "BUY_YES";
              const isNo = sig.signalType === "BUY_NO";
              const isNt = sig.signalType === "NO_TRADE";
              const highEdge = Math.abs(sig.edgeScore) > 3;

              return (
                <Card
                  key={sig.id}
                  data-testid={`signal-row-${sig.id}`}
                  className={`transition-all cursor-pointer hover:bg-muted/20 ${isExpanded ? "ring-1 ring-primary/40" : ""}`}
                  onClick={() => setExpandedId(isExpanded ? null : sig.id)}
                >
                  <CardContent className="p-0">
                    {/* Compact row */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Signal icon */}
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isYes ? "bg-profit/15" : isNo ? "bg-loss/15" : "bg-muted"}`}>
                        {isYes ? <TrendingUp className="w-4 h-4 text-profit" /> : isNo ? <TrendingDown className="w-4 h-4 text-loss" /> : <Minus className="w-4 h-4 text-muted-foreground" />}
                      </div>

                      {/* Event name + category */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{event.name}</span>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${edgeType.color} flex-shrink-0`}>{edgeType.label}</Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate mt-0.5">{event.description}</div>
                      </div>

                      {/* Signal badge */}
                      <Badge variant={isNt ? "secondary" : "outline"} className={`text-xs flex-shrink-0 ${isYes ? "border-profit text-profit" : isNo ? "border-loss text-loss" : ""}`}>
                        {sig.signalType.replace("_", " ")}
                      </Badge>

                      {/* Edge score */}
                      <div className={`text-right mono font-semibold text-sm flex-shrink-0 w-16 ${isYes ? "text-profit" : isNo ? "text-loss" : "text-muted-foreground"}`}>
                        {sig.edgeScore > 0 ? "+" : ""}{sig.edgeScore.toFixed(1)}%
                      </div>

                      {/* Confidence */}
                      <div className="text-right mono text-xs flex-shrink-0 w-12">
                        <span className={sig.modelConfidence >= 0.8 ? "text-profit" : sig.modelConfidence >= 0.65 ? "text-foreground" : "text-muted-foreground"}>
                          {(sig.modelConfidence * 100).toFixed(0)}%
                        </span>
                      </div>

                      {/* Model */}
                      <div className="text-xs text-muted-foreground flex-shrink-0 w-24 text-right hidden lg:block">{sig.modelName}</div>

                      {/* Time */}
                      <div className="text-[11px] mono text-muted-foreground flex-shrink-0 w-20 text-right hidden md:block">
                        {format(parseISO(sig.createdAt), "MM/dd HH:mm")}
                      </div>

                      {/* Trade button */}
                      {highEdge && (
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs px-2.5 gap-1 border-primary/50 text-primary hover:bg-primary/10 flex-shrink-0"
                          data-testid={`button-trade-signal-${sig.id}`}
                          onClick={e => { e.stopPropagation(); navigate("/markets"); }}
                        >
                          <Zap className="w-3 h-3" /> Trade
                        </Button>
                      )}

                      {/* Expand chevron */}
                      <div className="flex-shrink-0 text-muted-foreground">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-border/50 space-y-3">
                        {/* Recommendation */}
                        <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                          <div className="flex items-center gap-2 text-xs font-medium">
                            <Target className="w-3.5 h-3.5 text-primary" />
                            <span className="text-primary">Recommendation</span>
                          </div>
                          <div className={`text-sm font-medium ${isYes ? "text-profit" : isNo ? "text-loss" : "text-muted-foreground"}`}>
                            {rec.action}
                          </div>
                        </div>

                        {/* Reasoning */}
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <TrendingUp className="w-3.5 h-3.5" />
                            Why
                          </div>
                          <p className="text-xs text-foreground/80 leading-relaxed">{rec.reasoning}</p>
                        </div>

                        {/* Risk assessment */}
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Shield className="w-3.5 h-3.5" />
                            Risk Assessment
                          </div>
                          <p className="text-xs text-foreground/70 leading-relaxed">{rec.risk}</p>
                        </div>

                        {/* Key metrics row */}
                        <div className="grid grid-cols-4 gap-3 pt-1">
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">True Prob</div>
                            <div className="mono text-sm font-semibold">{(sig.trueProbability * 100).toFixed(1)}%</div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Market Price</div>
                            <div className="mono text-sm">{(sig.marketPrice * 100).toFixed(1)}¢</div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Confidence</div>
                            <div className={`mono text-sm ${sig.modelConfidence >= 0.8 ? "text-profit font-semibold" : ""}`}>{(sig.modelConfidence * 100).toFixed(1)}%</div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Model</div>
                            <div className="text-xs">{sig.modelName}</div>
                          </div>
                        </div>

                        {/* Longshot warning */}
                        {sig.marketPrice < 0.2 && sig.signalType === "BUY_YES" && (
                          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-md p-2.5 text-xs text-yellow-400">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span>Longshot warning: Contracts below 20¢ win far less often than implied. A 5¢ contract wins only 4.18% of the time (implied 5%), a -16.36% mispricing. Consider reduced sizing or selling NO instead.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
        }
        {!isLoading && filtered.length === 0 && (
          <Card>
            <CardContent className="p-10 text-center text-muted-foreground">
              No signals match your filters.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
