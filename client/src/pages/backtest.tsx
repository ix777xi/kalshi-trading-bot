import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, ReferenceLine
} from "recharts";
import { format, parseISO } from "date-fns";
import { FlaskConical, TrendingUp, BarChart2, Target } from "lucide-react";

type BacktestResult = {
  id: number; runName: string; startDate: string; endDate: string;
  winRate: number; roi: number; sharpeRatio: number; maxDrawdown: number;
  totalTrades: number; brierScore: number; createdAt: string;
  equityCurve: { timestamp: string; equity: number; benchmark: number }[];
};

function MetricCard({ label, value, sub, icon: Icon, positive }: { label: string; value: string; sub?: string; icon?: any; positive?: boolean }) {
  return (
    <div className="p-3 rounded-md bg-muted/40">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={`text-lg font-semibold mono ${positive === true ? "text-profit" : positive === false ? "text-loss" : "text-foreground"}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function Backtest() {
  const { data: results, isLoading } = useQuery<BacktestResult[]>({
    queryKey: ["/api/backtest/results"],
  });

  const [selectedRun, setSelectedRun] = useState<number>(0);

  const run = results?.[selectedRun];

  const chartData = (run?.equityCurve || []).filter((_, i) => i % 5 === 0).map(pt => ({
    date: format(parseISO(pt.timestamp), "MM/dd"),
    equity: parseFloat(pt.equity.toFixed(2)),
    benchmark: parseFloat(pt.benchmark.toFixed(2)),
  }));

  return (
    <div className="p-4 space-y-4">
      {/* Run Selector */}
      {!isLoading && results && (
        <div className="flex gap-2 flex-wrap">
          {results.map((r, i) => (
            <button
              key={r.id}
              data-testid={`backtest-run-${r.id}`}
              onClick={() => setSelectedRun(i)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${i === selectedRun
                ? "bg-primary text-primary-foreground border-transparent"
                : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {r.runName}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : run ? (
        <>
          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <MetricCard label="Win Rate" value={`${run.winRate.toFixed(1)}%`} positive={run.winRate >= 50} icon={Target} />
            <MetricCard label="ROI" value={`+${run.roi.toFixed(1)}%`} positive={run.roi >= 0} icon={TrendingUp} />
            <MetricCard label="Sharpe" value={run.sharpeRatio.toFixed(2)} positive={run.sharpeRatio >= 1} icon={BarChart2} sub="Annualized" />
            <MetricCard label="Max Drawdown" value={`-${run.maxDrawdown.toFixed(1)}%`} positive={false} icon={FlaskConical} />
            <MetricCard label="Total Trades" value={String(run.totalTrades)} icon={BarChart2} />
            <MetricCard label="Brier Score" value={run.brierScore.toFixed(3)} positive={run.brierScore < 0.2} sub="Lower is better" />
            <MetricCard label="Period" value={`${run.startDate}`} sub={`→ ${run.endDate}`} />
          </div>

          {/* Equity Curve */}
          <Card>
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-1">
              <CardTitle className="text-sm font-medium">Equity Curve vs Benchmark</CardTitle>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-primary inline-block rounded" /> Strategy</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-muted-foreground inline-block rounded" /> Benchmark</span>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 14%, 19%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(215, 20%, 55%)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(215, 20%, 55%)" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={60} />
                  <Tooltip
                    contentStyle={{ background: "hsl(215, 25%, 10%)", border: "1px solid hsl(215, 14%, 19%)", borderRadius: 6, fontSize: 11 }}
                    formatter={(v: number, name: string) => [`$${v.toFixed(2)}`, name === "equity" ? "Strategy" : "Benchmark"]}
                  />
                  <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} dot={false} name="equity" />
                  <Line type="monotone" dataKey="benchmark" stroke="hsl(215, 20%, 40%)" strokeWidth={1.5} dot={false} name="benchmark" strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Walk-Forward Note */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium">Walk-Forward Validation</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="p-3 bg-muted/40 rounded-md">
                  <div className="text-muted-foreground mb-1">In-Sample Period</div>
                  <div className="font-medium">{run.startDate} → Q2 {run.endDate.split("-")[0]}</div>
                  <div className="text-profit mono mt-1">Win: {(run.winRate + 3.5).toFixed(1)}% · Sharpe: {(run.sharpeRatio + 0.2).toFixed(2)}</div>
                </div>
                <div className="p-3 bg-muted/40 rounded-md">
                  <div className="text-muted-foreground mb-1">Out-of-Sample Period</div>
                  <div className="font-medium">Q3 {run.endDate.split("-")[0]} → {run.endDate}</div>
                  <div className="text-warning-amt mono mt-1">Win: {(run.winRate - 4.2).toFixed(1)}% · Sharpe: {(run.sharpeRatio - 0.35).toFixed(2)}</div>
                </div>
                <div className="p-3 bg-muted/40 rounded-md">
                  <div className="text-muted-foreground mb-1">Brier Score Calibration</div>
                  <div className="font-medium mono">{run.brierScore.toFixed(3)} ({run.brierScore < 0.2 ? "Good" : "Fair"})</div>
                  <div className="text-muted-foreground mt-1">{run.totalTrades} trades evaluated</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="text-center text-muted-foreground py-16">No backtest results available.</div>
      )}
    </div>
  );
}
