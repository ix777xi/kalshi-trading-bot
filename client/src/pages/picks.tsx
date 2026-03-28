import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Trophy, Flame, CalendarDays, TrendingUp, TrendingDown, Cloud,
  BarChart3, Thermometer, Target, DollarSign, Shield, CheckCircle2,
  ChevronDown, Zap, AlertTriangle, RefreshCw, Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type Pick = {
  id: string;
  ticker: string;
  title: string;
  eventTicker: string;
  category: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  contracts: number;
  priceCents: number;
  estimatedCost: number;
  maxProfit: number;
  executableEdge: number;
  confidence: number;
  edgeScore: number;
  gapType: string;
  riskLevel: string;
  pickScore: number;
  reasoning: string;
  tag: string;
  closeTime: string;
};

type PicksData = {
  picks: Pick[];
  stats: {
    count: number;
    avgConfidence: number;
    avgEdge: number;
    totalCost: number;
    totalMaxProfit: number;
    generatedAt: string;
  };
};

type ApproveResult = {
  approved: number;
  executed: number;
  failed: number;
  details: { ticker: string; status: string; orderId?: string; error?: string; message?: string }[];
};

type SettingsData = { hasPrivateKey: boolean };

// ── Helper functions ───────────────────────────────────────────────────────────

function getCategoryIcon(category: string) {
  switch (category) {
    case "NBA Game": return "🏀";
    case "NYC Weather": return "🌡️";
    case "S&P 500": return "📈";
    case "Fed Rate": return "🏦";
    case "CPI": return "📊";
    case "GDP": return "📉";
    default: return "📌";
  }
}

function CategoryIconComponent({ category }: { category: string }) {
  switch (category) {
    case "NBA Game":
      return (
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-orange-500/10 shrink-0">
          <span className="text-base">🏀</span>
        </div>
      );
    case "NYC Weather":
      return (
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-cyan-500/10 shrink-0">
          <Thermometer className="w-4.5 h-4.5 text-cyan-400" />
        </div>
      );
    case "S&P 500":
      return (
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500/10 shrink-0">
          <BarChart3 className="w-4.5 h-4.5 text-emerald-400" />
        </div>
      );
    default:
      return (
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
          <TrendingUp className="w-4.5 h-4.5 text-primary" />
        </div>
      );
  }
}

function getRiskColor(riskLevel: string) {
  switch (riskLevel) {
    case "low": return "bg-profit/15 text-profit border-profit/30";
    case "medium": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "high": return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "critical": return "bg-red-500/15 text-red-400 border-red-500/30";
    default: return "bg-muted/30 text-muted-foreground border-border/40";
  }
}

function getGapColor(gapType: string) {
  switch (gapType) {
    case "A": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "B": return "bg-purple-500/15 text-purple-400 border-purple-500/30";
    case "C": return "bg-teal-500/15 text-teal-400 border-teal-500/30";
    case "D": return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "E": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    default: return "bg-muted/30 text-muted-foreground border-border/40";
  }
}

