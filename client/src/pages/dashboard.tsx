import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
  BarChart, Bar, Cell
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Activity, Percent,
  BarChart2, AlertTriangle, CheckCircle2, Clock, Zap, ShieldAlert,
  ShoppingCart, XCircle, PauseCircle
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_EDGE_DATA = [
  { category: "World Events", gap: 7.32, color: "#b91c1c" },
  { category: "Entertainment", gap: 4.79, color: "#dc2626" },
  { category: "Crypto", gap: 2.69, color: "#f97316" },
  { category: "Weather", gap: 2.57, color: "#eab308" },
  { category: "Sports", gap: 2.23, color: "#84cc16" },
  { category: "Politics", gap: 1.02, color: "#22d3ee" },
  { category: "Finance/Macro", gap: 0.17, color: "#3b82f6" },
];

const ACTIVE_EDGES = 4; // Active in system
const TOTAL_EDGES = 10;

type Portfolio = {
  totalBalance: number; unrealizedPnl: number; realizedPnl: number;
  totalReturn: number; winRate: number; sharpeRatio: number;
  maxDrawdown: number; activePositions: number; botStatus: string;
};
type PnlHistory = { timestamp: string; cumulativePnl: number; dailyPnl: number; balance: number };
type Agent = { id: number; name: string; status: string; lastHeartbeat: string; messagesProcessed: number; errorCount: number; latencyMs: number; description: string };
type Signal = { id: number; ticker: string; edgeScore: number; trueProbability: number; marketPrice: number; signalType: string; modelConfidence: number; modelName: string; createdAt: string };

