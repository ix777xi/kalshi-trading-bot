import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from "recharts";
import { Search, ChevronLeft, TrendingUp, ShoppingCart } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

type KalshiMarket = {
  ticker: string; title: string; subtitle?: string; status: string;
  category?: string; event_ticker?: string;
  yes_bid_dollars: string; yes_ask_dollars: string;
  no_bid_dollars: string; no_ask_dollars: string;
  volume_fp: string; volume_24h_fp: string;
  open_interest_fp: string; last_price_dollars: string;
  close_time: string; open_time: string;
};

type KalshiOrderbook = {
  orderbook_fp?: {
    yes_dollars: [string, string][];
    no_dollars: [string, string][];
  };
};

type MarketsResponse = { markets: KalshiMarket[]; cursor?: string };

type Settings = { hasPrivateKey: boolean };

type TradeForm = {
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  price: number; // cents 1-99
  postOnly: boolean;
};

function OrderbookChart({ data }: { data: KalshiOrderbook | undefined }) {
  if (!data?.orderbook_fp) return null;
  const { yes_dollars = [], no_dollars = [] } = data.orderbook_fp;

  const yesBids = yes_dollars.slice(0, 10).map(([price, qty]) => ({
    price: `${(parseFloat(price) * 100).toFixed(0)}¢`, qty: parseFloat(qty), side: "YES",
  }));
  const noBids = no_dollars.slice(0, 10).map(([price, qty]) => ({
    price: `${(parseFloat(price) * 100).toFixed(0)}¢`, qty: parseFloat(qty), side: "NO",
  }));

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="text-xs text-profit font-medium mb-2">YES Bids</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={yesBids} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(215, 20%, 55%)" }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="price" tick={{ fontSize: 9, fill: "hsl(215, 20%, 55%)" }} tickLine={false} axisLine={false} width={28} />
            <RechartsTooltip contentStyle={{ background: "hsl(215, 25%, 10%)", border: "1px solid hsl(215, 14%, 19%)", borderRadius: 6, fontSize: 11 }} />
            <Bar dataKey="qty" fill="#22c55e" radius={[0, 2, 2, 0]} opacity={0.8} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <div className="text-xs text-loss font-medium mb-2">NO Bids</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={noBids} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(215, 20%, 55%)" }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="price" tick={{ fontSize: 9, fill: "hsl(215, 20%, 55%)" }} tickLine={false} axisLine={false} width={28} />
            <RechartsTooltip contentStyle={{ background: "hsl(215, 25%, 10%)", border: "1px solid hsl(215, 14%, 19%)", borderRadius: 6, fontSize: 11 }} />
            <Bar dataKey="qty" fill="#ef4444" radius={[0, 2, 2, 0]} opacity={0.8} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TradePanel({ ticker, market }: { ticker: string; market: KalshiMarket | undefined }) {
  const { toast } = useToast();
  const [trade, setTrade] = useState<TradeForm>({
    side: "yes",
    action: "buy",
    count: 1,
    price: 50,
    postOnly: false,
  });
  const [showConfirm, setShowConfirm] = useState(false);

  const estimatedCost = (trade.count * trade.price / 100).toFixed(2);

  const placeMutation = useMutation({
    mutationFn: (orderBody: any) => apiRequest("POST", "/api/live/orders", orderBody),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/live/orders"] });
      const orderId = data?.order?.order_id || data?.order_id || "unknown";
      toast({
        title: "Order Placed",
        description: `Order ${orderId} submitted successfully`,
      });
      setShowConfirm(false);
    },
    onError: (e: any) => {
      toast({
        title: "Order Failed",
        description: e?.message || "Failed to place order",
        variant: "destructive",
      });
      setShowConfirm(false);
    },
  });

  const handlePlaceOrder = () => {
    const orderBody = {
      ticker,
      side: trade.side,
      action: trade.action,
      count: trade.count,
      type: "limit",
      yes_price: trade.price,
      client_order_id: crypto.randomUUID(),
      post_only: trade.postOnly,
    };
    placeMutation.mutate(orderBody);
  };

  return (
    <>
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Place Trade</CardTitle>
          <Badge variant="outline" className="ml-auto text-xs text-primary border-primary/40">LIVE</Badge>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          {/* Side toggle */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Side</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={trade.side === "yes" ? "default" : "outline"}
                size="sm"
                data-testid="button-side-yes"
                onClick={() => setTrade(t => ({ ...t, side: "yes" }))}
                className={trade.side === "yes" ? "bg-profit hover:bg-profit/90 text-white" : "border-profit/30 text-profit/70 hover:border-profit/60"}
              >
                YES
              </Button>
              <Button
                variant={trade.side === "no" ? "default" : "outline"}
                size="sm"
                data-testid="button-side-no"
                onClick={() => setTrade(t => ({ ...t, side: "no" }))}
                className={trade.side === "no" ? "bg-loss hover:bg-loss/90 text-white" : "border-loss/30 text-loss/70 hover:border-loss/60"}
              >
                NO
              </Button>
            </div>
          </div>

          {/* Action toggle */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Action</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={trade.action === "buy" ? "default" : "outline"}
                size="sm"
                data-testid="button-action-buy"
                onClick={() => setTrade(t => ({ ...t, action: "buy" }))}
              >
                BUY
              </Button>
              <Button
                variant={trade.action === "sell" ? "default" : "outline"}
                size="sm"
                data-testid="button-action-sell"
                onClick={() => setTrade(t => ({ ...t, action: "sell" }))}
              >
                SELL
              </Button>
            </div>
          </div>

          {/* Quantity */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Quantity (contracts)</Label>
            <Input
              data-testid="input-trade-quantity"
              type="number"
              min={1}
              value={trade.count}
              onChange={e => setTrade(t => ({ ...t, count: Math.max(1, parseInt(e.target.value) || 1) }))}
              className="h-9 text-sm mono"
            />
          </div>

          {/* Price slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Price</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs mono text-muted-foreground">${(trade.price / 100).toFixed(2)}</span>
                <Input
                  data-testid="input-trade-price"
                  type="number"
                  min={1}
                  max={99}
                  value={trade.price}
                  onChange={e => setTrade(t => ({ ...t, price: Math.max(1, Math.min(99, parseInt(e.target.value) || 1)) }))}
                  className="h-7 w-16 text-xs mono text-right"
                />
                <span className="text-xs text-muted-foreground">¢</span>
              </div>
            </div>
            <Slider
              min={1}
              max={99}
              step={1}
              value={[trade.price]}
              onValueChange={([v]) => setTrade(t => ({ ...t, price: v }))}
              data-testid="slider-trade-price"
            />
            <div className="flex justify-between text-xs text-muted-foreground mono">
              <span>1¢</span>
              <span>50¢</span>
              <span>99¢</span>
            </div>
          </div>

          {/* Estimated cost */}
          <div className="flex items-center justify-between p-3 rounded-md bg-muted/40 border border-border/50">
            <span className="text-xs text-muted-foreground">Estimated Cost</span>
            <span className="text-sm font-semibold mono" data-testid="text-estimated-cost">${estimatedCost}</span>
          </div>

          {/* Post only */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="post-only"
              data-testid="checkbox-post-only"
              checked={trade.postOnly}
              onCheckedChange={v => setTrade(t => ({ ...t, postOnly: !!v }))}
            />
            <Label htmlFor="post-only" className="text-xs cursor-pointer">
              Post Only <span className="text-muted-foreground">(reduced maker fees)</span>
            </Label>
          </div>

          {/* Place order */}
          <Button
            className="w-full"
            data-testid="button-place-order"
            onClick={() => setShowConfirm(true)}
            disabled={placeMutation.isPending}
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            {placeMutation.isPending ? "Placing..." : "Place Order"}
          </Button>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Order</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2 p-3 rounded-md bg-muted/40 text-xs">
                  <div>
                    <span className="text-muted-foreground">Market</span>
                    <div className="font-medium mono mt-0.5">{ticker}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Side</span>
                    <div className={`font-medium mt-0.5 ${trade.side === "yes" ? "text-profit" : "text-loss"}`}>
                      {trade.side.toUpperCase()}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Action</span>
                    <div className="font-medium mt-0.5">{trade.action.toUpperCase()}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Quantity</span>
                    <div className="font-medium mono mt-0.5">{trade.count} contracts</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Price</span>
                    <div className="font-medium mono mt-0.5">{trade.price}¢ (${(trade.price / 100).toFixed(2)})</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Est. Cost</span>
                    <div className="font-semibold mono mt-0.5">${estimatedCost}</div>
                  </div>
                </div>
                {trade.postOnly && (
                  <p className="text-xs text-muted-foreground">Post Only — order will only rest on the book (reduced fees).</p>
                )}
                <p className="text-xs text-muted-foreground">
                  This will place a real order on Kalshi. Please review carefully before confirming.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-place-order"
              onClick={handlePlaceOrder}
              disabled={placeMutation.isPending}
            >
              {placeMutation.isPending ? "Placing..." : "Confirm Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function Markets() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const { data: marketsData, isLoading } = useQuery<MarketsResponse>({
    queryKey: ["/api/kalshi/markets"],
    refetchInterval: 30000,
  });

  const { data: settingsData } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const { data: orderbookData, isLoading: obLoading } = useQuery<KalshiOrderbook>({
    queryKey: ["/api/kalshi/markets", selectedTicker, "orderbook"],
    queryFn: async () => {
      const resp = await apiRequest("GET", `/api/kalshi/markets/${encodeURIComponent(selectedTicker!)}/orderbook?depth=10`);
      return resp;
    },
    enabled: !!selectedTicker,
  });

  const markets = marketsData?.markets || [];

  // Derive category from event_ticker prefix
  function deriveCategory(m: KalshiMarket): string {
    const et = m.event_ticker || m.ticker || "";
    if (/NBA|NFL|NHL|MLB|SPORT|GAME|PTS|REB|AST/i.test(et)) return "Sports";
    if (/PRES|SENATE|ELEC|GOV|VOTE|POLI/i.test(et)) return "Politics";
    if (/FED|GDP|CPI|UNEM|RATE|ECON/i.test(et)) return "Economics";
    if (/TEMP|RAIN|WEATH|HIGH|LOW|SNOW/i.test(et)) return "Weather";
    if (/BTC|ETH|CRYPTO|COIN/i.test(et)) return "Crypto";
    if (/AAPL|TSLA|NVDA|STOCK|SPX|NDX/i.test(et)) return "Stocks";
    if (/MVE|CROSS/i.test(et)) return "Multi-Event";
    return "Other";
  }
  const categories = [...new Set(markets.map(deriveCategory).filter(Boolean))].sort();

  // Bias analysis based on longshot/favorite logic
  function getBias(m: KalshiMarket): { label: string; type: "longshot" | "favorite" | "neutral"; edge: string } {
    const yesBid = parseFloat(m.yes_bid_dollars || "0");
    if (yesBid > 0 && yesBid < 0.20) {
      const impliedEdge = ((yesBid - 0.0418) / 0.0418 * 100).toFixed(1);
      return { label: "LONGSHOT", type: "longshot", edge: `${impliedEdge}% misprice` };
    }
    if (yesBid >= 0.80) {
      const impliedEdge = ((yesBid - 0.85) / 0.85 * 100).toFixed(1);
      return { label: "FAVORITE", type: "favorite", edge: `+${Math.abs(Number(impliedEdge)).toFixed(1)}% EV` };
    }
    // Neutral zone
    const noEdge = yesBid > 0 ? ((1 - yesBid - 0.5) / 0.5 * 100).toFixed(1) : "0";
    return { label: "NEUTRAL", type: "neutral", edge: `${Number(noEdge) > 0 ? "+" : ""}${noEdge}% est` };
  }

  const filtered = markets.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = !q || m.ticker?.toLowerCase().includes(q) || m.title?.toLowerCase().includes(q);
    const cat = deriveCategory(m);
    const matchCat = category === "all" || cat === category;
    return matchSearch && matchCat;
  });

  const selectedMarket = markets.find(m => m.ticker === selectedTicker);
  const hasPrivateKey = settingsData?.hasPrivateKey ?? false;

  if (selectedTicker) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedTicker(null)} data-testid="button-back">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <span className="text-sm font-medium mono">{selectedTicker}</span>
          {selectedMarket && (
            <Badge variant="outline" className="text-xs">{selectedMarket.category || "—"}</Badge>
          )}
        </div>

        {selectedMarket && (
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-medium mb-3">{selectedMarket.title}</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">YES Bid</div>
                  <div className="mono text-profit font-medium">{parseFloat(selectedMarket.yes_bid_dollars) > 0 ? `${(parseFloat(selectedMarket.yes_bid_dollars) * 100).toFixed(1)}¢` : "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">NO Bid</div>
                  <div className="mono text-loss font-medium">{parseFloat(selectedMarket.no_bid_dollars) > 0 ? `${(parseFloat(selectedMarket.no_bid_dollars) * 100).toFixed(1)}¢` : "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Volume</div>
                  <div className="mono">{parseFloat(selectedMarket.volume_fp) > 0 ? parseFloat(selectedMarket.volume_fp).toLocaleString() : "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Open Interest</div>
                  <div className="mono">{parseFloat(selectedMarket.open_interest_fp) > 0 ? parseFloat(selectedMarket.open_interest_fp).toLocaleString() : "—"}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className={`grid gap-4 ${hasPrivateKey ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium">Orderbook Depth</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {obLoading ? (
                <Skeleton className="h-48" />
              ) : (
                <OrderbookChart data={orderbookData} />
              )}
              {!obLoading && !orderbookData?.orderbook_fp && (
                <div className="text-center text-muted-foreground text-sm py-8">
                  No orderbook data available for this market.
                </div>
              )}
            </CardContent>
          </Card>

          {hasPrivateKey && (
            <TradePanel ticker={selectedTicker} market={selectedMarket} />
          )}
        </div>

        {!hasPrivateKey && (
          <div className="text-xs text-muted-foreground text-center p-3 rounded-md border border-border/50 bg-muted/20">
            Configure your RSA private key in <span className="text-primary">Settings</span> to enable live trading.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            data-testid="input-market-search"
            placeholder="Search ticker or title..."
            className="pl-8 h-9 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-40 h-9 text-sm" data-testid="select-category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground mono ml-auto">
          {isLoading ? "..." : `${filtered.length} markets`}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Ticker</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Title</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Category</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">YES Bid</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">NO Bid</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Bias</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Volume</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">OI</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Book</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array(15).fill(0).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td colSpan={9} className="px-4 py-2"><Skeleton className="h-4" /></td>
                    </tr>
                  ))
                  : filtered.slice(0, 100).map(m => {
                    const bias = getBias(m);
                    const yesBid = parseFloat(m.yes_bid_dollars || "0");
                    return (
                    <tr
                      key={m.ticker}
                      className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                      data-testid={`market-row-${m.ticker}`}
                      onClick={() => setSelectedTicker(m.ticker)}
                    >
                      <td className="px-4 py-2 font-medium mono text-primary text-[11px]">
                        {m.ticker.length > 30 ? m.ticker.slice(-20) : m.ticker}
                      </td>
                      <td className="px-4 py-2 max-w-64 truncate text-foreground/80">{m.title}</td>
                      <td className="px-4 py-2">
                        <Badge variant="secondary" className="text-[10px]">{deriveCategory(m)}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right mono">
                        <div className="flex items-center justify-end gap-1.5">
                          {yesBid > 0 && yesBid < 0.20 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-500/50 text-orange-400 cursor-help">
                                  LONGSHOT
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs max-w-48">
                                Avoid buying — historically negative EV. 5¢ contracts win only 4.18% (implied 5%).
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {yesBid >= 0.80 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-[9px] px-1 py-0 border-profit/50 text-profit cursor-help">
                                  FAVORITE
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs max-w-48">
                                Historically outperforms implied probability. Favorites above 80¢ beat the market.
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <span className="text-profit">{yesBid > 0 ? `${(yesBid * 100).toFixed(1)}¢` : "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right mono text-loss">
                        {parseFloat(m.no_bid_dollars) > 0 ? `${(parseFloat(m.no_bid_dollars) * 100).toFixed(1)}¢` : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {bias.type !== "neutral" ? (
                          <span className={`text-[10px] mono font-medium ${
                            bias.type === "longshot" ? "text-orange-400" : "text-profit"
                          }`}>
                            {bias.edge}
                          </span>
                        ) : (
                          <span className="text-[10px] mono text-muted-foreground/50">{bias.edge}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right mono text-muted-foreground">
                        {parseFloat(m.volume_fp) > 0 ? parseFloat(m.volume_fp).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2 text-right mono text-muted-foreground">
                        {parseFloat(m.open_interest_fp) > 0 ? parseFloat(m.open_interest_fp).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <ChevronLeft className="w-3.5 h-3.5 rotate-180 text-muted-foreground inline" />
                      </td>
                    </tr>
                    );
                  })}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      No markets match your filter.
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