function hoursUntil(closeTime: string): string {
  if (!closeTime) return "";
  const diff = new Date(closeTime).getTime() - Date.now();
  const hrs = diff / 3_600_000;
  if (hrs < 1) return `${Math.round(hrs * 60)}m`;
  if (hrs < 24) return `${hrs.toFixed(0)}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ── Pick Card ──────────────────────────────────────────────────────────────────

function PickCard({
  pick,
  selected,
  onToggle,
  executed,
  executedDetail,
}: {
  pick: Pick;
  selected: boolean;
  onToggle: () => void;
  executed: boolean;
  executedDetail?: ApproveResult["details"][0];
}) {
  const [expanded, setExpanded] = useState(false);
  const isYes = pick.side === "yes";

  return (
    <Card
      className={`transition-all border-border/50 hover:border-border ${
        executed
          ? "border-profit/40 bg-profit/5"
          : selected
          ? "border-primary/40 bg-primary/3"
          : ""
      }`}
      data-testid={`pick-card-${pick.ticker}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Checkbox */}
          <div className="flex items-center pt-0.5 shrink-0">
            {executed ? (
              <CheckCircle2 className="w-5 h-5 text-profit" data-testid={`pick-executed-${pick.ticker}`} />
            ) : (
              <Checkbox
                id={`pick-${pick.id}`}
                checked={selected}
                onCheckedChange={onToggle}
                data-testid={`checkbox-pick-${pick.ticker}`}
                className="border-border/60"
              />
            )}
          </div>

          {/* Category icon */}
          <CategoryIconComponent category={pick.category} />

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Title row */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold leading-tight">
                    {pick.title}
                  </h3>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 border shrink-0 ${isYes ? "border-profit/40 text-profit" : "border-loss/40 text-loss"}`}
                  >
                    {isYes ? "BUY YES" : "BUY NO"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {pick.tag}
                </p>
              </div>

              {/* Edge score */}
              <div className="text-right shrink-0">
                <div className={`text-base font-bold mono ${isYes ? "text-profit" : "text-loss"}`}>
                  {pick.executableEdge > 0 ? "+" : ""}{(pick.executableEdge * 100).toFixed(1)}%
                </div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Edge</div>
              </div>
            </div>

            {/* Badges row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className={`text-[10px] px-1.5 border ${getGapColor(pick.gapType)}`}>
                Type {pick.gapType}
              </Badge>
              <Badge variant="outline" className={`text-[10px] px-1.5 border capitalize ${getRiskColor(pick.riskLevel)}`}>
                <Shield className="w-2.5 h-2.5 mr-0.5" />
                {pick.riskLevel}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 border border-blue-500/30 text-blue-400">
                {(pick.confidence * 100).toFixed(0)}% confidence
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 border border-muted-foreground/30 text-muted-foreground">
                {pick.category}
              </Badge>
              {pick.closeTime && (
                <Badge variant="outline" className="text-[10px] px-1.5 border border-amber-500/30 text-amber-400">
                  <Clock className="w-2.5 h-2.5 mr-0.5" />
                  closes in {hoursUntil(pick.closeTime)}
                </Badge>
              )}
            </div>

            {/* Trade summary */}
            <div className="flex items-center gap-4 text-xs bg-muted/20 rounded-md px-3 py-2">
              <div>
                <span className="text-muted-foreground">Contracts: </span>
                <span className="mono font-semibold">{pick.contracts}</span>
              </div>
              <div>
                <span className="text-muted-foreground">× </span>
                <span className="mono font-semibold">{pick.priceCents}¢</span>
              </div>
              <div>
                <span className="text-muted-foreground">= </span>
                <span className="mono font-semibold">${pick.estimatedCost.toFixed(2)}</span>
              </div>
              <div className="ml-auto">
                <span className="text-muted-foreground">Max profit: </span>
                <span className="mono font-semibold text-profit">${pick.maxProfit.toFixed(2)}</span>
              </div>
            </div>

            {/* Execution result */}
            {executed && executedDetail && (
              <div className="flex items-center gap-2 text-xs text-profit bg-profit/10 rounded-md px-3 py-1.5">
                <CheckCircle2 className="w-3 h-3" />
                {executedDetail.orderId
                  ? `Order placed — ID: ${executedDetail.orderId.slice(0, 12)}...`
                  : executedDetail.message || "Queued for execution"
                }
              </div>
            )}

            {/* Expandable reasoning */}
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <CollapsibleTrigger asChild>
                <button
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`button-expand-${pick.ticker}`}
                >
                  <Target className="w-3 h-3" />
                  Why this pick
                  <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 bg-muted/20 rounded-lg p-3 border border-border/40">
                  <p className="text-xs text-foreground/80 leading-relaxed">{pick.reasoning}</p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Stats Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <div className="text-xl font-bold mono text-foreground">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
        <div className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function TodaysPicks() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [executionResult, setExecutionResult] = useState<ApproveResult | null>(null);
  const [executedTickers, setExecutedTickers] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // Auto-refresh every 60 seconds
  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<PicksData>({
    queryKey: ["/api/todays-picks"],
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  const { data: settingsData } = useQuery<SettingsData>({
    queryKey: ["/api/settings"],
  });

  const hasPrivateKey = settingsData?.hasPrivateKey ?? false;

  const picks = data?.picks || [];
  const stats = data?.stats;

  // Auto-select all on first load
  useEffect(() => {
    if (picks.length > 0 && selectedIds.size === 0) {
      setSelectedIds(new Set(picks.map(p => p.id)));
    }
  }, [picks.length]);

  const selectedPicks = picks.filter(p => selectedIds.has(p.id));
  const totalSelectedCost = selectedPicks.reduce((s, p) => s + p.estimatedCost, 0);
  const totalSelectedProfit = selectedPicks.reduce((s, p) => s + p.maxProfit, 0);

  const toggleAll = () => {
    if (selectedIds.size === picks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(picks.map(p => p.id)));
    }
  };

  const togglePick = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "./api/todays-picks/approve-all", {
        picks: selectedPicks,
      });
      return res.json() as Promise<ApproveResult>;
    },
    onSuccess: (result) => {
      setExecutionResult(result);
      const executedTickerSet = new Set(
        result.details.filter(d => d.status === "executed" || d.status === "approved").map(d => d.ticker)
      );
      setExecutedTickers(executedTickerSet);
      queryClient.invalidateQueries({ queryKey: ["/api/pending-trades"] });

      const msg = result.executed > 0
        ? `${result.executed} trade${result.executed > 1 ? "s" : ""} executed on Kalshi.`
        : `${result.approved} trade${result.approved > 1 ? "s" : ""} queued — check Human in the Loop.`;

      toast({
        title: `Done — ${result.approved} picks approved`,
        description: msg,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Execution Failed",
        description: err?.message || "Could not process picks",
        variant: "destructive",
      });
    },
  });

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-US", { hour12: false }) : null;

  return (
    <div className="p-4 space-y-4 pb-32">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-500/10">
            <Trophy className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Today's Picks</h1>
            <p className="text-xs text-muted-foreground">
              Low-risk opportunities from today's live events. Review and approve all at once.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground/60">
              Updated {lastUpdated}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1.5"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-picks"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      {isLoading ? (
        <div className="grid grid-cols-5 gap-3">
          {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-5 gap-3" data-testid="picks-stats-row">
          <StatCard label="Available Picks" value={String(stats.count)} />
          <StatCard
            label="Avg Confidence"
            value={`${(stats.avgConfidence * 100).toFixed(0)}%`}
          />
          <StatCard
            label="Avg Edge"
            value={`${(stats.avgEdge * 100).toFixed(1)}%`}
          />
          <StatCard
            label="Est. Total Cost"
            value={`$${stats.totalCost.toFixed(0)}`}
          />
          <StatCard
            label="Est. Max Profit"
            value={`$${stats.totalMaxProfit.toFixed(0)}`}
          />
        </div>
      ) : null}

      {/* API key warning */}
      {!hasPrivateKey && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            No API key configured — picks will be queued but not auto-executed.{" "}
            <a href="#/settings" className="underline font-medium">Configure in Settings</a> to enable live trading.
          </span>
        </div>
      )}

      {/* Picks List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
        </div>
      ) : picks.length === 0 ? (
        <Card>
          <CardContent className="p-14 text-center text-muted-foreground" data-testid="picks-empty-state">
            <Trophy className="w-8 h-8 mx-auto mb-3 opacity-20" />
            <div className="text-sm font-medium mb-1">No picks for today yet</div>
            <div className="text-xs max-w-xs mx-auto leading-relaxed">
              The bot scans for opportunities every 60 seconds. Markets typically become active during business hours. NBA games usually show opportunities 1–2 hours before tip-off.
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 text-xs gap-1.5"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-empty"
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
              Scan Now
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Select all header */}
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              id="select-all"
              checked={selectedIds.size === picks.length && picks.length > 0}
              onCheckedChange={toggleAll}
              data-testid="checkbox-select-all"
              className="border-border/60"
            />
            <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer">
              Select all ({picks.length} picks)
            </label>
          </div>

          {/* Cards */}
          <div className="space-y-3">
            {picks.map(pick => (
              <PickCard
                key={pick.id}
                pick={pick}
                selected={selectedIds.has(pick.id)}
                onToggle={() => togglePick(pick.id)}
                executed={executedTickers.has(pick.ticker)}
                executedDetail={executionResult?.details.find(d => d.ticker === pick.ticker)}
              />
            ))}
          </div>
        </>
      )}

      {/* Success summary */}
      {executionResult && (
        <Card className="border-profit/30 bg-profit/5" data-testid="execution-result">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-profit mb-2">
              <CheckCircle2 className="w-4 h-4" />
              Done — {executionResult.approved} picks processed
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              {executionResult.executed > 0 && (
                <div>{executionResult.executed} trade{executionResult.executed > 1 ? "s" : ""} executed on Kalshi.</div>
              )}
              {executionResult.approved > executionResult.executed && (
                <div>{executionResult.approved - executionResult.executed} trade{executionResult.approved - executionResult.executed > 1 ? "s" : ""} queued — check{" "}
                  <a href="#/hitl" className="underline text-primary">Human in the Loop</a> for status.
                </div>
              )}
              {executionResult.failed > 0 && (
                <div className="text-red-400">{executionResult.failed} failed — check Orders for details.</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sticky bottom bar */}
      {picks.length > 0 && selectedIds.size > 0 && !executionResult && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur border-t border-border p-4"
          style={{ left: "var(--sidebar-width, 14rem)" }}
          data-testid="sticky-approve-bar"
        >
          <div className="flex items-center gap-4 max-w-4xl mx-auto">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                {selectedIds.size} pick{selectedIds.size > 1 ? "s" : ""} selected
              </div>
              <div className="text-xs text-muted-foreground mono">
                ${totalSelectedCost.toFixed(2)} cost · ${totalSelectedProfit.toFixed(2)} max profit
              </div>
            </div>
            <Button
              size="sm"
              className="bg-profit hover:bg-profit/90 text-black font-semibold px-5 h-10 gap-2 shrink-0"
              onClick={() => setShowConfirm(true)}
              disabled={approveMutation.isPending}
              data-testid="button-approve-all"
            >
              <Zap className="w-4 h-4" />
              Approve & Execute Selected
            </Button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-card border-border max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              Approve & Execute {selectedIds.size} Trades
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div className="bg-muted/30 rounded-md p-3 text-xs space-y-1.5">
                  <div>
                    <span className="text-muted-foreground">Picks selected: </span>
                    <span className="font-semibold">{selectedIds.size}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total cost: </span>
                    <span className="mono font-semibold">${totalSelectedCost.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Max profit: </span>
                    <span className="mono font-semibold text-profit">${totalSelectedProfit.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Order type: </span>
                    <span className="font-medium">Limit (Post-Only)</span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {hasPrivateKey
                    ? "You're about to execute these trades on Kalshi. The bot will place post-only limit orders for each, qualifying for the 0.05% maker rebate."
                    : "No API key configured — trades will be queued in Human in the Loop for manual review."
                  }
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="text-xs"
              data-testid="button-cancel-approve"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="text-xs bg-profit hover:bg-profit/90 text-black font-semibold"
              onClick={() => {
                setShowConfirm(false);
                approveMutation.mutate();
              }}
              data-testid="button-confirm-approve"
            >
              <Zap className="w-3 h-3 mr-1.5" />
              Execute All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
