import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import { ChevronDown, ChevronRight, Sparkles, CheckCircle2, Settings2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_HEATMAP = [
  { category: "World Events", gap: 7.32, color: "#b91c1c" },
  { category: "Entertainment", gap: 4.79, color: "#dc2626" },
  { category: "Crypto", gap: 2.69, color: "#f97316" },
  { category: "Weather", gap: 2.57, color: "#eab308" },
  { category: "Sports", gap: 2.23, color: "#84cc16" },
  { category: "Politics", gap: 1.02, color: "#22d3ee" },
  { category: "Finance/Macro", gap: 0.17, color: "#3b82f6" },
];

const EDGES_INITIAL = [
  {
    id: 1,
    name: "Favorite-Longshot Bias",
    category: "Structural",
    magnitude: "~16pp mispricing at 5¢",
    summary: "5¢ contracts win only 4.18% of the time (implied 5%), a -16.36% mispricing. Contracts above 80¢ consistently outperform. Finance markets nearly efficient (0.17pp), World Events highest (7.32pp).",
    dataSource: "Historical Kalshi trade data, maker-taker gap analysis",
    strategy: "Avoid buying YES longshots below ~20¢. Sell NO against cheap YES buyers. Prioritize World Events and Entertainment categories for highest gap capture.",
    status: "Active",
  },
  {
    id: 2,
    name: "YES/NO Asymmetry (Optimism Tax)",
    category: "Behavioral",
    magnitude: "64pp EV divergence at 1¢",
    summary: "YES buyers disproportionately buy at longshot prices due to UI default bias. At 1¢: YES buyers EV = -41%, NO buyers EV = +23% (64pp divergence). NO outperforms YES at 69 of 99 price levels.",
    dataSource: "72.1M trades, $18.26B notional volume analysis",
    strategy: "Default to selling YES / buying NO at longshot prices. Dollar-weighted: YES buyers return -1.02%, NO buyers +0.83%.",
    status: "Active",
  },
  {
    id: 3,
    name: "Market Maker Role + Liquidity Incentive",
    category: "Speed",
    magnitude: "2.24pp excess return vs takers",
    summary: "Makers earn +1.12% avg excess return vs takers at -1.12% (2.24pp gap). Kalshi rebate: 0.05% maker vs 0.2%+ taker fee.",
    dataSource: "Kalshi fee schedule, maker/taker fill data",
    strategy: "Place resting limit orders close to best bid/ask, rebalance every 30-60 seconds to maintain maker status and capture rebates.",
    status: "Configured",
  },
  {
    id: 4,
    name: "Cross-Platform Arbitrage",
    category: "Cross-Platform",
    magnitude: "Gross spreads >5% (15-20% of time)",
    summary: "Gross spreads >5% occur ~15-20% of the time vs Polymarket. Polymarket generally leads Kalshi in price discovery. Most active in Fed rate decisions and macro events. Windows last seconds to minutes.",
    dataSource: "Polymarket API, Kalshi orderbook",
    strategy: "Monitor Polymarket vs Kalshi price divergence. Execute simultaneously when gap exceeds 5% net of fees.",
    status: "Not Configured",
  },
  {
    id: 5,
    name: "Weather Markets — Model vs. Crowd",
    category: "Informational",
    magnitude: "85-90% documented win rate",
    summary: "GFS 31-member ensemble from Open-Meteo (free). NOAA METAR for same-day temperature. 6 brackets per contract (2 wide outer, 4 inner ~2°F each). 5-day forecasts ~90% accurate, 7-day ~80%.",
    dataSource: "Open-Meteo GFS ensemble, NOAA METAR API",
    strategy: "Fetch GFS ensemble probability distribution for each weather bracket. Bet when model edge > 5% vs market implied probability.",
    status: "Active",
  },
  {
    id: 6,
    name: "Economic Data Release Markets",
    category: "Informational",
    magnitude: "Kalshi MAE 40.1% lower than Wall Street",
    summary: "Kalshi MAE on CPI 40.1% lower than Wall Street consensus. When Kalshi diverges from Bloomberg consensus >0.1pp, Kalshi right 75-81%. Kalshi perfect record on most probable FOMC outcome.",
    dataSource: "Bloomberg consensus API, FRED economic data",
    strategy: "Buy Kalshi-implied bracket when divergence from Bloomberg consensus exceeds 0.1pp. Focus on CPI, GDP, FOMC outcomes.",
    status: "Active",
  },
  {
    id: 7,
    name: "Intra-Market (Linked Contract) Arbitrage",
    category: "Structural",
    magnitude: "Risk-free when sum ≠ $1.00",
    summary: "Sum of mutually exclusive brackets must = $1. Buy-all arb: sum < $1.00 → buy one of each bracket. Sell-all arb: sum > $1.00 → sell one of each bracket. Fleeting (seconds), but bots catch them.",
    dataSource: "Real-time Kalshi orderbook across all brackets",
    strategy: "Monitor bracket series continuously. Execute buy-all when sum < $0.97 or sell-all when sum > $1.03 (after fees).",
    status: "Not Configured",
  },
  {
    id: 8,
    name: "Speed & Late-Market Repricing",
    category: "Speed",
    magnitude: "12-24hr repricing lag on breaking news",
    summary: "Econ data: 30min halt before release, stale prices before halt. Live sports: TV 10s+ latency vs direct data feeds. Breaking news: 12-24hr full repricing lag.",
    dataSource: "Low-latency news feeds, SportRadar/ESPN API",
    strategy: "Subscribe to low-latency news feeds. For sports, use direct data (not TV feed). Monitor for breaking news that hasn't repriced yet.",
    status: "Not Configured",
  },
  {
    id: 9,
    name: "Sports Market — Statistical Model vs. Fan Bias",
    category: "Behavioral",
    magnitude: "2.23pp maker-taker gap",
    summary: "Sports = 72% of Kalshi notional volume. 2.23pp maker-taker gap from fan loyalty bias. KenPom (NCAA), ELO (NBA/NFL), 538 models. Kelly Criterion: f* = (bp - q) / b.",
    dataSource: "SportRadar, FantasyLabs, KenPom, 538 ELO ratings",
    strategy: "Run ELO/KenPom model. Bet opposite of crowd sentiment when statistical edge > 3%. Fractional Kelly 25-50%, track Closing Line Value.",
    status: "Active",
  },
  {
    id: 10,
    name: "Macro Thesis / AI & Tech Event Markets",
    category: "Informational",
    magnitude: "12-24hr repricing lag post-announcement",
    summary: "Thinly traded (~$3-15M liquidity), wide spreads. GitHub commit activity for AI release front-running. SEC EDGAR for IPO/filing signals. 12-24hr repricing lags after announcements.",
    dataSource: "GitHub API (commit activity), SEC EDGAR filings",
    strategy: "Monitor GitHub commit velocity for major AI repos. Watch SEC filings for IPO/M&A signals. Enter positions before announcements reprice market.",
    status: "Not Configured",
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  Structural: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Behavioral: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Informational: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  Speed: "bg-red-500/20 text-red-400 border-red-500/30",
  "Cross-Platform": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const STATUS_CONFIG = {
  Active: { color: "bg-profit/20 text-profit border-profit/30", icon: CheckCircle2 },
  Configured: { color: "bg-blue-400/20 text-blue-400 border-blue-400/30", icon: Settings2 },
  "Not Configured": { color: "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30", icon: XCircle },
};

type Edge = typeof EDGES_INITIAL[0];

function EdgeCard({ edge, isActive, onToggle }: { edge: Edge; isActive: boolean; onToggle: (id: number, active: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  // Compute displayed status based on active override
  const displayStatus = isActive
    ? "Active"
    : edge.status === "Active"
    ? "Not Configured"
    : edge.status;
  const statusCfg = STATUS_CONFIG[displayStatus as keyof typeof STATUS_CONFIG] || STATUS_CONFIG["Not Configured"];
  const StatusIcon = statusCfg.icon;

  return (
    <Card
      className="hover:bg-muted/20 transition-colors"
      data-testid={`edge-card-${edge.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-7 h-7 rounded-md bg-muted/60 flex items-center justify-center text-xs font-bold mono text-muted-foreground cursor-pointer"
            onClick={() => setExpanded(!expanded)}
          >
            {edge.id}
          </div>
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-foreground">{edge.name}</span>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 border ${CATEGORY_COLORS[edge.category] || "bg-muted/30"}`}
              >
                {edge.category}
              </Badge>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 border flex items-center gap-1 ${statusCfg.color}`}
              >
                <StatusIcon className="w-2.5 h-2.5" />
                {displayStatus}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mb-2">{edge.summary}</div>
            <div className="text-xs mono text-primary/80 font-medium">Edge magnitude: {edge.magnitude}</div>
          </div>

          {/* Activate/Deactivate toggle */}
          <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <span className="text-xs text-muted-foreground">{isActive ? "Active" : "Inactive"}</span>
            <Switch
              checked={isActive}
              onCheckedChange={checked => onToggle(edge.id, checked)}
              data-testid={`switch-edge-${edge.id}`}
            />
          </div>

          <div className="flex-shrink-0 text-muted-foreground cursor-pointer" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-border/50 space-y-3 text-xs">
            <div>
              <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Strategy</div>
              <div className="text-foreground/80">{edge.strategy}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Data Source Required</div>
              <div className="text-foreground/70 mono">{edge.dataSource}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-2">Implementation Checklist</div>
              <div className="space-y-1.5">
                {[
                  { label: "Data source connected", done: isActive },
                  { label: "Model configured", done: isActive && edge.status !== "Not Configured" },
                  { label: "Risk parameters set", done: true },
                  { label: "Backtested", done: edge.status === "Active" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2">
                    {item.done ? (
                      <CheckCircle2 className="w-3 h-3 text-profit shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                    )}
                    <span className={item.done ? "text-foreground/70" : "text-muted-foreground/50"}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CustomBarTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-3 py-2 text-xs shadow-md">
      <div className="text-muted-foreground mb-0.5">{payload[0]?.payload?.category}</div>
      <div className="mono font-semibold text-foreground">{payload[0]?.value?.toFixed(2)} pp gap</div>
    </div>
  );
};

export default function Alpha() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { toast } = useToast();

  // Active state stored in React state (no localStorage due to iframe sandbox)
  const [activeEdges, setActiveEdges] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    EDGES_INITIAL.forEach(e => {
      initial[e.id] = e.status === "Active";
    });
    return initial;
  });

  const handleToggle = (id: number, active: boolean) => {
    setActiveEdges(prev => ({ ...prev, [id]: active }));
    const edge = EDGES_INITIAL.find(e => e.id === id);
    toast({
      title: active ? "Edge activated" : "Edge deactivated",
      description: `${edge?.name || `Edge ${id}`} is now ${active ? "active" : "inactive"}.`,
    });
  };

  const activeCount = Object.values(activeEdges).filter(Boolean).length;
  const configuredCount = EDGES_INITIAL.filter(e => e.status === "Configured").length;
  const totalCount = EDGES_INITIAL.length;

  const filtered = statusFilter === "all"
    ? EDGES_INITIAL
    : statusFilter === "Active"
    ? EDGES_INITIAL.filter(e => activeEdges[e.id])
    : statusFilter === "Not Active"
    ? EDGES_INITIAL.filter(e => !activeEdges[e.id])
    : EDGES_INITIAL.filter(e => e.status === statusFilter);

  return (
    <div className="p-4 space-y-4">
      {/* Header KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Active Strategies</div>
            <div className="text-xl font-semibold mono text-profit">{activeCount}</div>
            <div className="text-xs text-muted-foreground">of {totalCount} edges</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Configured</div>
            <div className="text-xl font-semibold mono text-blue-400">{activeCount + configuredCount}</div>
            <div className="text-xs text-muted-foreground">ready to deploy</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Best Category Gap</div>
            <div className="text-xl font-semibold mono text-red-400">7.32pp</div>
            <div className="text-xs text-muted-foreground">World Events</div>
          </CardContent>
        </Card>
      </div>

      {/* Category Edge Heatmap */}
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Category Edge Heatmap — Maker-Taker Gap by Category</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={CATEGORY_HEATMAP}
              layout="vertical"
              margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
            >
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "hsl(215, 20%, 55%)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}pp`}
                domain={[0, 8]}
              />
              <YAxis
                type="category"
                dataKey="category"
                tick={{ fontSize: 10, fill: "hsl(215, 20%, 55%)" }}
                tickLine={false}
                axisLine={false}
                width={100}
              />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="gap" radius={[0, 3, 3, 0]}>
                {CATEGORY_HEATMAP.map((entry) => (
                  <Cell key={entry.category} fill={entry.color} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-3 h-2 rounded-sm inline-block" style={{ background: "#b91c1c" }} />
            <span>Highest gap (darkest red = best edge opportunity)</span>
            <span className="ml-4 w-3 h-2 rounded-sm inline-block" style={{ background: "#3b82f6" }} />
            <span>Lowest gap (near-efficient)</span>
          </div>
        </CardContent>
      </Card>

      {/* Edge Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Filter:</span>
        {["all", "Active", "Not Active", "Configured", "Not Configured"].map(f => (
          <Button
            key={f}
            variant={statusFilter === f ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setStatusFilter(f)}
          >
            {f === "all" ? "All Edges" : f}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground mono">{filtered.length} edges</span>
      </div>

      {/* Edge Cards */}
      <div className="space-y-2">
        {filtered.map((edge) => (
          <EdgeCard
            key={edge.id}
            edge={edge}
            isActive={activeEdges[edge.id] ?? false}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}
