import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Bot, Power, ShieldAlert, Activity, TrendingUp, TrendingDown,
  Clock, CheckCircle2, AlertTriangle, Zap, User, Cpu, Pause,
  RotateCcw, Radio, Settings, RefreshCw, Trophy
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type BotStatus = {
  mode: string;
  isHalted: boolean;
  uptime: string;
  uptimeMs: number;
  tradesToday: number;
  autoToday: number;
  dailyPnl: number;
  winRate: number;
  consecutiveFailures: number;
};

type PendingTrade = {
  id: number;
  ticker: string;
  title: string;
  side: string;
  action: string;
  contracts: number;
  priceCents: number;
  estimatedCost: number;
  edgeScore: number;
  modelConfidence: number;
  status: string;
  createdAt: string;
  executedAt: string | null;
  autoExecuted: boolean;
  gapType: string | null;
  executableEdge: number | null;
};

type BotConfig = {
  botMode: string;
  dailyLossLimit: number;
  maxDrawdownLimit: number;
  autonomousConfirmedAt: string | null;
};

type SettingsData = { hasPrivateKey: boolean };

// ── Sports Agent Types ────────────────────────────────────────────────────────

type SportConfigType = {
  id: string;
  name: string;
  enabled: boolean;
  kalshiSeries: string[];
  espnEndpoint: string;
  maxExposurePct: number;
  edgeThreshold: number;
  modelWeight: number;
};

type SportsSignalType = {
  id: string;
  sport: string;
  event: string;
  side: string;
  ticker: string;
  kalshiPrice: number;
  modelProbability: number;
  edge: number;
  action: string;
  kellyFraction: number;
  positionSizeUsd: number;
  reasoning: string;
  confidence: number;
  riskLevel: string;
  dataSource: string;
  createdAt: string;
  isLive: boolean;
  score?: string;
  period?: string;
  momentum?: string;
};

type SportsAgentStateType = {
  running: boolean;
  bankroll: number;
  dailyPnl: number;
  dailyPnlPct: number;
  tradesToday: number;
  openPositions: number;
  sportExposure: Record<string, number>;
  signals: SportsSignalType[];
  sports: SportConfigType[];
  lastScan: string;
  riskStatus: "normal" | "caution" | "halted";
};

const SPORT_EMOJI: Record<string, string> = {
  nba: "\u{1F3C0}", mlb: "\u26BE", nhl: "\u{1F3D2}", soccer: "\u26BD", nfl: "\u{1F3C8}",
  golf: "\u26F3", ufc: "\u{1F94A}", cbb: "\u{1F3C0}", tennis: "\u{1F3BE}", esports: "\u{1F3AE}",
};

// ── Mode Config ────────────────────────────────────────────────────────────────

const MODE_CONFIG = {
  hitl: {
    label: "HUMAN IN THE LOOP",
    shortLabel: "HITL",
    description: "Bot finds trades. You approve each one before execution. No automatic trading.",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    icon: User,
  },
  supervised: {
    label: "SUPERVISED AUTO",
    shortLabel: "SUPERVISED",
    description: "Bot auto-executes high-confidence trades (edge ≥ 8%, confidence ≥ 80%, cost ≤ $50). Others queue for approval.",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    icon: Cpu,
  },
  autonomous: {
    label: "FULL AUTONOMOUS",
    shortLabel: "AUTONOMOUS",
    description: "Bot executes ALL qualifying trades without human confirmation. Emergency halt always available.",
    color: "text-profit",
    bg: "bg-profit/10",
    border: "border-profit/30",
    icon: Bot,
  },
  halted: {
    label: "HALTED",
    shortLabel: "HALTED",
    description: "Emergency shutdown active. All trading is stopped. Manual restart required.",
    color: "text-loss",
    bg: "bg-loss/10",
    border: "border-loss/30",
    icon: ShieldAlert,
  },
};

