import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { XCircle, Filter, Zap, Database, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Demo order type (from local DB)
type DemoOrder = {
  id: number; orderId: string; ticker: string; side: string; type: string;
  price: number; quantity: number; filledQty: number; status: string;
  createdAt: string; updatedAt: string;
};

// Live order type (from Kalshi API)
type LiveOrder = {
  order_id: string; ticker: string; side: string; action: string; type: string;
  status: string; yes_price: number; no_price: number;
  remaining_count: number; remaining_count_fp?: string;
  created_time: string; client_order_id?: string;
};

type Settings = { hasPrivateKey: boolean };

function statusBadge(status: string) {
  const variants: Record<string, string> = {
    filled: "text-profit border-profit/40",
    resting: "text-primary border-primary/40",
    open: "text-primary border-primary/40",
    partial: "text-warning-amt border-warning-amt/40",
    cancelled: "text-muted-foreground",
    canceled: "text-muted-foreground",
    rejected: "text-loss border-loss/40",
    pending: "text-warning-amt border-warning-amt/40",
  };
  return <Badge variant="outline" className={`text-xs ${variants[status] || ""}`}>{status}</Badge>;
}

export default function Orders() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [showCancelAllConfirm, setShowCancelAllConfirm] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();

  const { data: settingsData } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });
  const hasPrivateKey = settingsData?.hasPrivateKey ?? false;
  const isLive = mode === "live" && hasPrivateKey;

  // Demo orders
  const { data: demoOrders, isLoading: demoLoading, refetch: refetchDemo } = useQuery<DemoOrder[]>({
    queryKey: ["/api/orders"],
    refetchInterval: 15000,
    enabled: !isLive,
  });

  // Live orders
  const { data: liveOrdersData, isLoading: liveLoading, refetch: refetchLive } = useQuery<{ orders: LiveOrder[] }>({
    queryKey: ["/api/live/orders"],
    refetchInterval: 10000,
    enabled: isLive,
  });

  const isLoading = isLive ? liveLoading : demoLoading;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (isLive) {
        await refetchLive();
        const count = liveOrdersData?.orders?.length || 0;
        toast({ title: "Orders refreshed", description: `${count} orders loaded.` });
      } else {
        await refetchDemo();
        const count = demoOrders?.length || 0;
        toast({ title: "Orders refreshed", description: `${count} orders loaded.` });
      }
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e?.message, variant: "destructive" });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Cancel live order
  const cancelLiveMutation = useMutation({
    mutationFn: (orderId: string) => apiRequest("DELETE", `/api/live/orders/${orderId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/live/orders"] });
      toast({ title: "Order cancelled", description: "The order has been cancelled." });
    },
    onError: (e: any) => {
      toast({ title: "Cancel failed", description: e?.message, variant: "destructive" });
    },
  });

  // Cancel demo order
  const cancelDemoMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order cancelled", description: "The demo order has been cancelled." });
    },
    onError: (e: any) => {
      toast({ title: "Cancel failed", description: e?.message, variant: "destructive" });
    },
  });

  // Cancel all live orders
  const cancelAllMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/live/orders"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/live/orders"] });
      toast({ title: "All orders cancelled", description: `All ${openCount} open orders have been cancelled.` });
      setShowCancelAllConfirm(false);
    },
    onError: (e: any) => {
      toast({ title: "Cancel all failed", description: e?.message, variant: "destructive" });
      setShowCancelAllConfirm(false);
    },
  });

  // Cancel all demo orders mutation
  const cancelAllDemoMutation = useMutation({
    mutationFn: async () => {
      const openOrders = (demoOrders || []).filter(o => o.status === "open");
      await Promise.all(openOrders.map(o => apiRequest("DELETE", `/api/orders/${o.id}`)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "All orders cancelled", description: `All ${openCount} open demo orders have been cancelled.` });
      setShowCancelAllConfirm(false);
    },
    onError: (e: any) => {
      toast({ title: "Cancel all failed", description: e?.message, variant: "destructive" });
      setShowCancelAllConfirm(false);
    },
  });

  // Compute stats
  let openCount = 0;
  let filledCount = 0;
  let totalVolume = 0;

  if (isLive) {
    const liveOrders = liveOrdersData?.orders || [];
    openCount = liveOrders.filter(o => o.status === "resting" || o.status === "open").length;
    filledCount = liveOrders.filter(o => o.status === "filled").length;
    totalVolume = liveOrders.reduce((sum, o) => {
      const price = o.yes_price || o.no_price || 0;
      return sum + (price / 100) * (o.remaining_count || 0);
    }, 0);
  } else {
    const demoOrdersList = demoOrders || [];
    openCount = demoOrdersList.filter(o => o.status === "open").length;
    filledCount = demoOrdersList.filter(o => o.status === "filled").length;
    totalVolume = demoOrdersList.filter(o => o.status === "filled").reduce((sum, o) => sum + o.price * o.filledQty * 100, 0);
  }

  return (
    <div className="p-4 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Open Orders</div>
          <div className="text-xl font-semibold mono text-primary" data-testid="text-open-count">{openCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Filled Today</div>
          <div className="text-xl font-semibold mono text-profit" data-testid="text-filled-count">{filledCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total Volume</div>
          <div className="text-xl font-semibold mono" data-testid="text-total-volume">${totalVolume.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
        </CardContent></Card>
      </div>

      {/* Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Live/Demo toggle */}
        <div className="flex items-center rounded-md border border-border overflow-hidden shrink-0">
          <Button
            variant="ghost"
            size="sm"
            data-testid="button-mode-live"
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
            data-testid="button-mode-demo"
            className={`rounded-none h-9 px-3 text-xs gap-1.5 ${!isLive ? "bg-muted/50 text-foreground" : "text-muted-foreground"}`}
            onClick={() => setMode("demo")}
          >
            <Database className="w-3 h-3" />
            Demo
          </Button>
        </div>

        <Filter className="w-4 h-4 text-muted-foreground" />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36 h-9 text-sm" data-testid="select-order-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Orders</SelectItem>
            {isLive ? (
              <>
                <SelectItem value="resting">Resting</SelectItem>
                <SelectItem value="filled">Filled</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </>
            ) : (
              <>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="filled">Filled</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          data-testid="button-refresh-orders"
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>

        {openCount > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="text-xs ml-auto"
            data-testid="button-cancel-all"
            onClick={() => setShowCancelAllConfirm(true)}
            disabled={cancelAllMutation.isPending || cancelAllDemoMutation.isPending}
          >
            Cancel All Open
          </Button>
        )}

        <div className={`text-xs text-muted-foreground mono ${openCount === 0 ? "ml-auto" : ""}`}>
          {isLive
            ? `${(liveOrdersData?.orders || []).length} orders`
            : `${(demoOrders || []).length} orders`
          }
        </div>
      </div>

      {/* Live Orders Table */}
      {isLive && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Order ID</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Ticker</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Side</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Action</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Type</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Price</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Remaining</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Created</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {liveLoading
                    ? Array(8).fill(0).map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td colSpan={10} className="px-4 py-2"><Skeleton className="h-4" /></td>
                      </tr>
                    ))
                    : (liveOrdersData?.orders || [])
                      .filter(o => filterStatus === "all" || o.status === filterStatus)
                      .map(o => (
                        <tr key={o.order_id} data-testid={`live-order-row-${o.order_id}`} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2 mono text-muted-foreground text-[10px]">
                            {o.order_id.slice(0, 8)}...
                          </td>
                          <td className="px-4 py-2 font-medium mono">{o.ticker}</td>
                          <td className="px-4 py-2">
                            <span className={`font-medium ${o.side === "yes" ? "text-profit" : "text-loss"}`}>
                              {o.side?.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{o.action}</td>
                          <td className="px-4 py-2 text-muted-foreground">{o.type}</td>
                          <td className="px-4 py-2 text-right mono">
                            {o.yes_price ? `${o.yes_price}¢` : o.no_price ? `${o.no_price}¢` : "—"}
                          </td>
                          <td className="px-4 py-2 text-right mono">{o.remaining_count ?? "—"}</td>
                          <td className="px-4 py-2">{statusBadge(o.status)}</td>
                          <td className="px-4 py-2 text-muted-foreground mono">
                            {o.created_time
                              ? format(new Date(o.created_time), "MM/dd HH:mm")
                              : "—"}
                          </td>
                          <td className="px-4 py-2">
                            {(o.status === "resting" || o.status === "open") && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                data-testid={`button-cancel-live-order-${o.order_id}`}
                                onClick={() => cancelLiveMutation.mutate(o.order_id)}
                                disabled={cancelLiveMutation.isPending}
                              >
                                <XCircle className="w-3.5 h-3.5 text-loss" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                  }
                  {!liveLoading && (liveOrdersData?.orders || []).length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                        No live orders found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Demo Orders Table */}
      {!isLive && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Order ID</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Ticker</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Side</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Type</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Price</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Qty</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Filled</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Created</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {demoLoading
                    ? Array(12).fill(0).map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td colSpan={10} className="px-4 py-2"><Skeleton className="h-4" /></td>
                      </tr>
                    ))
                    : (demoOrders || [])
                      .filter(o => filterStatus === "all" || o.status === filterStatus)
                      .map(o => (
                        <tr key={o.id} data-testid={`order-row-${o.id}`} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2 mono text-muted-foreground">{o.orderId}</td>
                          <td className="px-4 py-2 font-medium mono">{o.ticker}</td>
                          <td className="px-4 py-2">
                            <span className={`font-medium ${o.side === "yes" ? "text-profit" : "text-loss"}`}>{o.side.toUpperCase()}</span>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{o.type}</td>
                          <td className="px-4 py-2 text-right mono">{(o.price * 100).toFixed(1)}¢</td>
                          <td className="px-4 py-2 text-right mono">{o.quantity}</td>
                          <td className="px-4 py-2 text-right mono">
                            <span className={o.filledQty === o.quantity ? "text-profit" : "text-muted-foreground"}>
                              {o.filledQty}/{o.quantity}
                            </span>
                          </td>
                          <td className="px-4 py-2">{statusBadge(o.status)}</td>
                          <td className="px-4 py-2 text-muted-foreground mono">{format(parseISO(o.createdAt), "MM/dd HH:mm")}</td>
                          <td className="px-4 py-2">
                            {o.status === "open" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                data-testid={`button-cancel-order-${o.id}`}
                                onClick={() => cancelDemoMutation.mutate(o.id)}
                                disabled={cancelDemoMutation.isPending}
                              >
                                <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancel All Confirmation */}
      <AlertDialog open={showCancelAllConfirm} onOpenChange={setShowCancelAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel All Orders</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure? This will cancel {openCount} open order{openCount !== 1 ? "s" : ""} {isLive ? "on Kalshi" : "in demo"}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-all-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-cancel-all-confirm"
              onClick={() => isLive ? cancelAllMutation.mutate() : cancelAllDemoMutation.mutate()}
              disabled={cancelAllMutation.isPending || cancelAllDemoMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {(cancelAllMutation.isPending || cancelAllDemoMutation.isPending) ? "Cancelling..." : "Cancel All Orders"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
