import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  ChevronDown, Zap, AlertTriangle, RefreshCw, Clock, SlidersHorizontal,
  Filter, ArrowUpDown, Sparkles, Info, Layers, PieChart, Scale,
  ArrowRight, Activity, Database, Timer, ChevronRight
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
  modelProbability: number;
  alphaEdgeName: string;
  historicalAvgReturn: number;
  categoryMultiplier: number;
  dataSource: string;
  confidenceLow: number;
  confidenceHigh: number;
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

type PickModification = { contracts: number; priceCents: number };

type SortOption = "edge" | "confidence" | "cost" | "pickScore" | "category";

// ── Edge metadata (mirrors backend) ────────────────────────────────────────────

const EDGE_INFO: Record<string, { description: string; magnitude: string; status: string }> = {
  "Favorite-Longshot Bias": {
    description: "Heavy favorites win more often than prices imply. Structural mispricing from retail longshot preference.",
    magnitude: "~16pp mispricing at 5¢",
    status: "Active",
  },
  "YES/NO Asymmetry": {
    description: "YES buyers pay an optimism premium. Systematic overpricing of YES contracts due to retail sentiment bias.",
    magnitude: "~64% excess return on NO",
    status: "Active",
  },
  "Market Maker Spread": {
    description: "Wide spreads in illiquid markets allow post-only limit orders to capture the bid-ask spread plus maker rebate.",
    magnitude: "+1.12% avg excess return vs takers",
    status: "Active",
  },
  "GFS Weather Ensemble": {
    description: "30-member GFS ensemble provides probability distributions that diverge from market consensus on weather events.",
    magnitude: "~15pp avg divergence",
    status: "Active",
  },
  "Custom Edge": {
    description: "Multi-source signal combining multiple data inputs for edge detection.",
    magnitude: "Variable",
    status: "Active",
  },
};

// ── Helper functions ───────────────────────────────────────────────────────────

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

function hoursUntil(closeTime: string): number {
  if (!closeTime) return 999;
  return (new Date(closeTime).getTime() - Date.now()) / 3_600_000;
}

