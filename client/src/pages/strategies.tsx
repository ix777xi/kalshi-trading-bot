import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, RefreshCw, Zap, Shield, TrendingUp, Clock,
  BarChart3, Target, ArrowUpDown, ChevronDown, Activity
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";

type StrategyConfig = {
  id: string; name: string; description: string; enabled: boolean;
  priority: number; complexity: "low" | "medium" | "high";
  edgeDurability: "declining" | "medium" | "high";
  minCapital: string; riskLevel: "low" | "medium" | "high";
};

type StrategySignal = {
  id: string; strategyId: string; strategyName: string; ticker: string;
  title: string; action: string; side: string; priceCents: number;
  contracts: number; edge: number; expectedProfit: number;
  confidence: number; reasoning: string; urgency: string; createdAt: string;
};

type StrategyState = {
  strategies: StrategyConfig[]; signals: StrategySignal[];
  lastScan: string; activeStrategyCount: number; totalSignals: number;
};

const COMPLEXITY_COLOR: Record<string, string> = {
  low: "border-profit/30 text-profit", medium: "border-amber-500/30 text-amber-400", high: "border-loss/30 text-loss",
};
const DURABILITY_COLOR: Record<string, string> = {
  declining: "border-loss/30 text-loss", medium: "border-amber-500/30 text-amber-400", high: "border-profit/30 text-profit",
};
const RISK_COLOR: Record<string, string> = {
  low: "text-profit", medium: "text-amber-400", high: "text-loss",
};
const STRATEGY_ICON: Record<string, string> = {
  intra_arb: "🔄", platt_calibration: "📐", contrarian_no: "🚫", flb_exploit: "🎯",
  endgame_sweep: "🏁", time_decay: "⏰", spread_capture: "💰", momentum_live: "⚡",
  order_flow: "📊", market_making: "🏦",
};

function StrategyCard({
  strategy, signalCount, onToggle, isPending,
}: {
  strategy: StrategyConfig; signalCount: number; onToggle: () => void; isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className={`transition-all border-border/50 ${strategy.enabled ? "hover:border-border" : "opacity-60"}`} data-testid={`strategy-card-${strategy.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="text-xl shrink-0 pt-0.5">{STRATEGY_ICON[strategy.id] || "⚡"}</div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] mono text-muted-foreground/60">#{strategy.priority}</span>
                <h3 className="text-sm font-semibold truncate">{strategy.name}</h3>
                {signalCount > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 border-profit/30 text-profit shrink-0">
                    {signalCount} signal{signalCount > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <Switch
                checked={strategy.enabled}
                onCheckedChange={onToggle}
                disabled={isPending}
                data-testid={`toggle-strategy-${strategy.id}`}
              />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{strategy.description}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className={`text-[10px] px-1.5 border ${COMPLEXITY_COLOR[strategy.complexity]}`}>
                {strategy.complexity}
              </Badge>
              <Badge variant="outline" className={`text-[10px] px-1.5 border ${DURABILITY_COLOR[strategy.edgeDurability]}`}>
                Edge: {strategy.edgeDurability}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 border border-muted-foreground/30 text-muted-foreground">
                {strategy.minCapital}
              </Badge>
              <Badge variant="outline" className={`text-[10px] px-1.5 border border-current ${RISK_COLOR[strategy.riskLevel]}`}>
                <Shield className="w-2.5 h-2.5 mr-0.5" />
                {strategy.riskLevel} risk
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function StrategiesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<StrategyState>({
    queryKey: ["/api/strategies/state"],
    refetchInterval: 10_000,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await apiRequest("POST", `/api/strategies/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies/state"] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/strategies/scan");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies/state"] });
      toast({ title: "Scan complete", description: `Found ${data?.totalSignals ?? 0} signals` });
    },
  });

  const strategies = data?.strategies || [];
  const signals = data?.signals || [];
  const signalCounts: Record<string, number> = {};
  for (const s of signals) { signalCounts[s.strategyId] = (signalCounts[s.strategyId] || 0) + 1; }

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-US", { hour12: false }) : null;

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/10">
            <Sparkles className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Strategy Dashboard</h1>
            <p className="text-xs text-muted-foreground">10 autonomous strategies. Toggle on/off, monitor signals, control execution.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lastUpdated && <span className="text-[10px] text-muted-foreground/60">Updated {lastUpdated}</span>}
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending || isFetching} data-testid="button-scan-strategies">
            <RefreshCw className={`w-3 h-3 ${scanMutation.isPending ? "animate-spin" : ""}`} />
            Scan Now
          </Button>
        </div>
      </div>

      {/* Stats */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : (
        <div className="grid grid-cols-3 gap-3" data-testid="strategy-stats">
          <Card><CardContent className="p-3 text-center">
            <div className="text-xl font-bold mono text-foreground">{data?.activeStrategyCount ?? 0}<span className="text-muted-foreground text-sm">/{strategies.length}</span></div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Active</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className="text-xl font-bold mono text-profit">{data?.totalSignals ?? 0}</div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Signals</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className="text-xl font-bold mono text-blue-400">{data?.lastScan ? `${Math.round((Date.now() - new Date(data.lastScan).getTime()) / 1000)}s` : "—"}</div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Last Scan</div>
          </CardContent></Card>
        </div>
      )}

      {/* Strategy Cards */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium">Strategies</h2>
        </div>
        {isLoading ? (
          <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}</div>
        ) : (
          <div className="space-y-2">
            {strategies.sort((a, b) => a.priority - b.priority).map(s => (
              <StrategyCard
                key={s.id}
                strategy={s}
                signalCount={signalCounts[s.id] || 0}
                onToggle={() => toggleMutation.mutate({ id: s.id, enabled: !s.enabled })}
                isPending={toggleMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Live Signals Table */}
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Live Signals</CardTitle>
          <span className="ml-auto text-[10px] text-muted-foreground">{signals.length} signals</span>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {signals.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <div className="text-sm">No signals yet</div>
              <div className="text-xs mt-1">Click "Scan Now" or wait for the next automatic scan</div>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {signals.map(sig => (
                <div key={sig.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-border/30 hover:border-border/60 transition-colors text-xs" data-testid={`signal-${sig.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{sig.strategyName}</span>
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${sig.action.includes("BUY_YES") ? "border-profit/40 text-profit" : sig.action.includes("BUY_NO") ? "border-blue-500/40 text-blue-400" : sig.action.includes("SELL") ? "border-loss/40 text-loss" : "border-muted-foreground/40 text-muted-foreground"}`}>
                        {sig.action.replace("_", " ")}
                      </Badge>
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${sig.urgency === "immediate" ? "border-loss/40 text-loss" : sig.urgency === "limit" ? "border-amber-500/40 text-amber-400" : "border-muted-foreground/40 text-muted-foreground"}`}>
                        {sig.urgency}
                      </Badge>
                    </div>
                    <div className="text-foreground mt-0.5 truncate">{sig.title}</div>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className={`mono font-semibold ${sig.edge >= 0 ? "text-profit" : "text-loss"}`}>
                      {sig.edge >= 0 ? "+" : ""}{sig.edge.toFixed(1)}%
                    </div>
                    <div className="text-[9px] text-muted-foreground mono">${sig.expectedProfit.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
