import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
} from "recharts";
import { Shield, AlertTriangle, Save, CheckCircle2, Clock, XCircle, RotateCcw } from "lucide-react";

const RISK_IMPERATIVES = [
  {
    risk: "Adverse selection (informed traders)",
    mitigation: "Widen spreads before scheduled news events; kill-switch on breaking news",
    configKey: "stopLossThreshold",
    statusFn: (cfg: any) => cfg?.stopLossThreshold <= 60 ? "green" : cfg?.stopLossThreshold <= 75 ? "yellow" : "red",
  },
  {
    risk: "Inventory imbalance",
    mitigation: "Auto-rebalance every 30-60s; merge YES+NO positions to free capital",
    configKey: "maxCategoryExposurePct",
    statusFn: (cfg: any) => cfg?.maxCategoryExposurePct <= 20 ? "green" : cfg?.maxCategoryExposurePct <= 30 ? "yellow" : "red",
  },
  {
    risk: "Model overconfidence",
    mitigation: "Fractional Kelly (25-50%); cap max position at 5% of account",
    configKey: "kellyFractionMax",
    statusFn: (cfg: any) => cfg?.maxPositionPct <= 5 && cfg?.kellyFractionMax <= 0.5 ? "green" : cfg?.maxPositionPct <= 10 ? "yellow" : "red",
  },
  {
    risk: "Regulatory risk",
    mitigation: "7 US states have active cease-and-desist orders as of Q1 2026. Check kalshi.com/legal for your state before trading.",
    configKey: null,
    statusFn: (_cfg: any) => "yellow",
  },
  {
    risk: "Fee drag",
    mitigation: "Target markets where model edge exceeds 3-5%; 0.2% taker, 0.05% maker rebate",
    configKey: "maxPositionPct",
    statusFn: (cfg: any) => cfg?.maxPositionPct <= 5 ? "green" : "yellow",
  },
  {
    risk: "Late-market convergence",
    mitigation: "Reduce/exit positions as contract approaches resolution",
    configKey: "takeProfitTarget",
    statusFn: (cfg: any) => cfg?.takeProfitTarget <= 80 ? "green" : "yellow",
  },
  {
    risk: "Cross-platform execution risk",
    mitigation: "All orders use post_only=true limit orders — maker-only fills, no taker exposure.",
    configKey: null,
    statusFn: (_cfg: any) => "green",
  },
  {
    risk: "Thin book protection",
    mitigation: "Minimum 48 contracts depth required before any trade. Scanner enforces this hardcoded guardrail.",
    configKey: null,
    statusFn: (_cfg: any) => "green",
  },
];

