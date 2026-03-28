import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";
import { Zap, Database, DollarSign } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend
} from "recharts";

// Demo position type (from local DB)
type DemoPosition = {
  id: number; ticker: string; title: string; side: string; quantity: number;
  entryPrice: number; currentPrice: number; unrealizedPnl: number;
  pnlPct: number; category: string; kellyFraction: number; openedAt: string;
};

// Live position type (from Kalshi API)
type LivePosition = {
  market_id?: string;
  ticker?: string;
  market_exposure?: number;
  position?: number; // contract count
  realized_pnl?: number;
  total_traded?: number;
  side?: string;
};

type Settings = { hasPrivateKey: boolean };

const CATEGORY_COLORS: Record<string, string> = {
  politics: "#3b82f6",
  economics: "#22c55e",
  sports: "#f59e0b",
  weather: "#8b5cf6",
  technology: "#06b6d4",
  finance: "#ec4899",
};

export default function Positions() {
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: settingsData } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });
  const hasPrivateKey = settingsData?.hasPrivateKey ?? false;
  const isLive = mode === "live" && hasPrivateKey;

  // Demo positions
  const { data: demoPositions, isLoading: demoLoading } = useQuery<DemoPosition[]>({
    queryKey: ["/api/positions"],
    refetchInterval: 15000,
    enabled: !isLive,
  });

  // Live positions
  const { data: livePositionsData, isLoading: livePositionsLoading } = useQuery<{ market_positions: LivePosition[] }>({
    queryKey: ["/api/live/positions"],
    refetchInterval: 10000,
    enabled: isLive,
  });

  // Live balance
  const { data: liveBalanceData, isLoading: liveBalanceLoading } = useQuery<{ balance: number; portfolio_value?: number }>({
    queryKey: ["/api/live/balance"],
    refetchInterval: 10000,
    enabled: isLive,
  });

  const isLoading = isLive ? livePositionsLoading : demoLoading;

  // Demo stats
  const demoPositionsList = demoPositions || [];
  const totalPnl = demoPositionsList.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalLong = demoPositionsList.filter(p => p.side === "yes").length;
  const totalShort = demoPositionsList.filter(p => p.side === "no").length;

  const catExposure = demoPositionsList.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + Math.abs(p.unrealizedPnl);
    return acc;
  }, {} as Record<string, number>);
  const pieData = Object.entries(catExposure).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));

  // Live stats
  const livePositionsList = livePositionsData?.market_positions || [];
  const liveBalance = liveBalanceData?.balance;
  const liveBalanceDollars = liveBalance !== undefined ? (liveBalance / 100).toFixed(2) : null;
  const livePortfolioValue = liveBalanceData?.portfolio_value;
  const liveTotalExposure = livePositionsList.reduce((sum, p) => sum + Math.abs(p.market_exposure || 0), 0);

  const handleClosePosition = (ticker: string) => {
    toast({
      title: "Navigate to Markets",
      description: `Navigate to Markets to close your ${ticker} position.`,
    });
    navigate("/markets");
  };

  return (
    <div className="p-4 space-y-4">
      {/* Mode Toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center rounded-md border border-border overflow-hidden">
          <Button
            variant="ghost"
            size="sm"
            data-testid="button-positions-mode-live"
            className={`rounded-none h-9 px-3 text-xs gap-1.5 ${isLive ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
            onClick={() => setMode("live")}
            disabled={!hasPrivateKey}
          >
            <Zap className="w-3 h-3" />
            Live
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="button-positions-mode-demo"
            className={`rounded-none h-9 px-3 text-xs gap-1.5 ${!isLive ? "bg-muted/50 text-foreground" : "text-muted-foreground"}`}
            onClick={() => setMode("demo")}
          >
            <Database className="w-3 h-3" />
            Demo
          </Button>
        </div>
        {!hasPrivateKey && (
          <span className="text-xs text-muted-foreground">Configure your private key in Settings to enable live mode</span>
        )}
      </div>

      {/* Live Balance Banner */}
      {isLive && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-primary shrink-0" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground mb-1">Live Kalshi Balance</div>
                {liveBalanceLoading ? (
                  <Skeleton className="h-7 w-32" />
                ) : (
                  <div className="flex items-baseline gap-4">
                    <span className="text-2xl font-semibold mono" data-testid="text-live-balance">
                      {liveBalanceDollars !== null ? `$${liveBalanceDollars}` : "—"}
                    </span>
                    {livePortfolioValue !== undefined && (
                      <span className="text-xs text-muted-foreground mono">
                        Portfolio Value: ${(livePortfolioValue / 100).toFixed(2)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Badge variant="outline" className="text-xs text-profit border-profit/40 shrink-0">LIVE</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {isLive ? (
          <>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Total Exposure</div>
              <div className="text-xl font-semibold mono" data-testid="text-live-exposure">
                {livePositionsLoading ? <Skeleton className="h-7 w-20" /> : liveTotalExposure.toLocaleString()}
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Positions</div>
              <div className="text-xl font-semibold mono" data-testid="text-live-position-count">
                {livePositionsLoading ? <Skeleton className="h-7 w-12" /> : livePositionsList.length}
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Total Traded</div>
              <div className="text-xl font-semibold mono" data-testid="text-live-total-traded">
                {livePositionsLoading ? <Skeleton className="h-7 w-20" /> : (
                  livePositionsList.reduce((sum, p) => sum + (p.total_traded || 0), 0).toLocaleString()
                )}
              </div>
            </CardContent></Card>
          </>
        ) : (
          <>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Unrealized P&L</div>
              <div className={`text-xl font-semibold mono ${totalPnl >= 0 ? "text-profit" : "text-loss"}`}>
                {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">YES / NO</div>
              <div className="text-xl font-semibold mono">
                <span className="text-profit">{totalLong}</span>
                <span className="text-muted-foreground mx-1">/</span>
                <span className="text-loss">{totalShort}</span>
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Open Positions</div>
              <div className="text-xl font-semibold mono">{demoPositionsList.length}</div>
            </CardContent></Card>
          </>
        )}
      </div>

      {/* Live Positions Table */}
      {isLive && (
        <div className="grid grid-cols-1 gap-4">
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium">Live Positions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Ticker</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Position</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Exposure</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Realized P&L</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Total Traded</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {livePositionsLoading
                      ? Array(8).fill(0).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td colSpan={6} className="px-4 py-2"><Skeleton className="h-4" /></td>
                        </tr>
                      ))
                      : livePositionsList.map((p, idx) => {
                        const realized = p.realized_pnl !== undefined ? (p.realized_pnl / 100).toFixed(2) : "—";
                        const ticker = p.ticker || p.market_id || "—";
                        return (
                          <tr key={p.market_id || p.ticker || idx} data-testid={`live-position-row-${idx}`} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2 font-medium mono">
                              <button
                                className="text-primary hover:underline cursor-pointer text-xs mono font-medium"
                                onClick={() => navigate("/markets")}
                                data-testid={`link-ticker-live-${idx}`}
                              >
                                {ticker}
                              </button>
                            </td>
                            <td className="px-4 py-2 text-right mono">
                              <span className={Number(p.position) >= 0 ? "text-profit" : "text-loss"}>
                                {p.position !== undefined ? p.position : "—"}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right mono">{p.market_exposure !== undefined ? p.market_exposure : "—"}</td>
                            <td className="px-4 py-2 text-right mono">
                              {p.realized_pnl !== undefined ? (
                                <span className={Number(p.realized_pnl) >= 0 ? "text-profit" : "text-loss"}>
                                  {Number(p.realized_pnl) >= 0 ? "+" : ""}${realized}
                                </span>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-2 text-right mono text-muted-foreground">{p.total_traded !== undefined ? p.total_traded : "—"}</td>
                            <td className="px-4 py-2">
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-6 text-xs px-2"
                                data-testid={`button-close-live-position-${idx}`}
                                onClick={() => handleClosePosition(ticker)}
                              >
                                Close
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    }
                    {!livePositionsLoading && livePositionsList.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                          No live positions found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Demo Positions */}
      {!isLive && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Positions Table */}
          <Card className="lg:col-span-2">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium">Open Positions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Ticker</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Side</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Qty</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Entry</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Current</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Unr. P&L</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">P&L%</th>
                      <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Kelly</th>
                      <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Cat</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {demoLoading
                      ? Array(10).fill(0).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td colSpan={10} className="px-4 py-2"><Skeleton className="h-4" /></td>
                        </tr>
                      ))
                      : demoPositionsList.map(p => (
                        <tr key={p.id} data-testid={`position-row-${p.id}`} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2">
                            <button
                              className="font-medium mono text-primary hover:underline cursor-pointer text-xs"
                              onClick={() => navigate("/markets")}
                              data-testid={`link-ticker-${p.id}`}
                            >
                              {p.ticker}
                            </button>
                            <div className="text-muted-foreground text-xs truncate max-w-28">{p.title}</div>
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className={`text-xs ${p.side === "yes" ? "text-profit border-profit/40" : "text-loss border-loss/40"}`}>
                              {p.side.toUpperCase()}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right mono">{p.quantity}</td>
                          <td className="px-4 py-2 text-right mono text-muted-foreground">{(p.entryPrice * 100).toFixed(1)}¢</td>
                          <td className="px-4 py-2 text-right mono">{(p.currentPrice * 100).toFixed(1)}¢</td>
                          <td className={`px-4 py-2 text-right mono font-medium ${p.unrealizedPnl >= 0 ? "text-profit" : "text-loss"}`}>
                            {p.unrealizedPnl >= 0 ? "+" : ""}${p.unrealizedPnl.toFixed(2)}
                          </td>
                          <td className={`px-4 py-2 text-right mono ${p.pnlPct >= 0 ? "text-profit" : "text-loss"}`}>
                            {p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(1)}%
                          </td>
                          <td className="px-4 py-2 text-right mono text-muted-foreground">{(p.kellyFraction * 100).toFixed(0)}%</td>
                          <td className="px-4 py-2">
                            <span
                              className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                              style={{
                                backgroundColor: (CATEGORY_COLORS[p.category] || "#3b82f6") + "22",
                                color: CATEGORY_COLORS[p.category] || "#3b82f6",
                              }}
                            >
                              {p.category}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-6 text-xs px-2"
                              data-testid={`button-close-position-${p.id}`}
                              onClick={() => handleClosePosition(p.ticker)}
                            >
                              Close
                            </Button>
                          </td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Category Exposure */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium">Category Exposure</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {demoLoading ? <Skeleton className="h-48" /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                      {pieData.map((entry, i) => (
                        <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name] || "#3b82f6"} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "hsl(215, 25%, 10%)", border: "1px solid hsl(215, 14%, 19%)", borderRadius: 6, fontSize: 11 }}
                      formatter={(v: number) => [`$${v.toFixed(0)}`, "Exposure"]}
                    />
                    <Legend iconType="circle" iconSize={8} formatter={(val) => <span className="text-xs text-muted-foreground">{val}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <div className="space-y-1 mt-2">
                {pieData.map(d => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[d.name] || "#3b82f6" }} />
                      <span className="text-muted-foreground capitalize">{d.name}</span>
                    </div>
                    <span className="mono">${d.value.toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