function KpiCard({ label, value, sub, positive, icon: Icon, href }: { label: string; value: string; sub?: string; positive?: boolean; icon: any; href?: string }) {
  const [, navigate] = useLocation();

  return (
    <Card
      data-testid={`kpi-${label.toLowerCase().replace(/\s/g, '-')}`}
      className={href ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
      onClick={href ? () => navigate(href) : undefined}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-1 mb-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className={`text-xl font-semibold mono ${positive === true ? "text-profit" : positive === false ? "text-loss" : "text-foreground"}`}>
          {value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

const AgentStatusDot = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    healthy: "bg-profit",
    idle: "bg-muted-foreground",
    degraded: "bg-warning-amt",
    error: "bg-loss",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || "bg-muted-foreground"} ${status === "healthy" ? "live-pulse" : ""}`} />;
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-3 py-2 text-xs shadow-md">
      <div className="text-muted-foreground mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color }} className="mono">
          {p.name}: {p.value >= 0 ? "+" : ""}${p.value.toFixed(2)}
        </div>
      ))}
    </div>
  );
};

type Settings = { hasPrivateKey: boolean };
type LiveBalance = { balance: number; portfolio_value?: number };

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: portfolioData, isLoading: pLoading } = useQuery<{ portfolio: Portfolio; pnlHistory: PnlHistory[] }>({
    queryKey: ["/api/portfolio"],
    refetchInterval: 30000,
  });

  const { data: settingsData } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const hasPrivateKey = settingsData?.hasPrivateKey ?? false;

  const { data: liveBalanceData } = useQuery<LiveBalance>({
    queryKey: ["/api/live/balance"],
    refetchInterval: 30000,
    enabled: hasPrivateKey,
  });
  const { data: agents, isLoading: aLoading } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    refetchInterval: 15000,
  });
  const { data: signals } = useQuery<Signal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 30000,
  });

  const cancelAllMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/live/orders"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/live/orders"] });
      toast({ title: "All orders cancelled", description: "All open orders have been cancelled." });
    },
    onError: (e: any) => {
      toast({ title: "Cancel failed", description: e?.message || "Failed to cancel orders", variant: "destructive" });
    },
  });

  const controlBotMutation = useMutation({
    mutationFn: (action: string) => apiRequest("POST", "/api/bot/control", { action }),
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({ title: `Bot ${action}`, description: `The bot has been set to ${action}.` });
    },
    onError: (e: any) => {
      toast({ title: "Bot control failed", description: e?.message || "Failed to control bot", variant: "destructive" });
    },
  });

  const portfolio = portfolioData?.portfolio;
  const pnlHistory = portfolioData?.pnlHistory || [];

  // Sample every 3rd point for chart performance
  const chartData = pnlHistory.filter((_, i) => i % 3 === 0).map(h => ({
    date: format(parseISO(h.timestamp), "MM/dd"),
    pnl: h.cumulativePnl,
    balance: h.balance,
  }));

  const recentSignals = (signals || []).slice(0, 8);

  return (
    <div className="p-4 space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {pLoading ? (
          Array(7).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <KpiCard
                label="Balance"
                value={
                  hasPrivateKey && liveBalanceData?.balance !== undefined
                    ? `$${(liveBalanceData.balance / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : `$${portfolio?.totalBalance?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}`
                }
                sub={hasPrivateKey ? "Live" : "Demo"}
                icon={DollarSign}
                href="/positions"
              />
            <KpiCard label="Unrealized P&L" value={`${portfolio?.unrealizedPnl >= 0 ? "+" : ""}$${portfolio?.unrealizedPnl?.toFixed(2) || "0.00"}`} positive={portfolio?.unrealizedPnl >= 0} icon={TrendingUp} href="/positions" />
            <KpiCard label="Realized P&L" value={`${portfolio?.realizedPnl >= 0 ? "+" : ""}$${portfolio?.realizedPnl?.toFixed(2) || "0.00"}`} positive={portfolio?.realizedPnl >= 0} icon={TrendingDown} href="/orders" />
            <KpiCard label="Total Return" value={`${portfolio?.totalReturn?.toFixed(2) || "0.00"}%`} positive={portfolio?.totalReturn >= 0} icon={Percent} sub="All time" href="/backtest" />
            <KpiCard label="Win Rate" value={`${portfolio?.winRate?.toFixed(1) || "0.0"}%`} positive={portfolio?.winRate >= 50} icon={Activity} href="/backtest" />
            <KpiCard label="Sharpe Ratio" value={portfolio?.sharpeRatio?.toFixed(2) || "0.00"} positive={portfolio?.sharpeRatio >= 1} icon={BarChart2} sub="Annualized" href="/backtest" />
            <KpiCard label="Positions" value={String(portfolio?.activePositions || 0)} icon={Zap} sub={`Max DD ${portfolio?.maxDrawdown?.toFixed(1)}%`} href="/positions" />
          </>
        )}
      </div>

      {/* Quick Actions Row */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="text-xs gap-1.5"
          data-testid="button-quick-place-trade"
          onClick={() => navigate("/markets")}
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          Place Trade
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="text-xs gap-1.5"
          data-testid="button-quick-cancel-all"
          onClick={() => {
            if (!hasPrivateKey) {
              toast({ title: "Demo Mode", description: "Connect a private key to cancel live orders.", variant: "destructive" });
              return;
            }
            cancelAllMutation.mutate();
          }}
          disabled={cancelAllMutation.isPending}
        >
          <XCircle className="w-3.5 h-3.5" />
          {cancelAllMutation.isPending ? "Cancelling..." : "Cancel All Orders"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="text-xs gap-1.5"
          data-testid="button-quick-pause-bot"
          onClick={() => {
            const currentStatus = portfolio?.botStatus || "stopped";
            const action = currentStatus === "paused" ? "running" : "paused";
            controlBotMutation.mutate(action);
          }}
          disabled={controlBotMutation.isPending}
        >
          <PauseCircle className="w-3.5 h-3.5" />
          {portfolio?.botStatus === "paused" ? "Resume Bot" : "Pause Bot"}
        </Button>
      </div>

      {/* P&L Chart + Agents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-1">
            <CardTitle className="text-sm font-medium">Cumulative P&L — 90 Days</CardTitle>
            <Badge variant="outline" className="text-xs mono">
              {portfolio?.totalReturn >= 0 ? "+" : ""}{portfolio?.totalReturn?.toFixed(2)}%
            </Badge>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {pLoading ? (
              <Skeleton className="h-48" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 14%, 19%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(215, 20%, 55%)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(215, 20%, 55%)" }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} width={55} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="hsl(215, 14%, 25%)" />
                  <Line type="monotone" dataKey="pnl" name="P&L" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Agent Health */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Agent Health</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {aLoading ? (
              Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)
            ) : (
              (agents || []).map((agent) => (
                <div key={agent.id} data-testid={`agent-${agent.id}`} className="flex items-center gap-2 p-2 rounded-md bg-muted/40">
                  <AgentStatusDot status={agent.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{agent.name}</div>
                    <div className="text-xs text-muted-foreground mono">{agent.latencyMs}ms · {agent.messagesProcessed.toLocaleString()} msgs</div>
                  </div>
                  <Badge variant={agent.status === "healthy" ? "default" : agent.status === "idle" ? "secondary" : "destructive"} className="text-xs shrink-0">
                    {agent.status}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alpha Strategy Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-1">
            <CardTitle className="text-sm font-medium">Category Edge Overview</CardTitle>
            <Badge variant="outline" className="text-xs mono">Maker-Taker Gap</Badge>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart
                data={CATEGORY_EDGE_DATA}
                layout="vertical"
                margin={{ left: 8, right: 24, top: 2, bottom: 2 }}
              >
                <XAxis
                  type="number"
                  tick={{ fontSize: 9, fill: "hsl(215, 20%, 55%)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}pp`}
                  domain={[0, 8]}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  tick={{ fontSize: 9, fill: "hsl(215, 20%, 55%)" }}
                  tickLine={false}
                  axisLine={false}
                  width={90}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(215, 25%, 10%)", border: "1px solid hsl(215, 14%, 19%)", borderRadius: 6, fontSize: 11 }}
                  formatter={(v: number) => [`${v.toFixed(2)} pp`, "Gap"]}
                />
                <Bar dataKey="gap" radius={[0, 3, 3, 0]}>
                  {CATEGORY_EDGE_DATA.map((entry) => (
                    <Cell key={entry.category} fill={entry.color} opacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Active Strategies</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Active Edges</span>
              <span className="text-xl font-semibold mono text-profit">{ACTIVE_EDGES}</span>
            </div>
            <div className="w-full bg-muted/40 rounded-full h-2">
              <div
                className="bg-profit h-2 rounded-full transition-all"
                style={{ width: `${(ACTIVE_EDGES / TOTAL_EDGES) * 100}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground">{ACTIVE_EDGES} of {TOTAL_EDGES} edges active</div>
            <div className="space-y-2 pt-1">
              {[
                { label: "Longshot Bias", status: "active" },
                { label: "YES/NO Asymmetry", status: "active" },
                { label: "Weather Model", status: "configured" },
                { label: "Macro Divergence", status: "active" },
                { label: "Sports ELO Model", status: "active" },
                { label: "Cross-Platform Arb", status: "inactive" },
                { label: "Speed Edge", status: "inactive" },
              ].map((e) => (
                <div key={e.label} className="flex items-center gap-2">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    e.status === "active" ? "bg-profit" :
                    e.status === "configured" ? "bg-blue-400" :
                    "bg-muted-foreground/40"
                  }`} />
                  <span className="text-xs text-muted-foreground">{e.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Signals */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium">Recent Signals</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Time</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Ticker</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Signal</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Edge</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">True P</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Mkt P</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Conf</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Model</th>
                </tr>
              </thead>
              <tbody>
                {recentSignals.map((sig) => {
                  const isPos = sig.signalType === "BUY_YES";
                  const isNeg = sig.signalType === "BUY_NO";
                  const isNo = sig.signalType === "NO_TRADE";
                  return (
                    <tr key={sig.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`signal-row-${sig.id}`} onClick={() => navigate("/signals")}>
                      <td className="px-4 py-2 text-muted-foreground mono">{format(parseISO(sig.createdAt), "HH:mm")}</td>
                      <td className="px-4 py-2 font-medium mono">{sig.ticker}</td>
                      <td className="px-4 py-2">
                        <Badge variant={isNo ? "secondary" : "outline"} className={`text-xs ${isPos ? "text-profit" : isNeg ? "text-loss" : ""}`}>
                          {sig.signalType}
                        </Badge>
                      </td>
                      <td className={`px-4 py-2 text-right mono font-medium ${sig.edgeScore > 0 ? "text-profit" : "text-loss"}`}>
                        {sig.edgeScore > 0 ? "+" : ""}{sig.edgeScore.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2 text-right mono">{(sig.trueProbability * 100).toFixed(1)}¢</td>
                      <td className="px-4 py-2 text-right mono">{(sig.marketPrice * 100).toFixed(1)}¢</td>
                      <td className="px-4 py-2 text-right mono text-muted-foreground">{(sig.modelConfidence * 100).toFixed(0)}%</td>
                      <td className="px-4 py-2 text-muted-foreground">{sig.modelName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