import { useQuery as usePortfolioQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";

type RiskConfig = {
  id: number; maxPositionPct: number; maxCategoryExposurePct: number;
  kellyFractionMin: number; kellyFractionMax: number; stopLossThreshold: number;
  takeProfitTarget: number; maxDrawdownPause: number; dailyVaR: number; updatedAt: string;
};

type PnlHistory = { timestamp: string; cumulativePnl: number; dailyPnl: number; balance: number };

const DEFAULT_RISK_CONFIG = {
  maxPositionPct: 5,
  maxCategoryExposurePct: 20,
  kellyFractionMin: 0.25,
  kellyFractionMax: 0.50,
  stopLossThreshold: 50,
  takeProfitTarget: 75,
  maxDrawdownPause: 10,
  dailyVaR: 2.5,
};

function RiskSlider({ label, value, min, max, step = 1, unit = "%", onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-medium mono">{value}{unit}</span>
      </div>
      <Slider
        min={min} max={max} step={step} value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
    </div>
  );
}

function isDirty(form: Partial<RiskConfig>, saved: RiskConfig | undefined): boolean {
  if (!saved) return false;
  return (
    form.maxPositionPct !== saved.maxPositionPct ||
    form.maxCategoryExposurePct !== saved.maxCategoryExposurePct ||
    form.kellyFractionMin !== saved.kellyFractionMin ||
    form.kellyFractionMax !== saved.kellyFractionMax ||
    form.stopLossThreshold !== saved.stopLossThreshold ||
    form.takeProfitTarget !== saved.takeProfitTarget ||
    form.maxDrawdownPause !== saved.maxDrawdownPause ||
    form.dailyVaR !== saved.dailyVaR
  );
}

export default function Risk() {
  const { toast } = useToast();

  const { data: config, isLoading } = useQuery<RiskConfig>({
    queryKey: ["/api/risk/config"],
  });

  const { data: portfolioData } = usePortfolioQuery<{ portfolio: any; pnlHistory: PnlHistory[] }>({
    queryKey: ["/api/portfolio"],
  });

  const [form, setForm] = useState<Partial<RiskConfig>>({});

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const dirty = isDirty(form, config);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<RiskConfig>) => apiRequest("PUT", "/api/risk/config", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/risk/config"] });
      toast({ title: "Risk config saved", description: "Your risk configuration has been saved." });
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e?.message || "Failed to save risk config", variant: "destructive" });
    },
  });

  const handleResetDefaults = () => {
    setForm(f => ({
      ...f,
      ...DEFAULT_RISK_CONFIG,
    }));
    toast({ title: "Reset to defaults", description: "Sliders reset to recommended defaults. Click Save to apply." });
  };

  const pnlHistory = portfolioData?.pnlHistory || [];

  // Compute drawdown from P&L history
  const drawdownData = pnlHistory.filter((_, i) => i % 2 === 0).map((h, i) => {
    const peak = Math.max(...pnlHistory.slice(0, i + 1).map(x => x.balance));
    const dd = peak > 0 ? ((h.balance - peak) / peak) * 100 : 0;
    return { date: format(parseISO(h.timestamp), "MM/dd"), drawdown: parseFloat(dd.toFixed(2)) };
  });

  const portfolio = portfolioData?.portfolio;
  const currentDD = portfolio?.maxDrawdown || 0;

  return (
    <div className="p-4 space-y-4">
      {/* Risk Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Current Drawdown</div>
          <div className={`text-xl font-semibold mono ${currentDD > 7 ? "text-loss" : currentDD > 4 ? "text-warning-amt" : "text-profit"}`}>
            -{currentDD.toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground">Pause at {form.maxDrawdownPause || 10}%</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Daily VaR (95%)</div>
          <div className="text-xl font-semibold mono text-warning-amt">{form.dailyVaR || 2.5}%</div>
          <div className="text-xs text-muted-foreground">of portfolio</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Max Position</div>
          <div className="text-xl font-semibold mono">{form.maxPositionPct || 5}%</div>
          <div className="text-xs text-muted-foreground">per market</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Kelly Fraction</div>
          <div className="text-xl font-semibold mono">{(form.kellyFractionMin || 0.25) * 100}–{(form.kellyFractionMax || 0.5) * 100}%</div>
          <div className="text-xs text-muted-foreground">range</div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Config Panel */}
        <Card>
          <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-medium">Risk Configuration</CardTitle>
            {dirty && (
              <Badge variant="secondary" className="ml-auto text-xs text-warning-amt border-warning-amt/40 bg-warning-amt/10">
                Unsaved Changes
              </Badge>
            )}
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-5">
            {isLoading ? (
              Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)
            ) : (
              <>
                <RiskSlider
                  label="Max Position Size (% portfolio)"
                  value={form.maxPositionPct || 5} min={1} max={20}
                  onChange={v => setForm(f => ({ ...f, maxPositionPct: v }))}
                />
                <RiskSlider
                  label="Max Category Exposure (%)"
                  value={form.maxCategoryExposurePct || 20} min={5} max={50}
                  onChange={v => setForm(f => ({ ...f, maxCategoryExposurePct: v }))}
                />
                <RiskSlider
                  label="Kelly Fraction Min (%)"
                  value={(form.kellyFractionMin || 0.25) * 100} min={10} max={50}
                  onChange={v => setForm(f => ({ ...f, kellyFractionMin: v / 100 }))}
                />
                <RiskSlider
                  label="Kelly Fraction Max (%)"
                  value={(form.kellyFractionMax || 0.5) * 100} min={25} max={100}
                  onChange={v => setForm(f => ({ ...f, kellyFractionMax: v / 100 }))}
                />
                <RiskSlider
                  label="Stop-Loss Threshold (price %)"
                  value={form.stopLossThreshold || 50} min={10} max={90}
                  onChange={v => setForm(f => ({ ...f, stopLossThreshold: v }))}
                />
                <RiskSlider
                  label="Take-Profit Target (price %)"
                  value={form.takeProfitTarget || 75} min={50} max={99}
                  onChange={v => setForm(f => ({ ...f, takeProfitTarget: v }))}
                />
                <RiskSlider
                  label="Max Drawdown Pause (%)"
                  value={form.maxDrawdownPause || 10} min={3} max={30}
                  onChange={v => setForm(f => ({ ...f, maxDrawdownPause: v }))}
                />
                <RiskSlider
                  label="Daily VaR Limit (%)"
                  value={form.dailyVaR || 2.5} min={0.5} max={10} step={0.5}
                  onChange={v => setForm(f => ({ ...f, dailyVaR: v }))}
                />

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 text-xs"
                    data-testid="button-reset-defaults"
                    onClick={handleResetDefaults}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                    Reset to Defaults
                  </Button>
                  <Button
                    className="flex-1"
                    data-testid="button-save-risk"
                    onClick={() => updateMutation.mutate(form)}
                    disabled={updateMutation.isPending}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {updateMutation.isPending ? "Saving..." : "Save Configuration"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Drawdown Chart */}
        <Card>
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-1">
            <CardTitle className="text-sm font-medium">Portfolio Drawdown</CardTitle>
            {currentDD > (form.maxDrawdownPause || 10) * 0.7 && (
              <Badge variant="destructive" className="text-xs gap-1">
                <AlertTriangle className="w-3 h-3" /> Warning
              </Badge>
            )}
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={drawdownData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 14%, 19%)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(215, 20%, 55%)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "hsl(215, 20%, 55%)" }} tickLine={false} axisLine={false} tickFormatter={v => `${v.toFixed(0)}%`} width={40} />
                <Tooltip
                  contentStyle={{ background: "hsl(215, 25%, 10%)", border: "1px solid hsl(215, 14%, 19%)", borderRadius: 6, fontSize: 11 }}
                  formatter={(v: number) => [`${v.toFixed(2)}%`, "Drawdown"]}
                />
                <ReferenceLine y={-(form.maxDrawdownPause || 10)} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "Pause", fill: "#f59e0b", fontSize: 10 }} />
                <ReferenceLine y={0} stroke="hsl(215, 14%, 25%)" />
                <Area type="monotone" dataKey="drawdown" stroke="#ef4444" fill="url(#ddGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Risk Imperatives Table */}
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-warning-amt" />
          <CardTitle className="text-sm font-medium">Risk Management Imperatives</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium w-8">Status</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Risk</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Mitigation</th>
                </tr>
              </thead>
              <tbody>
                {RISK_IMPERATIVES.map((imp, i) => {
                  const status = imp.statusFn(form);
                  const StatusIcon = status === "green" ? CheckCircle2 : status === "yellow" ? Clock : XCircle;
                  const iconColor = status === "green" ? "text-profit" : status === "yellow" ? "text-warning-amt" : "text-loss";
                  return (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors" data-testid={`imperative-row-${i}`}>
                      <td className="px-4 py-3">
                        <StatusIcon className={`w-4 h-4 ${iconColor}`} />
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground/90 max-w-48">{imp.risk}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-96">{imp.mitigation}</td>
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