function hoursUntilLabel(closeTime: string): string {
  if (!closeTime) return "";
  const hrs = hoursUntil(closeTime);
  if (hrs < 1) return `${Math.round(hrs * 60)}m`;
  if (hrs < 24) return `${hrs.toFixed(0)}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function getTimeDecay(closeTime: string): { label: string; color: string } {
  const hrs = hoursUntil(closeTime);
  if (hrs < 2) return { label: "Fresh", color: "text-profit" };
  if (hrs < 12) return { label: "Aging", color: "text-amber-400" };
  return { label: "Stale risk", color: "text-red-400" };
}

function getCorrelationLevel(count: number): { label: string; color: string } {
  if (count <= 1) return { label: "Low", color: "text-profit" };
  if (count <= 3) return { label: "Med", color: "text-amber-400" };
  return { label: "High", color: "text-red-400" };
}

function getEffectiveValues(pick: Pick, mod: PickModification | undefined) {
  const contracts = mod?.contracts ?? pick.contracts;
  const priceCents = mod?.priceCents ?? pick.priceCents;
  const estimatedCost = (contracts * priceCents) / 100;
  const maxProfit = (contracts * (100 - priceCents)) / 100;
  return { contracts, priceCents, estimatedCost, maxProfit };
}

// ── Alpha Edge Badge with Popover ──────────────────────────────────────────────

function AlphaEdgeBadge({ edgeName, dataSource }: { edgeName: string; dataSource: string }) {
  const info = EDGE_INFO[edgeName] || EDGE_INFO["Custom Edge"];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors cursor-pointer"
          data-testid="badge-alpha-edge"
        >
          <Sparkles className="w-2.5 h-2.5" />
          {edgeName}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 bg-card border-border" side="top" align="start">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">{edgeName}</span>
            <Badge variant="outline" className="text-[9px] px-1 border-profit/30 text-profit">
              {info.status}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{info.description}</p>
          <Separator className="bg-border/40" />
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <span className="text-muted-foreground">Magnitude: </span>
              <span className="font-medium">{info.magnitude}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Source: </span>
              <span className="font-medium">{dataSource}</span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Insights Mini-Grid ─────────────────────────────────────────────────────────

function InsightsGrid({
  pick,
  categoryCount,
  portfolioPercent,
}: {
  pick: Pick;
  categoryCount: number;
  portfolioPercent: number;
}) {
  const isYes = pick.side === "yes";
  const modelPct = (pick.modelProbability * 100).toFixed(0);
  const marketPct = pick.priceCents.toString();
  const divergence = ((pick.modelProbability - pick.priceCents / 100) * 100).toFixed(1);
  const divPositive = isYes ? pick.modelProbability > pick.priceCents / 100 : pick.modelProbability < pick.priceCents / 100;
  const correlation = getCorrelationLevel(categoryCount);

  return (
    <div className="grid grid-cols-4 gap-2 text-[10px]" data-testid="insights-grid">
      {/* Model vs Market */}
      <div className="bg-muted/20 rounded-md p-2 space-y-1">
        <div className="text-muted-foreground flex items-center gap-1">
          <Activity className="w-2.5 h-2.5" />
          Model vs Market
        </div>
        <div className="flex items-center gap-1">
          <span className="mono font-semibold">{modelPct}¢</span>
          <span className="text-muted-foreground">vs</span>
          <span className="mono font-semibold">{marketPct}¢</span>
        </div>
        <span className={`mono font-bold ${divPositive ? "text-profit" : "text-loss"}`}>
          {divPositive ? "+" : ""}{divergence}%
        </span>
      </div>

      {/* Correlation */}
      <div className="bg-muted/20 rounded-md p-2 space-y-1">
        <div className="text-muted-foreground flex items-center gap-1">
          <Layers className="w-2.5 h-2.5" />
          Correlation
        </div>
        <Badge variant="outline" className={`text-[9px] px-1 border ${correlation.color === "text-profit" ? "border-profit/30" : correlation.color === "text-amber-400" ? "border-amber-500/30" : "border-red-500/30"}`}>
          <span className={correlation.color}>{correlation.label}</span>
        </Badge>
        <div className="text-muted-foreground">{categoryCount} in {pick.category}</div>
      </div>

      {/* Portfolio Impact */}
      <div className="bg-muted/20 rounded-md p-2 space-y-1">
        <div className="text-muted-foreground flex items-center gap-1">
          <PieChart className="w-2.5 h-2.5" />
          Portfolio %
        </div>
        <div className="mono font-semibold">{portfolioPercent.toFixed(1)}%</div>
        <Progress value={Math.min(portfolioPercent, 100)} className="h-1" />
      </div>

      {/* Historical Edge */}
      <div className="bg-muted/20 rounded-md p-2 space-y-1">
        <div className="text-muted-foreground flex items-center gap-1">
          <Database className="w-2.5 h-2.5" />
          Hist. Edge
        </div>
        <div className="mono font-semibold text-profit">
          {pick.historicalAvgReturn > 0 ? "+" : ""}{pick.historicalAvgReturn.toFixed(1)}%
        </div>
        <div className="text-muted-foreground">{pick.alphaEdgeName.split(" ")[0]}</div>
      </div>
    </div>
  );
}

// ── Enhanced "Why This Pick" ───────────────────────────────────────────────────

function WhyThisPick({ pick }: { pick: Pick }) {
  const timeDecay = getTimeDecay(pick.closeTime);
  const theoreticalEdge = Math.abs(pick.executableEdge) + 0.02;
  const spreadCost = 0.02;
  const netEdge = Math.abs(pick.executableEdge);
  const confLow = (pick.confidenceLow * 100).toFixed(0);
  const confHigh = (pick.confidenceHigh * 100).toFixed(0);
  const confPoint = (pick.confidence * 100).toFixed(0);
  const confBarLeft = pick.confidenceLow * 100;
  const confBarWidth = (pick.confidenceHigh - pick.confidenceLow) * 100;
  const confPointPos = pick.confidence * 100;

  return (
    <div className="mt-2 bg-muted/20 rounded-lg p-3 border border-border/40 space-y-3">
      {/* Source Attribution */}
      <div className="flex items-center gap-2 text-[10px]">
        <Database className="w-3 h-3 text-blue-400" />
        <span className="text-muted-foreground">Source:</span>
        <span className="font-medium">{pick.dataSource}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">Cat multiplier:</span>
        <span className="mono font-medium">{pick.categoryMultiplier.toFixed(1)}×</span>
      </div>

      {/* Confidence Band */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground flex items-center gap-1">
            <Target className="w-3 h-3" />
            Confidence Band
          </span>
          <span className="mono font-medium">{confLow}%–{confHigh}% (est. {confPoint}%)</span>
        </div>
        <div className="relative h-3 bg-muted/40 rounded-full overflow-hidden">
          <div
            className="absolute h-full bg-blue-500/30 rounded-full"
            style={{ left: `${confBarLeft}%`, width: `${confBarWidth}%` }}
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-blue-400"
            style={{ left: `${confPointPos}%` }}
          />
        </div>
      </div>

      {/* Time Decay */}
      <div className="flex items-center gap-2 text-[10px]">
        <Timer className="w-3 h-3 text-amber-400" />
        <span className="text-muted-foreground">Signal freshness:</span>
        <Badge variant="outline" className={`text-[9px] px-1.5 border ${timeDecay.color === "text-profit" ? "border-profit/30" : timeDecay.color === "text-amber-400" ? "border-amber-500/30" : "border-red-500/30"}`}>
          <span className={timeDecay.color}>{timeDecay.label}</span>
        </Badge>
        <span className="text-muted-foreground">
          {pick.closeTime ? `closes in ${hoursUntilLabel(pick.closeTime)}` : ""}
        </span>
      </div>

      {/* Edge Breakdown Pipeline */}
      <div className="space-y-1">
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Zap className="w-3 h-3" />
          Edge Breakdown
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          <div className="bg-profit/10 border border-profit/20 rounded px-2 py-1">
            <div className="text-muted-foreground">Theoretical</div>
            <div className="mono font-semibold text-profit">+{(theoreticalEdge * 100).toFixed(1)}%</div>
          </div>
          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
          <div className="bg-loss/10 border border-loss/20 rounded px-2 py-1">
            <div className="text-muted-foreground">Spread cost</div>
            <div className="mono font-semibold text-loss">−{(spreadCost * 100).toFixed(1)}%</div>
          </div>
          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
          <div className="bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1">
            <div className="text-muted-foreground">Net executable</div>
            <div className="mono font-bold text-blue-400">+{(netEdge * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* Reasoning text */}
      <Separator className="bg-border/30" />
      <p className="text-xs text-foreground/80 leading-relaxed">{pick.reasoning}</p>
    </div>
  );
}

// ── Pick Card (Enhanced) ──────────────────────────────────────────────────────

function PickCard({
  pick,
  selected,
  onToggle,
  executed,
  executedDetail,
  modification,
  onModify,
  categoryCount,
  totalSelectedCost,
}: {
  pick: Pick;
  selected: boolean;
  onToggle: () => void;
  executed: boolean;
  executedDetail?: ApproveResult["details"][0];
  modification: PickModification | undefined;
  onModify: (mod: PickModification | undefined) => void;
  categoryCount: number;
  totalSelectedCost: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showSliders, setShowSliders] = useState(false);
  const isYes = pick.side === "yes";

  const eff = getEffectiveValues(pick, modification);
  const isModified = modification !== undefined;
  const portfolioPercent = totalSelectedCost > 0 ? (eff.estimatedCost / totalSelectedCost) * 100 : 0;

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
                  {isModified && (
                    <Badge variant="outline" className="text-[9px] px-1.5 border border-amber-500/30 text-amber-400">
                      Modified
                    </Badge>
                  )}
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
                  closes in {hoursUntilLabel(pick.closeTime)}
                </Badge>
              )}
              {/* Enhancement 6: Alpha Edge Badge */}
              <AlphaEdgeBadge edgeName={pick.alphaEdgeName} dataSource={pick.dataSource} />
            </div>

            {/* Trade summary */}
            <div className="flex items-center gap-4 text-xs bg-muted/20 rounded-md px-3 py-2">
              <div>
                <span className="text-muted-foreground">Contracts: </span>
                <span className={`mono font-semibold ${isModified ? "text-amber-400" : ""}`}>{eff.contracts}</span>
              </div>
              <div>
                <span className="text-muted-foreground">× </span>
                <span className={`mono font-semibold ${isModified ? "text-amber-400" : ""}`}>{eff.priceCents}¢</span>
              </div>
              <div>
                <span className="text-muted-foreground">= </span>
                <span className={`mono font-semibold ${isModified ? "text-amber-400" : ""}`}>${eff.estimatedCost.toFixed(2)}</span>
              </div>
              <div className="ml-auto">
                <span className="text-muted-foreground">Max profit: </span>
                <span className={`mono font-semibold text-profit ${isModified ? "underline decoration-amber-500/50" : ""}`}>${eff.maxProfit.toFixed(2)}</span>
              </div>
              {/* Modify toggle */}
              {!executed && (
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                  onClick={() => setShowSliders(!showSliders)}
                  data-testid={`button-modify-${pick.ticker}`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Enhancement 1: Inline sliders */}
            {showSliders && !executed && (
              <div className="bg-muted/10 border border-border/30 rounded-lg p-3 space-y-3" data-testid={`sliders-${pick.ticker}`}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">Contracts</span>
                    <span className="mono font-semibold">{eff.contracts}</span>
                  </div>
                  <Slider
                    value={[eff.contracts]}
                    min={1}
                    max={100}
                    step={1}
                    onValueChange={([v]) => onModify({ contracts: v, priceCents: eff.priceCents })}
                    data-testid={`slider-contracts-${pick.ticker}`}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">Price (cents)</span>
                    <span className="mono font-semibold">{eff.priceCents}¢</span>
                  </div>
                  <Slider
                    value={[eff.priceCents]}
                    min={1}
                    max={99}
                    step={1}
                    onValueChange={([v]) => onModify({ contracts: eff.contracts, priceCents: v })}
                    data-testid={`slider-price-${pick.ticker}`}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <button
                    className="text-muted-foreground hover:text-foreground underline transition-colors"
                    onClick={() => { onModify(undefined); setShowSliders(false); }}
                    data-testid={`button-reset-${pick.ticker}`}
                  >
                    Reset to original
                  </button>
                  <div className="mono text-muted-foreground">
                    Cost: ${eff.estimatedCost.toFixed(2)} · Profit: ${eff.maxProfit.toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            {/* Enhancement 2: Insights Grid */}
            {selected && (
              <InsightsGrid
                pick={pick}
                categoryCount={categoryCount}
                portfolioPercent={portfolioPercent}
              />
            )}

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

            {/* Enhancement 3: Expandable reasoning (upgraded) */}
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
                <WhyThisPick pick={pick} />
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

// ── Batch Modification Toolbar ─────────────────────────────────────────────────

function BatchToolbar({
  picks,
  categories,
  selectedCategories,
  onCategoryToggle,
  sortBy,
  onSortChange,
  onScaleContracts,
  onMaxCost,
}: {
  picks: Pick[];
  categories: string[];
  selectedCategories: Set<string>;
  onCategoryToggle: (cat: string) => void;
  sortBy: SortOption;
  onSortChange: (s: SortOption) => void;
  onScaleContracts: (factor: number) => void;
  onMaxCost: (max: number) => void;
}) {
  const [maxCostInput, setMaxCostInput] = useState("");

  return (
    <div className="flex items-center gap-2 flex-wrap bg-muted/10 rounded-lg p-2 border border-border/30" data-testid="batch-toolbar">
      {/* Scale Contracts */}
      <Select onValueChange={(v) => onScaleContracts(parseFloat(v))} data-testid="select-scale">
        <SelectTrigger className="h-7 w-[130px] text-[11px] bg-background border-border/50" data-testid="select-scale-trigger">
          <Scale className="w-3 h-3 mr-1" />
          <SelectValue placeholder="Scale ×" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="0.5">All × 0.5</SelectItem>
          <SelectItem value="0.75">All × 0.75</SelectItem>
          <SelectItem value="1">All × 1.0</SelectItem>
          <SelectItem value="1.25">All × 1.25</SelectItem>
          <SelectItem value="1.5">All × 1.5</SelectItem>
          <SelectItem value="2">All × 2.0</SelectItem>
        </SelectContent>
      </Select>

      {/* Max Cost */}
      <div className="flex items-center gap-1">
        <input
          type="number"
          placeholder="Max $"
          className="h-7 w-[80px] text-[11px] bg-background border border-border/50 rounded-md px-2 text-foreground placeholder:text-muted-foreground"
          value={maxCostInput}
          onChange={(e) => setMaxCostInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && maxCostInput) {
              onMaxCost(parseFloat(maxCostInput));
            }
          }}
          data-testid="input-max-cost"
        />
        {maxCostInput && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={() => onMaxCost(parseFloat(maxCostInput))}
            data-testid="button-apply-max-cost"
          >
            Apply
          </Button>
        )}
      </div>

      {/* Category Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1" data-testid="button-category-filter">
            <Filter className="w-3 h-3" />
            Category
            {selectedCategories.size < categories.length && (
              <Badge className="ml-1 h-4 px-1 text-[9px] bg-primary/20 text-primary">
                {selectedCategories.size}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2 bg-card border-border" side="bottom" align="start">
          <div className="space-y-1">
            {categories.map((cat) => (
              <label
                key={cat}
                className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/20 rounded px-2 py-1"
              >
                <Checkbox
                  checked={selectedCategories.has(cat)}
                  onCheckedChange={() => onCategoryToggle(cat)}
                  data-testid={`checkbox-cat-${cat.replace(/\s+/g, "-")}`}
                  className="h-3.5 w-3.5"
                />
                {cat}
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Sort By */}
      <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortOption)}>
        <SelectTrigger className="h-7 w-[120px] text-[11px] bg-background border-border/50" data-testid="select-sort">
          <ArrowUpDown className="w-3 h-3 mr-1" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="edge">Edge</SelectItem>
          <SelectItem value="confidence">Confidence</SelectItem>
          <SelectItem value="cost">Cost</SelectItem>
          <SelectItem value="pickScore">Pick Score</SelectItem>
          <SelectItem value="category">Category</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Pre-Submission Simulation Modal ────────────────────────────────────────────

function SimulationModal({
  open,
  onClose,
  onProceed,
  picks,
  modifications,
}: {
  open: boolean;
  onClose: () => void;
  onProceed: () => void;
  picks: Pick[];
  modifications: Map<string, PickModification>;
}) {
  const rows = picks.map((p) => {
    const eff = getEffectiveValues(p, modifications.get(p.id));
    return { pick: p, ...eff };
  });

  const totalCost = rows.reduce((s, r) => s + r.estimatedCost, 0);
  const totalMaxProfit = rows.reduce((s, r) => s + r.maxProfit, 0);
  const avgEdge = rows.length > 0 ? rows.reduce((s, r) => s + Math.abs(r.pick.executableEdge), 0) / rows.length : 0;
  const expectedValue = rows.reduce((s, r) => s + r.maxProfit * r.pick.confidence - r.estimatedCost * (1 - r.pick.confidence), 0);
  const riskAdjReturn = totalCost > 0 ? (expectedValue / totalCost) * 100 : 0;

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  for (const r of rows) {
    categoryBreakdown[r.pick.category] = (categoryBreakdown[r.pick.category] || 0) + r.estimatedCost;
  }
  const catEntries = Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]);
  const catMaxCost = catEntries.length > 0 ? catEntries[0][1] : 1;

  // Correlation warnings
  const categoryCounts: Record<string, number> = {};
  for (const r of rows) {
    categoryCounts[r.pick.category] = (categoryCounts[r.pick.category] || 0) + 1;
  }
  const correlated = Object.entries(categoryCounts).filter(([, c]) => c >= 2);

  // Cost scenarios
  const bestCase = totalMaxProfit;
  const worstCase = -totalCost;
  const expectedCase = expectedValue;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[85vh] overflow-y-auto" data-testid="simulation-modal">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-400" />
            Pre-Submission Simulation
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Review your portfolio before executing
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Portfolio Summary */}
          <div className="grid grid-cols-4 gap-2" data-testid="sim-portfolio-summary">
            <div className="bg-muted/20 rounded-md p-2 text-center">
              <div className="text-xs text-muted-foreground">Total Cost</div>
              <div className="mono font-bold text-sm">${totalCost.toFixed(2)}</div>
            </div>
            <div className="bg-muted/20 rounded-md p-2 text-center">
              <div className="text-xs text-muted-foreground">Max Profit</div>
              <div className="mono font-bold text-sm text-profit">${totalMaxProfit.toFixed(2)}</div>
            </div>
            <div className="bg-muted/20 rounded-md p-2 text-center">
              <div className="text-xs text-muted-foreground">Exp. Value</div>
              <div className={`mono font-bold text-sm ${expectedValue >= 0 ? "text-profit" : "text-loss"}`}>
                ${expectedValue.toFixed(2)}
              </div>
            </div>
            <div className="bg-muted/20 rounded-md p-2 text-center">
              <div className="text-xs text-muted-foreground">Risk-Adj.</div>
              <div className={`mono font-bold text-sm ${riskAdjReturn >= 0 ? "text-profit" : "text-loss"}`}>
                {riskAdjReturn.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="space-y-2" data-testid="sim-category-breakdown">
            <div className="text-xs font-medium flex items-center gap-1">
              <PieChart className="w-3 h-3" />
              Category Allocation
            </div>
            {catEntries.map(([cat, cost]) => (
              <div key={cat} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 text-muted-foreground truncate">{cat}</span>
                <div className="flex-1 h-3 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/50 rounded-full"
                    style={{ width: `${(cost / catMaxCost) * 100}%` }}
                  />
                </div>
                <span className="mono w-14 text-right">${cost.toFixed(2)}</span>
                <span className="mono w-10 text-right text-muted-foreground">
                  {totalCost > 0 ? ((cost / totalCost) * 100).toFixed(0) : 0}%
                </span>
              </div>
            ))}
          </div>

          {/* Correlation Warning */}
          {correlated.length > 0 && (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 text-[11px] text-amber-400" data-testid="sim-correlation-warning">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                <span className="font-medium">Correlation warning: </span>
                {correlated.map(([cat, count]) => `${count} picks in ${cat}`).join(", ")}
              </div>
            </div>
          )}

          {/* Cost Scenarios */}
          <div className="space-y-1" data-testid="sim-cost-scenarios">
            <div className="text-xs font-medium">Scenarios</div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="bg-profit/10 rounded-md p-2 text-center">
                <div className="text-muted-foreground">Best (all win)</div>
                <div className="mono font-bold text-profit">${bestCase.toFixed(2)}</div>
              </div>
              <div className="bg-blue-500/10 rounded-md p-2 text-center">
                <div className="text-muted-foreground">Expected</div>
                <div className={`mono font-bold ${expectedCase >= 0 ? "text-blue-400" : "text-loss"}`}>${expectedCase.toFixed(2)}</div>
              </div>
              <div className="bg-loss/10 rounded-md p-2 text-center">
                <div className="text-muted-foreground">Worst (all lose)</div>
                <div className="mono font-bold text-loss">${worstCase.toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* Individual Pick Summary Table */}
          <div className="space-y-1" data-testid="sim-picks-table">
            <div className="text-xs font-medium">Picks Summary</div>
            <div className="border border-border/30 rounded-md overflow-hidden">
              <div className="grid grid-cols-6 gap-1 text-[9px] uppercase tracking-wide text-muted-foreground bg-muted/20 px-2 py-1">
                <span>Ticker</span>
                <span>Side</span>
                <span className="text-right">Contracts</span>
                <span className="text-right">Cost</span>
                <span className="text-right">Edge</span>
                <span className="text-right">Conf.</span>
              </div>
              {rows.map((r) => (
                <div key={r.pick.id} className="grid grid-cols-6 gap-1 text-[10px] px-2 py-1 border-t border-border/20">
                  <span className="mono truncate">{r.pick.ticker.slice(0, 12)}</span>
                  <Badge
                    variant="outline"
                    className={`text-[8px] px-1 w-fit ${r.pick.side === "yes" ? "border-profit/30 text-profit" : "border-loss/30 text-loss"}`}
                  >
                    {r.pick.side === "yes" ? "YES" : "NO"}
                  </Badge>
                  <span className="mono text-right">{r.contracts}</span>
                  <span className="mono text-right">${r.estimatedCost.toFixed(2)}</span>
                  <span className="mono text-right text-profit">{(Math.abs(r.pick.executableEdge) * 100).toFixed(1)}%</span>
                  <span className="mono text-right">{(r.pick.confidence * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs" data-testid="button-sim-go-back">
            Go Back
          </Button>
          <Button
            size="sm"
            className="bg-profit hover:bg-profit/90 text-black font-semibold text-xs gap-1.5"
            onClick={onProceed}
            data-testid="button-sim-proceed"
          >
            <Zap className="w-3.5 h-3.5" />
            Proceed to Execute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function TodaysPicks() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSimulation, setShowSimulation] = useState(false);
  const [executionResult, setExecutionResult] = useState<ApproveResult | null>(null);
  const [executedTickers, setExecutedTickers] = useState<Set<string>>(new Set());
  const [modifications, setModifications] = useState<Map<string, PickModification>>(new Map());
  const [sortBy, setSortBy] = useState<SortOption>("edge");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
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

  // Derive unique categories
  const categories = useMemo(() => {
    const cats = [...new Set(picks.map((p) => p.category))];
    cats.sort();
    return cats;
  }, [picks]);

  // Initialize categories on first load
  useEffect(() => {
    if (categories.length > 0 && selectedCategories.size === 0) {
      setSelectedCategories(new Set(categories));
    }
  }, [categories.length]);

  // Auto-select all on first load
  useEffect(() => {
    if (picks.length > 0 && selectedIds.size === 0) {
      setSelectedIds(new Set(picks.map((p) => p.id)));
    }
  }, [picks.length]);

  // Category counts for correlation
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of picks) {
      if (selectedIds.has(p.id)) {
        counts[p.category] = (counts[p.category] || 0) + 1;
      }
    }
    return counts;
  }, [picks, selectedIds]);

  // Filter and sort picks
  const filteredPicks = useMemo(() => {
    let result = picks.filter((p) => selectedCategories.has(p.category));
    result.sort((a, b) => {
      switch (sortBy) {
        case "edge": return Math.abs(b.executableEdge) - Math.abs(a.executableEdge);
        case "confidence": return b.confidence - a.confidence;
        case "cost": {
          const costA = getEffectiveValues(a, modifications.get(a.id)).estimatedCost;
          const costB = getEffectiveValues(b, modifications.get(b.id)).estimatedCost;
          return costB - costA;
        }
        case "pickScore": return b.pickScore - a.pickScore;
        case "category": return a.category.localeCompare(b.category);
        default: return 0;
      }
    });
    return result;
  }, [picks, selectedCategories, sortBy, modifications]);

  // Compute totals using effective (modified) values
  const selectedPicks = picks.filter((p) => selectedIds.has(p.id));
  const totalSelectedCost = selectedPicks.reduce((s, p) => {
    const eff = getEffectiveValues(p, modifications.get(p.id));
    return s + eff.estimatedCost;
  }, 0);
  const totalSelectedProfit = selectedPicks.reduce((s, p) => {
    const eff = getEffectiveValues(p, modifications.get(p.id));
    return s + eff.maxProfit;
  }, 0);

  const toggleAll = () => {
    if (selectedIds.size === filteredPicks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPicks.map((p) => p.id)));
    }
  };

  const togglePick = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const handleScaleContracts = useCallback((factor: number) => {
    setModifications((prev) => {
      const next = new Map(prev);
      for (const p of picks) {
        if (!selectedIds.has(p.id)) continue;
        const current = next.get(p.id);
        const baseContracts = current?.contracts ?? p.contracts;
        const basePriceCents = current?.priceCents ?? p.priceCents;
        const scaled = Math.max(1, Math.round(baseContracts * factor));
        next.set(p.id, { contracts: scaled, priceCents: basePriceCents });
      }
      return next;
    });
  }, [picks, selectedIds]);

  const handleMaxCost = useCallback((maxCost: number) => {
    if (maxCost <= 0) return;
    const currentTotal = selectedPicks.reduce((s, p) => {
      const eff = getEffectiveValues(p, modifications.get(p.id));
      return s + eff.estimatedCost;
    }, 0);
    if (currentTotal <= maxCost) return;
    const scaleFactor = maxCost / currentTotal;

    setModifications((prev) => {
      const next = new Map(prev);
      for (const p of selectedPicks) {
        const current = next.get(p.id);
        const baseContracts = current?.contracts ?? p.contracts;
        const basePriceCents = current?.priceCents ?? p.priceCents;
        const scaled = Math.max(1, Math.round(baseContracts * scaleFactor));
        next.set(p.id, { contracts: scaled, priceCents: basePriceCents });
      }
      return next;
    });
  }, [selectedPicks, modifications]);

  const handleModify = (pickId: string, mod: PickModification | undefined) => {
    setModifications((prev) => {
      const next = new Map(prev);
      if (mod === undefined) {
        next.delete(pickId);
      } else {
        next.set(pickId, mod);
      }
      return next;
    });
  };

  // Build picks with effective values for submission
  const getSubmitPicks = () => {
    return selectedPicks.map((p) => {
      const eff = getEffectiveValues(p, modifications.get(p.id));
      return { ...p, contracts: eff.contracts, priceCents: eff.priceCents, estimatedCost: eff.estimatedCost, maxProfit: eff.maxProfit };
    });
  };

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "./api/todays-picks/approve-all", {
        picks: getSubmitPicks(),
      });
      return res.json() as Promise<ApproveResult>;
    },
    onSuccess: (result) => {
      setExecutionResult(result);
      const executedTickerSet = new Set(
        result.details.filter((d) => d.status === "executed" || d.status === "approved").map((d) => d.ticker)
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
    <TooltipProvider>
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
            {/* Enhancement 4: Batch Modification Toolbar */}
            <BatchToolbar
              picks={picks}
              categories={categories}
              selectedCategories={selectedCategories}
              onCategoryToggle={toggleCategory}
              sortBy={sortBy}
              onSortChange={setSortBy}
              onScaleContracts={handleScaleContracts}
              onMaxCost={handleMaxCost}
            />

            {/* Select all header */}
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                id="select-all"
                checked={selectedIds.size === filteredPicks.length && filteredPicks.length > 0}
                onCheckedChange={toggleAll}
                data-testid="checkbox-select-all"
                className="border-border/60"
              />
              <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer">
                Select all ({filteredPicks.length} picks)
              </label>
              {modifications.size > 0 && (
                <Badge variant="outline" className="text-[9px] px-1.5 border border-amber-500/30 text-amber-400 ml-2">
                  {modifications.size} modified
                </Badge>
              )}
            </div>

            {/* Cards */}
            <div className="space-y-3">
              {filteredPicks.map((pick) => (
                <PickCard
                  key={pick.id}
                  pick={pick}
                  selected={selectedIds.has(pick.id)}
                  onToggle={() => togglePick(pick.id)}
                  executed={executedTickers.has(pick.ticker)}
                  executedDetail={executionResult?.details.find((d) => d.ticker === pick.ticker)}
                  modification={modifications.get(pick.id)}
                  onModify={(mod) => handleModify(pick.id, mod)}
                  categoryCount={categoryCounts[pick.category] || 0}
                  totalSelectedCost={totalSelectedCost}
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
                  {modifications.size > 0 && (
                    <span className="text-amber-400 ml-1">({modifications.size} modified)</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mono">
                  ${totalSelectedCost.toFixed(2)} cost · ${totalSelectedProfit.toFixed(2)} max profit
                </div>
              </div>
              <Button
                size="sm"
                className="bg-profit hover:bg-profit/90 text-black font-semibold px-5 h-10 gap-2 shrink-0"
                onClick={() => setShowSimulation(true)}
                disabled={approveMutation.isPending}
                data-testid="button-approve-all"
              >
                <Zap className="w-4 h-4" />
                Approve & Execute Selected
              </Button>
            </div>
          </div>
        )}

        {/* Enhancement 5: Simulation Modal */}
        <SimulationModal
          open={showSimulation}
          onClose={() => setShowSimulation(false)}
          onProceed={() => {
            setShowSimulation(false);
            setShowConfirm(true);
          }}
          picks={selectedPicks}
          modifications={modifications}
        />

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
    </TooltipProvider>
  );
}
