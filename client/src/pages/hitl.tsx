import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  TrendingUp, TrendingDown, Target, Shield, DollarSign, CheckCircle2,
  AlertTriangle, Zap, User, Clock, ChevronDown, X, Edit3, Activity,
  Cloud, BarChart3, Layers
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type PendingTrade = {
  id: number;
  ticker: string;
  title: string;
  side: string;
  action: string;
  contracts: number;
  priceCents: number;
  estimatedCost: number;
  maxProfit: number;
  edgeScore: number;
  trueProbability: number;
  marketPrice: number;
  modelConfidence: number;
  modelName: string;
  edgeSource: string;
  reasoning: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  orderId: string | null;
  errorMessage: string | null;
};

type SettingsData = { hasPrivateKey: boolean };

// ── Helper functions ──────────────────────────────────────────────────────────

function getEdgeSourceInfo(edgeSource: string): { label: string; color: string; icon: typeof BarChart3 } {
  switch (edgeSource) {
    case "favorite_longshot_bias":
      return { label: "Longshot Bias", color: "bg-orange-500/20 text-orange-400 border-orange-500/30", icon: TrendingDown };
    case "yes_no_asymmetry":
      return { label: "YES/NO Asymmetry", color: "bg-purple-500/20 text-purple-400 border-purple-500/30", icon: Activity };
    case "weather_model":
      return { label: "Weather GFS", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30", icon: Cloud };
    case "market_maker_spread":
      return { label: "Spread Structure", color: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: Layers };
    default:
      return { label: edgeSource, color: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: BarChart3 };
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "pending":
    case "modified":
      return <Badge variant="outline" className="text-amber-400 border-amber-500/40 text-[10px]">Pending</Badge>;
    case "executed":
      return <Badge variant="outline" className="text-profit border-profit/40 text-[10px]">Executed</Badge>;
    case "approved":
      return <Badge variant="outline" className="text-blue-400 border-blue-500/40 text-[10px]">Approved</Badge>;
    case "rejected":
      return <Badge variant="outline" className="text-loss border-loss/40 text-[10px]">Rejected</Badge>;
    case "failed":
      return <Badge variant="outline" className="text-red-400 border-red-500/40 text-[10px]">Failed</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  }
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  const hrs = Math.floor(mins / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Trade Card (Pending) ──────────────────────────────────────────────────────

function PendingTradeCard({ trade, hasPrivateKey }: { trade: PendingTrade; hasPrivateKey: boolean }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showModify, setShowModify] = useState(false);
  const [modContracts, setModContracts] = useState(trade.contracts);
  const [modPriceCents, setModPriceCents] = useState(trade.priceCents);
  const { toast } = useToast();

  const edgeSourceInfo = getEdgeSourceInfo(trade.edgeSource);
  const EdgeIcon = edgeSourceInfo.icon;
  const isYes = trade.side === "yes";

  const modCost = ((modContracts * modPriceCents) / 100).toFixed(2);
  const modProfit = ((modContracts * (100 - modPriceCents)) / 100).toFixed(2);

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/pending-trades/${trade.id}/approve`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-trades"] });
      if (data?.success) {
        toast({ title: "Order Placed", description: `Order ID: ${data.orderId}` });
      } else {
        toast({ title: "Trade Approved", description: "Status updated." });
      }
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-trades"] });
      toast({
        title: "Execution Failed",
        description: err?.message || "Could not place order",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/pending-trades/${trade.id}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-trades"] });
      toast({ title: "Trade Rejected", description: `${trade.ticker} moved to history.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message, variant: "destructive" });
    },
  });

  const modifyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/pending-trades/${trade.id}/modify`, {
        contracts: modContracts,
        priceCents: modPriceCents,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-trades"] });
      setShowModify(false);
      toast({ title: "Trade Modified", description: `Updated to ${modContracts} contracts @ ${modPriceCents}¢` });
    },
    onError: (err: any) => {
      toast({ title: "Modify Failed", description: err?.message, variant: "destructive" });
    },
  });

  const modifyAndApproveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/pending-trades/${trade.id}/modify`, {
        contracts: modContracts,
        priceCents: modPriceCents,
      });
      const res = await apiRequest("POST", `/api/pending-trades/${trade.id}/approve`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-trades"] });
      setShowModify(false);
      toast({ title: "Modified & Submitted", description: data?.orderId ? `Order: ${data.orderId}` : "Trade queued." });
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-trades"] });
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    },
  });

  const isPending = approveMutation.isPending || rejectMutation.isPending || modifyMutation.isPending || modifyAndApproveMutation.isPending;

  return (
    <Card
      className="transition-all border-border/60 hover:border-border"
      data-testid={`hitl-card-${trade.id}`}
    >
      <CardContent className="p-5 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${isYes ? "bg-profit/10" : "bg-loss/10"}`}>
              {isYes ? (
                <TrendingUp className="w-4.5 h-4.5 text-profit" />
              ) : (
                <TrendingDown className="w-4.5 h-4.5 text-loss" />
              )}
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold leading-tight truncate max-w-xs">{trade.title || trade.ticker}</h3>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 border shrink-0 ${isYes ? "border-profit/40 text-profit" : "border-loss/40 text-loss"}`}
                >
                  {isYes ? "BUY YES" : "BUY NO"}
                </Badge>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={`text-[10px] px-1.5 border ${edgeSourceInfo.color}`}>
                  <EdgeIcon className="w-2.5 h-2.5 mr-1" />
                  {edgeSourceInfo.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground mono">{trade.ticker}</span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="w-2.5 h-2.5" />
                  {timeAgo(trade.createdAt)}
                </span>
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-lg font-bold mono ${isYes ? "text-profit" : "text-loss"}`}>
              {trade.edgeScore > 0 ? "+" : ""}{trade.edgeScore.toFixed(1)}%
            </div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Edge</div>
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-muted/30 rounded-md p-2 text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">True Prob</div>
            <div className="mono text-xs font-semibold">{(trade.trueProbability * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-muted/30 rounded-md p-2 text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Market</div>
            <div className="mono text-xs">{trade.priceCents}¢</div>
          </div>
          <div className="bg-muted/30 rounded-md p-2 text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Confidence</div>
            <div className={`mono text-xs font-semibold ${trade.modelConfidence >= 0.8 ? "text-profit" : ""}`}>
              {(trade.modelConfidence * 100).toFixed(0)}%
            </div>
          </div>
          <div className="bg-muted/30 rounded-md p-2 text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Model</div>
            <div className="text-[10px] truncate" title={trade.modelName}>{trade.modelName.split("-")[0]}</div>
          </div>
        </div>

        {/* Reasoning */}
        <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-primary mb-1.5">
            <Target className="w-3 h-3" />
            Why this trade
          </div>
          <p className="text-xs text-foreground/80 leading-relaxed">{trade.reasoning}</p>
        </div>

        {/* Cost summary */}
        <div className="flex items-center justify-between text-xs bg-muted/30 rounded-md px-3 py-2">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-muted-foreground">Contracts: </span>
              <span className="mono font-semibold">{trade.contracts}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Cost: </span>
              <span className="mono font-semibold">${trade.estimatedCost.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Max Profit: </span>
              <span className="mono font-semibold text-profit">${trade.maxProfit.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Modify panel */}
        {showModify && (
          <div className="border border-blue-500/20 bg-blue-500/5 rounded-lg p-4 space-y-3">
            <div className="text-xs font-medium text-blue-400">Modify Trade Parameters</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Contracts</span>
                <span className="mono font-medium">{modContracts}</span>
              </div>
              <div className="flex items-center gap-2">
                <Slider
                  data-testid={`slider-modify-contracts-${trade.id}`}
                  value={[modContracts]}
                  onValueChange={([v]) => setModContracts(v)}
                  min={1}
                  max={500}
                  step={1}
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={modContracts}
                  onChange={e => setModContracts(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-7 w-16 text-xs mono text-center"
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Price (cents)</span>
                <span className="mono font-medium">{modPriceCents}¢</span>
              </div>
              <div className="flex items-center gap-2">
                <Slider
                  data-testid={`slider-modify-price-${trade.id}`}
                  value={[modPriceCents]}
                  onValueChange={([v]) => setModPriceCents(v)}
                  min={1}
                  max={99}
                  step={1}
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={modPriceCents}
                  onChange={e => setModPriceCents(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))}
                  className="h-7 w-16 text-xs mono text-center"
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5">
              Updated: <span className="mono font-medium">{modContracts} contracts × {modPriceCents}¢</span>
              {" = "}
              <span className="mono font-semibold">${modCost}</span>
              {" · Max profit: "}
              <span className="mono font-semibold text-profit">${modProfit}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs border-blue-500/30 text-blue-400"
                onClick={() => modifyMutation.mutate()}
                disabled={isPending}
                data-testid={`button-save-modify-${trade.id}`}
              >
                Save (keep pending)
              </Button>
              <Button
                size="sm"
                className="flex-1 text-xs bg-profit hover:bg-profit/90 text-black"
                onClick={() => modifyAndApproveMutation.mutate()}
                disabled={isPending || !hasPrivateKey}
                data-testid={`button-modify-approve-${trade.id}`}
              >
                <Zap className="w-3 h-3 mr-1" />
                Save & Approve
              </Button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-3 gap-2">
          <Button
            data-testid={`button-approve-${trade.id}`}
            className="h-9 text-xs font-semibold bg-profit hover:bg-profit/90 text-black"
            onClick={() => setShowConfirm(true)}
            disabled={isPending}
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
            Approve
          </Button>
          <Button
            data-testid={`button-modify-${trade.id}`}
            variant="outline"
            className="h-9 text-xs font-semibold border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
            onClick={() => setShowModify(v => !v)}
            disabled={isPending}
          >
            <Edit3 className="w-3.5 h-3.5 mr-1.5" />
            {showModify ? "Cancel" : "Modify"}
          </Button>
          <Button
            data-testid={`button-reject-${trade.id}`}
            variant="outline"
            className="h-9 text-xs font-semibold border-loss/40 text-loss hover:bg-loss/10"
            onClick={() => rejectMutation.mutate()}
            disabled={isPending}
          >
            <X className="w-3.5 h-3.5 mr-1.5" />
            Reject
          </Button>
        </div>

        {!hasPrivateKey && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
            <AlertTriangle className="w-3 h-3" />
            No API key — approval will fail. Configure in Settings.
          </div>
        )}
      </CardContent>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-card border-border max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">
              Confirm Trade: {isYes ? "BUY YES" : "BUY NO"} — {trade.ticker}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div className="bg-muted/30 rounded-md p-3 space-y-1.5 text-xs">
                  <div><span className="text-muted-foreground">Event: </span><span className="font-medium">{trade.title || trade.ticker}</span></div>
                  <div><span className="text-muted-foreground">Action: </span>
                    <span className={`font-medium ${isYes ? "text-profit" : "text-loss"}`}>{isYes ? "BUY YES" : "BUY NO"}</span>
                  </div>
                  <div><span className="text-muted-foreground">Contracts: </span><span className="mono font-medium">{trade.contracts}</span></div>
                  <div><span className="text-muted-foreground">Price: </span><span className="mono font-medium">{trade.priceCents}¢</span></div>
                  <div><span className="text-muted-foreground">Cost: </span><span className="mono font-semibold">${trade.estimatedCost.toFixed(2)}</span></div>
                  <div><span className="text-muted-foreground">Max Profit: </span><span className="mono font-semibold text-profit">${trade.maxProfit.toFixed(2)}</span></div>
                  <div><span className="text-muted-foreground">Edge: </span><span className="mono font-semibold">{trade.edgeScore.toFixed(1)}%</span></div>
                  <div><span className="text-muted-foreground">Confidence: </span><span className="mono font-semibold">{(trade.modelConfidence * 100).toFixed(0)}%</span></div>
                  <div><span className="text-muted-foreground">Order Type: </span><span className="font-medium">Limit (Post-Only)</span></div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  This will place a real limit order (post-only) on Kalshi using your RSA credentials. Post-only orders qualify for the 0.05% maker rebate.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm" className="text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-trade"
              className={`text-xs ${isYes ? "bg-profit hover:bg-profit/90 text-black" : "bg-loss hover:bg-loss/90 text-white"}`}
              onClick={() => {
                setShowConfirm(false);
                approveMutation.mutate();
              }}
            >
              <Zap className="w-3 h-3 mr-1.5" />
              Confirm & Execute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── Decided Trade Row ─────────────────────────────────────────────────────────

function DecidedTradeRow({ trade }: { trade: PendingTrade }) {
  const isYes = trade.side === "yes";
  const edgeSourceInfo = getEdgeSourceInfo(trade.edgeSource);

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border border-border/40 hover:border-border/60 transition-colors text-xs"
      data-testid={`decided-row-${trade.id}`}
    >
      <div className={`flex items-center justify-center w-7 h-7 rounded shrink-0 ${
        trade.status === "executed" ? "bg-profit/10" :
        trade.status === "rejected" ? "bg-loss/10" :
        trade.status === "failed" ? "bg-red-500/10" : "bg-muted/30"
      }`}>
        {trade.status === "executed" ? <CheckCircle2 className="w-3.5 h-3.5 text-profit" /> :
         trade.status === "rejected" ? <X className="w-3.5 h-3.5 text-loss" /> :
         trade.status === "failed" ? <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> :
         <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{trade.title || trade.ticker}</span>
          {getStatusBadge(trade.status)}
        </div>
        <div className="flex items-center gap-3 text-muted-foreground mt-0.5">
          <span>{isYes ? "BUY YES" : "BUY NO"} · {trade.contracts} contracts @ {trade.priceCents}¢</span>
          {trade.orderId && <span className="mono text-[10px]">#{trade.orderId.slice(0, 8)}</span>}
          {trade.errorMessage && <span className="text-red-400 truncate max-w-xs">{trade.errorMessage}</span>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`mono font-semibold ${isYes ? "text-profit" : "text-loss"}`}>
          {trade.edgeScore > 0 ? "+" : ""}{trade.edgeScore.toFixed(1)}%
        </div>
        <div className="text-muted-foreground text-[10px]">
          {trade.decidedAt || trade.executedAt ? timeAgo(trade.decidedAt || trade.executedAt || trade.createdAt) : timeAgo(trade.createdAt)}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HumanInTheLoop() {
  const [recentOpen, setRecentOpen] = useState(false);

  const { data: trades = [], isLoading } = useQuery<PendingTrade[]>({
    queryKey: ["/api/pending-trades"],
    refetchInterval: 5000,
  });

  const { data: settingsData } = useQuery<SettingsData>({
    queryKey: ["/api/settings"],
  });

  const hasPrivateKey = settingsData?.hasPrivateKey ?? false;

  const pendingTrades = trades.filter(t => t.status === "pending" || t.status === "modified");
  const decidedTrades = trades.filter(t => !["pending", "modified"].includes(t.status));

  // Stats
  const today = new Date().toISOString().slice(0, 10);
  const approvedToday = decidedTrades.filter(t =>
    (t.status === "executed" || t.status === "approved") &&
    (t.decidedAt || t.executedAt || "").startsWith(today)
  ).length;
  const rejectedToday = decidedTrades.filter(t =>
    t.status === "rejected" &&
    (t.decidedAt || "").startsWith(today)
  ).length;
  const executedValue = decidedTrades
    .filter(t => t.status === "executed")
    .reduce((sum, t) => sum + t.estimatedCost, 0);

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
          <User className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Human in the Loop</h1>
          <p className="text-xs text-muted-foreground">
            The bot finds trades. You approve them. Signals refresh every 60s.
          </p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold mono text-amber-400">{pendingTrades.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Pending</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold mono text-profit">{approvedToday}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Approved Today</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold mono text-loss">{rejectedToday}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Rejected Today</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold mono text-blue-400">${executedValue.toFixed(0)}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Executed Value</div>
          </CardContent>
        </Card>
      </div>

      {/* API Key warning */}
      {!hasPrivateKey && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Configure your RSA private key in{" "}
            <a href="#/settings" className="underline font-medium">Settings</a>{" "}
            to execute trades. You can review and queue signals without it.
          </span>
        </div>
      )}

      {/* Pending Trades Section */}
      <div className="space-y-1">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-medium text-foreground">
            Pending Approval
            {pendingTrades.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                {pendingTrades.length}
              </span>
            )}
          </h2>
          <span className="text-[10px] text-muted-foreground">Bot scans every 60s</span>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-64 rounded-lg" />)}
          </div>
        ) : pendingTrades.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-muted-foreground">
              <Shield className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <div className="text-sm font-medium mb-1">No pending trades</div>
              <div className="text-xs max-w-xs mx-auto">
                The bot scans live Kalshi markets every 60 seconds and will surface opportunities here when edge exceeds your thresholds.
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pendingTrades.map(trade => (
              <PendingTradeCard key={trade.id} trade={trade} hasPrivateKey={hasPrivateKey} />
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      {decidedTrades.length > 0 && (
        <Collapsible open={recentOpen} onOpenChange={setRecentOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full flex items-center justify-between h-9 px-3 text-xs text-muted-foreground hover:text-foreground border border-border/40 rounded-lg"
              data-testid="button-recent-activity"
            >
              <span className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5" />
                Recent Activity ({decidedTrades.length})
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${recentOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-2 mt-2">
              {decidedTrades.slice(0, 20).map(trade => (
                <DecidedTradeRow key={trade.id} trade={trade} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Footer */}
      <div className="text-[10px] text-muted-foreground/50 text-center pt-2">
        Signals are model-generated estimates. Trading on Kalshi involves risk of loss. CFTC-regulated.
      </div>
    </div>
  );
}
