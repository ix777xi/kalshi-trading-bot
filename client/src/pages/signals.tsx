import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { Zap } from "lucide-react";

function getEdgeType(ticker: string): { label: string; color: string } {
  const t = ticker.toUpperCase();
  if (/TEMP|RAIN|WEATH|HIGH|LOW|SNOW|KXHIGH/i.test(t)) {
    return { label: "Weather Model", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" };
  }
  if (/FED|CPI|GDP|UNEM|RATE|ECON|KXFED|KXCPI|KXGDP/i.test(t)) {
    return { label: "Macro Divergence", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  }
  if (/NBA|NFL|NHL|MLB|SPORT|GAME|PTS|REB|AST|SUPERBOWL|KXNBA|KXNFL/i.test(t)) {
    return { label: "Sports Bias", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" };
  }
  if (/BTC|ETH|CRYPTO|COIN|KXBTC|KXETH/i.test(t)) {
    return { label: "Cross-Platform", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };
  }
  if (/PRES|SENATE|ELEC|GOV|VOTE|POLI/i.test(t)) {
    return { label: "YES/NO Asymmetry", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
  }
  if (/AAPL|TSLA|NVDA|STOCK|SPX|NDX|NFLX|KXINX/i.test(t)) {
    return { label: "Longshot Bias", color: "bg-orange-500/20 text-orange-400 border-orange-500/40" };
  }
  return { label: "Longshot Bias", color: "bg-orange-500/20 text-orange-400 border-orange-500/40" };
}

type Signal = {
  id: number; ticker: string; edgeScore: number; trueProbability: number;
  marketPrice: number; signalType: string; modelConfidence: number;
  modelName: string; createdAt: string;
};

export default function Signals() {
  const [filterType, setFilterType] = useState("all");
  const [minEdge, setMinEdge] = useState("");

  const { data: signals, isLoading } = useQuery<Signal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 15000,
  });

  const filtered = (signals || []).filter(s => {
    if (filterType !== "all" && s.signalType !== filterType) return false;
    if (minEdge && Math.abs(s.edgeScore) < parseFloat(minEdge)) return false;
    return true;
  });

  const buyYes = (signals || []).filter(s => s.signalType === "BUY_YES").length;
  const buyNo = (signals || []).filter(s => s.signalType === "BUY_NO").length;
  const noTrade = (signals || []).filter(s => s.signalType === "NO_TRADE").length;

  return (
    <div className="p-4 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-2 h-8 rounded bg-profit" />
            <div>
              <div className="text-xs text-muted-foreground">BUY YES</div>
              <div className="text-xl font-semibold mono text-profit">{buyYes}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-2 h-8 rounded bg-loss" />
            <div>
              <div className="text-xs text-muted-foreground">BUY NO</div>
              <div className="text-xl font-semibold mono text-loss">{buyNo}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-2 h-8 rounded bg-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">NO TRADE</div>
              <div className="text-xl font-semibold mono text-muted-foreground">{noTrade}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-36 h-9 text-sm" data-testid="select-signal-type">
            <SelectValue placeholder="Signal type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Signals</SelectItem>
            <SelectItem value="BUY_YES">BUY YES</SelectItem>
            <SelectItem value="BUY_NO">BUY NO</SelectItem>
            <SelectItem value="NO_TRADE">NO TRADE</SelectItem>
          </SelectContent>
        </Select>
        <Input
          data-testid="input-min-edge"
          type="number"
          placeholder="Min edge %"
          className="w-32 h-9 text-sm"
          value={minEdge}
          onChange={e => setMinEdge(e.target.value)}
        />
        <div className="text-xs text-muted-foreground mono ml-auto">{filtered.length} signals</div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-card z-10">
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Timestamp</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Ticker</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Signal</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Edge Type</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Edge Score</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">True Prob</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Mkt Price</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Confidence</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Model</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array(12).fill(0).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td colSpan={9} className="px-4 py-2"><Skeleton className="h-4" /></td>
                    </tr>
                  ))
                  : filtered.map(sig => {
                    const isYes = sig.signalType === "BUY_YES";
                    const isNo = sig.signalType === "BUY_NO";
                    const isNt = sig.signalType === "NO_TRADE";
                    const edgeColor = isYes ? "text-profit" : isNo ? "text-loss" : "text-muted-foreground";
                    const edgeType = getEdgeType(sig.ticker);
                    return (
                      <tr key={sig.id} data-testid={`signal-row-${sig.id}`} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2 mono text-muted-foreground">{format(parseISO(sig.createdAt), "MM/dd HH:mm")}</td>
                        <td className="px-4 py-2 font-medium mono">{sig.ticker}</td>
                        <td className="px-4 py-2">
                          <Badge
                            variant={isNt ? "secondary" : "outline"}
                            className={`text-xs ${isYes ? "border-profit text-profit" : isNo ? "border-loss text-loss" : ""}`}
                          >
                            {sig.signalType}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${edgeType.color}`}>
                            {edgeType.label}
                          </Badge>
                        </td>
                        <td className={`px-4 py-2 text-right mono font-semibold ${edgeColor}`}>
                          {sig.edgeScore > 0 ? "+" : ""}{sig.edgeScore.toFixed(2)}%
                        </td>
                        <td className="px-4 py-2 text-right mono">{(sig.trueProbability * 100).toFixed(1)}¢</td>
                        <td className="px-4 py-2 text-right mono text-muted-foreground">{(sig.marketPrice * 100).toFixed(1)}¢</td>
                        <td className="px-4 py-2 text-right mono">
                          <span className={`${sig.modelConfidence >= 0.8 ? "text-profit" : sig.modelConfidence >= 0.65 ? "text-foreground" : "text-muted-foreground"}`}>
                            {(sig.modelConfidence * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{sig.modelName}</td>
                      </tr>
                    );
                  })
                }
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      No signals match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