const GAP_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  A: { label: "Stale Pricing", color: "text-cyan-400" },
  B: { label: "Thin Liquidity", color: "text-orange-400" },
  C: { label: "Cross-Platform", color: "text-purple-400" },
  D: { label: "Prob Distortion", color: "text-amber-400" },
  E: { label: "Event Catalyst", color: "text-green-400" },
};

// ── Activity Feed Entry ────────────────────────────────────────────────────────

function ActivityEntry({ trade }: { trade: PendingTrade }) {
  const isYes = trade.side === "yes";
  const isSell = trade.action === "sell";
  const gapInfo = trade.gapType ? GAP_TYPE_LABELS[trade.gapType] : null;

  const timeStr = trade.executedAt || trade.createdAt;
  const time = new Date(timeStr).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-lg border border-border/30 hover:border-border/60 transition-colors text-xs"
      data-testid={`activity-entry-${trade.id}`}
    >
      <div className={`flex items-center justify-center w-6 h-6 rounded shrink-0 ${
        trade.status === "executed" ? "bg-profit/10" :
        trade.status === "failed" ? "bg-loss/10" : "bg-muted/20"
      }`}>
        {trade.status === "executed" ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-profit" />
        ) : (
          <AlertTriangle className="w-3.5 h-3.5 text-loss" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium mono text-[11px]">{trade.ticker}</span>
          <Badge
            variant="outline"
            className={`text-[9px] px-1 py-0 h-4 ${isSell ? "border-yellow-500/40 text-yellow-400" : isYes ? "border-profit/40 text-profit" : "border-loss/40 text-loss"}`}
          >
            {isSell ? (isYes ? "SELL YES" : "SELL NO") : (isYes ? "BUY YES" : "BUY NO")}
          </Badge>
          {gapInfo && (
            <span className={`text-[9px] ${gapInfo.color}`}>Gap-{trade.gapType}</span>
          )}
          {trade.autoExecuted && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-primary/40 text-primary">
              AUTO
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-2">
          <span>{trade.contracts} contracts @ {trade.priceCents}¢</span>
          <span className="text-border">·</span>
          <span className={`mono font-medium ${trade.edgeScore >= 0 ? "text-profit" : "text-loss"}`}>
            {trade.edgeScore >= 0 ? "+" : ""}{trade.edgeScore.toFixed(1)}%
          </span>
          {trade.executableEdge != null && (
            <>
              <span className="text-border">·</span>
              <span className="mono text-muted-foreground">exec {(trade.executableEdge * 100).toFixed(1)}%</span>
            </>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="mono text-[10px] text-muted-foreground">{time}</div>
        <div className="mono text-[10px]">${trade.estimatedCost.toFixed(2)}</div>
      </div>
    </div>
  );
}

// ── Sports Agent Panel ────────────────────────────────────────────────────────

function SportsAgentPanel() {
  const { toast } = useToast();
  const [showConfig, setShowConfig] = useState(false);
  const [bankrollInput, setBankrollInput] = useState("");
  const [lossLimitInput, setLossLimitInput] = useState("");
  const [maxEventInput, setMaxEventInput] = useState("");

  const { data: agentState } = useQuery<SportsAgentStateType>({
    queryKey: ["/api/sports-agent/state"],
    refetchInterval: 5000,
  });

  const { data: sports = [] } = useQuery<SportConfigType[]>({
    queryKey: ["/api/sports-agent/sports"],
    refetchInterval: 10000,
  });

  const toggleSportMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiRequest("POST", `./api/sports-agent/sports/${id}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sports-agent/sports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sports-agent/state"] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => apiRequest("POST", "./api/sports-agent/scan", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sports-agent/state"] });
      toast({ title: "Scan complete", description: "Sports agent scan finished." });
    },
    onError: (e: any) => {
      toast({ title: "Scan failed", description: e?.message, variant: "destructive" });
    },
  });

  const configMutation = useMutation({
    mutationFn: (data: { bankroll?: number; dailyLossLimitPct?: number; maxPerEventPct?: number }) =>
      apiRequest("POST", "./api/sports-agent/config", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sports-agent/state"] });
      setShowConfig(false);
      toast({ title: "Config updated", description: "Sports agent configuration saved." });
    },
  });

  const executeMutation = useMutation({
    mutationFn: (signalId: string) =>
      apiRequest("POST", `./api/sports-agent/execute/${signalId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sports-agent/state"] });
      toast({ title: "Trade executed", description: "Signal executed successfully." });
    },
    onError: (e: any) => {
      toast({ title: "Execution failed", description: e?.message, variant: "destructive" });
    },
  });

  const st = agentState;
  const lastScanAgo = st?.lastScan
    ? `${Math.round((Date.now() - new Date(st.lastScan).getTime()) / 1000)}s ago`
    : "never";

  const riskColor = st?.riskStatus === "halted" ? "text-loss" : st?.riskStatus === "caution" ? "text-amber-400" : "text-profit";
  const dailyLossUsedPct = st ? Math.min(100, Math.abs(st.dailyPnlPct / 15) * 100) : 0;

  const signalsBySport = (sports ?? []).reduce<Record<string, number>>((acc, s) => {
    acc[s.id] = (st?.signals ?? []).filter(sig => sig.sport === s.id).length;
    return acc;
  }, {});

  return (
    <>
      <Card data-testid="sports-agent-card">
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <Trophy className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Sports Agent</CardTitle>
          <Badge
            variant="outline"
            data-testid="sports-agent-status"
            className={`ml-auto text-[9px] px-1.5 py-0 h-4 ${st?.running ? "border-profit/40 text-profit" : "border-muted text-muted-foreground"}`}
          >
            {st?.running ? "ON" : "OFF"}
          </Badge>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="mono text-sm font-bold" data-testid="sa-bankroll">${st?.bankroll?.toFixed(2) ?? "386.52"}</div>
              <div className="text-[9px] text-muted-foreground uppercase">Bankroll</div>
            </div>
            <div>
              <div className={`mono text-sm font-bold ${(st?.dailyPnl ?? 0) >= 0 ? "text-profit" : "text-loss"}`} data-testid="sa-daily-pnl">
                {(st?.dailyPnl ?? 0) >= 0 ? "+" : ""}${Math.abs(st?.dailyPnl ?? 0).toFixed(2)}
              </div>
              <div className="text-[9px] text-muted-foreground uppercase">Daily P&L</div>
            </div>
            <div>
              <div className={`text-sm font-bold ${riskColor}`} data-testid="sa-risk-status">
                {st?.riskStatus === "halted" ? "Halted" : st?.riskStatus === "caution" ? "Caution" : "Normal"}
              </div>
              <div className="text-[9px] text-muted-foreground uppercase">Risk</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[10px] text-muted-foreground">
            <div>Open: <span className="mono text-foreground">{st?.openPositions ?? 0}</span></div>
            <div>Trades: <span className="mono text-foreground">{st?.tradesToday ?? 0}</span></div>
            <div>Scan: <span className="mono text-foreground">{lastScanAgo}</span></div>
          </div>

          {/* Sport Controls */}
          <div className="space-y-1" data-testid="sport-controls">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Sport Controls</div>
            {(sports ?? []).map(sport => {
              const sigCount = signalsBySport[sport.id] ?? 0;
              const hasSignals = sigCount > 0 && sport.enabled;
              return (
                <div key={sport.id} className={`flex items-center gap-2 py-1 px-2 rounded ${!sport.enabled ? "opacity-50" : ""}`}>
                  <Switch
                    data-testid={`toggle-sport-${sport.id}`}
                    checked={sport.enabled}
                    onCheckedChange={(checked) => toggleSportMutation.mutate({ id: sport.id, enabled: checked })}
                    className="scale-75"
                  />
                  <span className="text-xs w-4">{SPORT_EMOJI[sport.id] ?? "\u{1F3C6}"}</span>
                  <span className="text-xs flex-1 truncate">{sport.name}</span>
                  <span className="text-[9px] text-muted-foreground mono">{sport.maxExposurePct}% max</span>
                  <span className="text-[9px] text-muted-foreground mono">{sport.edgeThreshold}% edge</span>
                  <div className={`w-2 h-2 rounded-full ${
                    !sport.enabled ? "bg-muted" : hasSignals ? "bg-profit" : "bg-muted-foreground/30"
                  }`} />
                  <span className="text-[9px] mono w-12 text-right">
                    {!sport.enabled ? "disabled" : `${sigCount} signal${sigCount !== 1 ? "s" : ""}`}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Live Signals */}
          {(st?.signals ?? []).length > 0 && (
            <div className="space-y-1" data-testid="live-signals">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Live Signals</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(st?.signals ?? []).slice(0, 10).map(sig => (
                  <div
                    key={sig.id}
                    className="flex items-center gap-2 p-2 rounded-lg border border-border/30 hover:border-border/60 text-xs"
                    data-testid={`signal-${sig.id}`}
                  >
                    <span className="w-4 text-center">{SPORT_EMOJI[sig.sport] ?? "\u{1F3C6}"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{sig.event}</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="mono">{sig.ticker}</span>
                        {sig.isLive && sig.score && <span className="text-amber-400">{sig.score}</span>}
                        {sig.isLive && sig.period && <span>{sig.period}</span>}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1 py-0 h-4 shrink-0 ${
                        sig.action === "NO_TRADE" ? "text-muted-foreground" :
                        sig.action.includes("YES") ? "border-profit/40 text-profit" :
                        "border-loss/40 text-loss"
                      }`}
                    >
                      {sig.action === "NO_TRADE" ? "HOLD" : sig.action.replace("_", " ")}
                    </Badge>
                    <span className={`mono text-[10px] shrink-0 ${sig.edge >= 0 ? "text-profit" : "text-loss"}`}>
                      {sig.edge >= 0 ? "+" : ""}{sig.edge.toFixed(1)}%
                    </span>
                    {sig.action !== "NO_TRADE" && sig.positionSizeUsd > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[9px]"
                        data-testid={`execute-signal-${sig.id}`}
                        onClick={() => executeMutation.mutate(sig.id)}
                        disabled={executeMutation.isPending}
                      >
                        <Zap className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risk Dashboard */}
          <div className="space-y-2" data-testid="risk-dashboard">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Risk Dashboard</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="w-24 text-muted-foreground">Daily Loss Used</span>
                <Progress value={dailyLossUsedPct} className="flex-1 h-2" />
                <span className="mono w-20 text-right">{Math.abs(st?.dailyPnlPct ?? 0).toFixed(1)}% / 15%</span>
              </div>
              {Object.entries(st?.sportExposure ?? {}).filter(([, v]) => v > 0).map(([sportId, amount]) => {
                const sport = (sports ?? []).find(s => s.id === sportId);
                const pct = st?.bankroll ? (amount / st.bankroll) * 100 : 0;
                const maxPct = sport?.maxExposurePct ?? 40;
                return (
                  <div key={sportId} className="flex items-center gap-2 text-[10px]">
                    <span className="w-24 text-muted-foreground truncate">{sport?.name ?? sportId}</span>
                    <Progress value={Math.min(100, (pct / maxPct) * 100)} className="flex-1 h-2" />
                    <span className="mono w-20 text-right">{pct.toFixed(0)}% / {maxPct}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              data-testid="button-sports-scan"
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${scanMutation.isPending ? "animate-spin" : ""}`} />
              {scanMutation.isPending ? "Scanning..." : "Scan Now"}
            </Button>
            <Button
              data-testid="button-sports-config"
              size="sm"
              variant="outline"
              onClick={() => {
                setBankrollInput(String(st?.bankroll ?? 386.52));
                setLossLimitInput("15");
                setMaxEventInput("5");
                setShowConfig(true);
              }}
            >
              <Settings className="w-3.5 h-3.5 mr-1.5" />
              Configure
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Config Dialog */}
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Sports Agent Configuration
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Bankroll ($)</Label>
              <Input
                data-testid="input-sa-bankroll"
                type="number"
                min={10}
                value={bankrollInput}
                onChange={e => setBankrollInput(e.target.value)}
                className="h-9 text-sm mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Daily Loss Limit (%)</Label>
              <Input
                data-testid="input-sa-loss-limit"
                type="number"
                min={1}
                max={50}
                value={lossLimitInput}
                onChange={e => setLossLimitInput(e.target.value)}
                className="h-9 text-sm mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Max Per Event (%)</Label>
              <Input
                data-testid="input-sa-max-event"
                type="number"
                min={1}
                max={25}
                value={maxEventInput}
                onChange={e => setMaxEventInput(e.target.value)}
                className="h-9 text-sm mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              data-testid="button-sa-save-config"
              onClick={() => configMutation.mutate({
                bankroll: parseFloat(bankrollInput) || undefined,
                dailyLossLimitPct: parseFloat(lossLimitInput) || undefined,
                maxPerEventPct: parseFloat(maxEventInput) || undefined,
              })}
              disabled={configMutation.isPending}
            >
              {configMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Mode Card ──────────────────────────────────────────────────────────────────

function ModeCard({
  modeKey,
  currentMode,
  onSelect,
  disabled,
}: {
  modeKey: "hitl" | "supervised" | "autonomous";
  currentMode: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const cfg = MODE_CONFIG[modeKey];
  const Icon = cfg.icon;
  const isActive = currentMode === modeKey;

  return (
    <button
      onClick={onSelect}
      disabled={disabled || isActive}
      data-testid={`mode-card-${modeKey}`}
      className={`text-left p-4 rounded-lg border transition-all w-full ${
        isActive
          ? `${cfg.bg} ${cfg.border} border`
          : "border-border/40 hover:border-border bg-muted/5 hover:bg-muted/10"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${isActive ? cfg.bg : "bg-muted/20"}`}>
          <Icon className={`w-4 h-4 ${isActive ? cfg.color : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${isActive ? cfg.color : "text-foreground"}`}>
              {cfg.shortLabel}
            </span>
            {isActive && (
              <Badge variant="outline" className={`text-[9px] px-1 ${cfg.color} ${cfg.border}`}>
                ACTIVE
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{cfg.description}</p>
        </div>
      </div>
    </button>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AutonomousPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // State for autonomous upgrade flow
  const [confirmText, setConfirmText] = useState("");
  const [dailyLossLimit, setDailyLossLimit] = useState(500);
  const [maxDrawdown, setMaxDrawdown] = useState(20);
  const [showHaltConfirm, setShowHaltConfirm] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [showSupervisedConfirm, setShowSupervisedConfirm] = useState(false);

  // Queries
  const { data: botStatus, isLoading: statusLoading } = useQuery<BotStatus>({
    queryKey: ["/api/bot/status"],
    refetchInterval: 5000,
  });

  const { data: botConfig } = useQuery<BotConfig>({
    queryKey: ["/api/bot/config"],
    refetchInterval: 10000,
  });

  const { data: settingsData } = useQuery<SettingsData>({
    queryKey: ["/api/settings"],
  });

  const { data: allTrades = [] } = useQuery<PendingTrade[]>({
    queryKey: ["/api/pending-trades"],
    refetchInterval: 5000,
  });

  // Last 20 auto-executed trades for the activity feed
  const autoTrades = allTrades
    .filter((t) => t.autoExecuted || t.status === "executed")
    .slice(0, 20);

  // Mode mutations
  const setModeMutation = useMutation({
    mutationFn: (data: { mode: string; confirmation?: string; dailyLossLimit?: number; maxDrawdownLimit?: number }) =>
      apiRequest("POST", "./api/bot/mode", data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot/config"] });
      toast({ title: `Mode set to ${vars.mode.toUpperCase()}`, description: "Bot mode updated." });
      setConfirmText("");
      setPendingMode(null);
    },
    onError: (e: any) => {
      toast({ title: "Mode change failed", description: e?.message || "Could not change mode", variant: "destructive" });
    },
  });

  const haltMutation = useMutation({
    mutationFn: () => apiRequest("POST", "./api/bot/emergency-halt", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot/config"] });
      toast({ title: "BOT HALTED", description: "Emergency shutdown triggered. All trading stopped.", variant: "destructive" });
      setShowHaltConfirm(false);
    },
    onError: (e: any) => {
      toast({ title: "Halt failed", description: e?.message || "Could not halt", variant: "destructive" });
      setShowHaltConfirm(false);
    },
  });

  const restartMutation = useMutation({
    mutationFn: () => apiRequest("POST", "./api/bot/restart", { confirmation: "RESTART BOT" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot/config"] });
      toast({ title: "Bot restarted", description: "Mode set to HITL. Bot is active." });
      setShowRestartConfirm(false);
    },
    onError: (e: any) => {
      toast({ title: "Restart failed", description: e?.message, variant: "destructive" });
      setShowRestartConfirm(false);
    },
  });

  const currentMode = botConfig?.botMode || botStatus?.mode || "hitl";
  const isHalted = currentMode === "halted";
  const modeCfg = MODE_CONFIG[currentMode as keyof typeof MODE_CONFIG] || MODE_CONFIG.hitl;
  const ModeIcon = modeCfg.icon;

  const canEnableAutonomous =
    confirmText === "I CONFIRM AUTONOMOUS MODE" &&
    settingsData?.hasPrivateKey === true;

  const handleModeSelect = (mode: string) => {
    if (mode === currentMode) return;
    if (mode === "autonomous") {
      // Show upgrade section — scroll to it
      document.getElementById("autonomous-upgrade")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (mode === "supervised") {
      setShowSupervisedConfirm(true);
      setPendingMode("supervised");
      return;
    }
    // HITL — just set it
    setModeMutation.mutate({ mode });
  };

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
          <Bot className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Bot Control Center</h1>
          <p className="text-xs text-muted-foreground">Manage trading mode, monitor activity, emergency controls</p>
        </div>
        {isHalted && (
          <Badge variant="outline" className="ml-auto text-loss border-loss/40 animate-pulse">
            HALTED
          </Badge>
        )}
      </div>

      {/* HALTED Banner */}
      {isHalted && (
        <div
          className="flex items-center justify-between gap-3 p-4 rounded-lg border border-loss/50 bg-loss/10"
          data-testid="halted-banner"
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-loss shrink-0" />
            <div>
              <div className="text-sm font-semibold text-loss">Emergency Halt Active</div>
              <div className="text-xs text-muted-foreground">All trading is stopped. No orders will be placed until you restart.</div>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-profit/40 text-profit hover:bg-profit/10 shrink-0"
            data-testid="button-restart-bot"
            onClick={() => setShowRestartConfirm(true)}
            disabled={restartMutation.isPending}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Restart
          </Button>
        </div>
      )}

      {/* Current Mode Card */}
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <Radio className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Current Mode</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          {statusLoading ? (
            <Skeleton className="h-20" />
          ) : (
            <div className={`flex items-center gap-4 p-4 rounded-lg ${modeCfg.bg} border ${modeCfg.border}`}>
              <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${modeCfg.bg} border ${modeCfg.border}`}>
                <ModeIcon className={`w-6 h-6 ${modeCfg.color}`} />
              </div>
              <div>
                <div className={`text-xl font-bold tracking-tight ${modeCfg.color}`} data-testid="text-current-mode">
                  {modeCfg.label}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-lg">{modeCfg.description}</p>
              </div>
            </div>
          )}

          {/* Mode Selector */}
          {!isHalted && (
            <div className="grid grid-cols-3 gap-2">
              {(["hitl", "supervised", "autonomous"] as const).map((mode) => (
                <ModeCard
                  key={mode}
                  modeKey={mode}
                  currentMode={currentMode}
                  onSelect={() => handleModeSelect(mode)}
                  disabled={setModeMutation.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            {statusLoading ? <Skeleton className="h-8" /> : (
              <>
                <div className="text-2xl font-bold mono text-foreground" data-testid="stat-trades-today">{botStatus?.tradesToday ?? 0}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Trades Today</div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            {statusLoading ? <Skeleton className="h-8" /> : (
              <>
                <div className={`text-2xl font-bold mono ${(botStatus?.dailyPnl ?? 0) >= 0 ? "text-profit" : "text-loss"}`} data-testid="stat-daily-pnl">
                  {(botStatus?.dailyPnl ?? 0) >= 0 ? "+" : ""}${Math.abs(botStatus?.dailyPnl ?? 0).toFixed(0)}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Daily P&L</div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            {statusLoading ? <Skeleton className="h-8" /> : (
              <>
                <div className="text-2xl font-bold mono text-blue-400" data-testid="stat-win-rate">{botStatus?.winRate ?? 0}%</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Win Rate (L20)</div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            {statusLoading ? <Skeleton className="h-8" /> : (
              <>
                <div className="text-2xl font-bold mono text-muted-foreground" data-testid="stat-uptime">{botStatus?.uptime ?? "0h 0m"}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Uptime</div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upgrade to Autonomous */}
      {!isHalted && currentMode !== "autonomous" && (
        <Card id="autonomous-upgrade">
          <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-medium">Upgrade to Autonomous Mode</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-4">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold mb-1">Risk Warning</div>
                  Autonomous mode lets the bot execute <strong>all qualifying trades</strong> without your confirmation.
                  Emergency halt stops immediately. Daily loss and drawdown limits are enforced. Risk guardrails are hardcoded and cannot be overridden.
                </div>
              </div>
            </div>

            {!settingsData?.hasPrivateKey && (
              <div className="p-3 rounded-lg bg-loss/10 border border-loss/20 text-xs text-loss flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>API key required. <a href="#/settings" className="underline">Configure in Settings</a> first.</span>
              </div>
            )}

            {/* Daily Loss Limit */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Daily Loss Limit ($)</Label>
              <Input
                data-testid="input-daily-loss-limit"
                type="number"
                min={50}
                max={10000}
                value={dailyLossLimit}
                onChange={e => setDailyLossLimit(parseFloat(e.target.value) || 500)}
                className="h-9 text-sm mono w-40"
              />
              <p className="text-[10px] text-muted-foreground">Bot halts automatically if daily losses exceed this amount.</p>
            </div>

            {/* Max Drawdown */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Max Drawdown Limit (%)</Label>
              <Input
                data-testid="input-max-drawdown"
                type="number"
                min={5}
                max={50}
                value={maxDrawdown}
                onChange={e => setMaxDrawdown(parseFloat(e.target.value) || 20)}
                className="h-9 text-sm mono w-40"
              />
            </div>

            {/* Confirmation Text */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Confirmation</Label>
              <Input
                data-testid="input-autonomous-confirm"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="Type: I CONFIRM AUTONOMOUS MODE"
                className={`h-9 text-sm mono ${confirmText === "I CONFIRM AUTONOMOUS MODE" ? "border-profit/50" : ""}`}
              />
              <p className="text-[10px] text-muted-foreground">
                Type exactly: <span className="mono text-foreground">I CONFIRM AUTONOMOUS MODE</span>
              </p>
            </div>

            {/* Last confirmed timestamp */}
            {botConfig?.autonomousConfirmedAt && (
              <div className="text-[10px] text-muted-foreground">
                Last autonomous confirmation: <span className="mono">{new Date(botConfig.autonomousConfirmedAt).toLocaleString()}</span>
              </div>
            )}

            <Button
              data-testid="button-release-autonomous"
              className="w-full bg-profit hover:bg-profit/90 text-black font-semibold"
              disabled={!canEnableAutonomous || setModeMutation.isPending}
              onClick={() => setModeMutation.mutate({
                mode: "autonomous",
                confirmation: confirmText,
                dailyLossLimit,
                maxDrawdownLimit: maxDrawdown,
              })}
            >
              <Zap className="w-4 h-4 mr-2" />
              {setModeMutation.isPending ? "Activating..." : "Release Autonomous Mode"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Emergency Kill Switch */}
      <Card className="border-loss/20">
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <Power className="w-4 h-4 text-loss" />
          <CardTitle className="text-sm font-medium text-loss">Emergency Kill Switch</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <p className="text-xs text-muted-foreground">
            Immediately halts all trading, cancels all open orders, and prevents any new trades until manually restarted.
            Works regardless of API connectivity.
          </p>
          <Button
            data-testid="button-emergency-halt"
            variant="destructive"
            className="w-full h-12 text-base font-bold tracking-wide"
            onClick={() => setShowHaltConfirm(true)}
            disabled={isHalted || haltMutation.isPending}
          >
            <ShieldAlert className="w-5 h-5 mr-2" />
            {isHalted ? "BOT ALREADY HALTED" : "HALT ALL TRADING"}
          </Button>
          {isHalted && (
            <Button
              variant="outline"
              className="w-full border-profit/40 text-profit hover:bg-profit/10"
              data-testid="button-restart-bot-bottom"
              onClick={() => setShowRestartConfirm(true)}
              disabled={restartMutation.isPending}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Restart Bot (HITL mode)
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Sports Agent */}
      <SportsAgentPanel />

      {/* Live Activity Feed */}
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Live Activity Feed</CardTitle>
          <span className="ml-auto text-[10px] text-muted-foreground">Auto-refreshes every 5s</span>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {autoTrades.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <div className="text-sm">No executed trades yet</div>
              <div className="text-xs mt-1">Auto-executed trades will appear here in real-time</div>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
              {autoTrades.map(trade => (
                <ActivityEntry key={trade.id} trade={trade} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Emergency Halt Confirmation Dialog */}
      <AlertDialog open={showHaltConfirm} onOpenChange={setShowHaltConfirm}>
        <AlertDialogContent className="bg-card border-border max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-loss flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" />
              Halt All Trading
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately cancel all open orders and stop all trading activity. No new trades will be placed until you manually restart the bot.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-halt"
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => haltMutation.mutate()}
              disabled={haltMutation.isPending}
            >
              {haltMutation.isPending ? "Halting..." : "Halt All Trading"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restart Confirmation Dialog */}
      <AlertDialog open={showRestartConfirm} onOpenChange={setShowRestartConfirm}>
        <AlertDialogContent className="bg-card border-border max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-profit" />
              Restart Bot
            </AlertDialogTitle>
            <AlertDialogDescription>
              Bot will be restarted in HITL (Human in the Loop) mode. You can upgrade the mode after restarting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-restart"
              className="bg-profit text-black hover:bg-profit/90"
              onClick={() => restartMutation.mutate()}
              disabled={restartMutation.isPending}
            >
              {restartMutation.isPending ? "Restarting..." : "Restart Bot"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Supervised Confirm Dialog */}
      <AlertDialog open={showSupervisedConfirm} onOpenChange={setShowSupervisedConfirm}>
        <AlertDialogContent className="bg-card border-border max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-amber-400" />
              Enable Supervised Auto
            </AlertDialogTitle>
            <AlertDialogDescription>
              In Supervised mode, the bot will automatically execute trades that meet ALL criteria: edge ≥ 8%, confidence ≥ 80%, cost ≤ $50, spread ≤ 0.06. All other signals still require your approval.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingMode(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-supervised"
              className="bg-amber-500 text-black hover:bg-amber-600"
              onClick={() => {
                setModeMutation.mutate({ mode: "supervised" });
                setShowSupervisedConfirm(false);
              }}
            >
              Enable Supervised
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
