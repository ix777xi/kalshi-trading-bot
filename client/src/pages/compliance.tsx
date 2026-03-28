import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { Download, AlertTriangle, CheckCircle2, Info } from "lucide-react";

type AuditLog = {
  id: number; eventType: string; ticker?: string; description: string;
  amount?: number; status: string; createdAt: string;
};

function eventBadge(type: string) {
  const map: Record<string, string> = {
    ORDER_PLACED: "text-primary",
    ORDER_FILLED: "text-profit",
    ORDER_CANCELLED: "text-muted-foreground",
    POSITION_OPENED: "text-primary",
    POSITION_CLOSED: "text-profit",
    RISK_BREACH: "text-warning-amt",
    BOT_CONTROL: "text-foreground",
  };
  return (
    <Badge variant="outline" className={`text-xs ${map[type] || ""}`}>
      {type.replace("_", " ")}
    </Badge>
  );
}

function statusIcon(status: string) {
  if (status === "ok") return <CheckCircle2 className="w-3.5 h-3.5 text-profit" />;
  if (status === "warning") return <AlertTriangle className="w-3.5 h-3.5 text-warning-amt" />;
  return <Info className="w-3.5 h-3.5 text-loss" />;
}

function downloadCSV(logs: AuditLog[]) {
  const header = "id,event_type,ticker,description,amount,status,created_at";
  const rows = logs.map(l =>
    `${l.id},${l.eventType},${l.ticker || ""},${JSON.stringify(l.description)},${l.amount || ""},${l.status},${l.createdAt}`
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kalshi-audit-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
}

export default function Compliance() {
  const { data: logs, isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/audit"],
  });

  const warnings = (logs || []).filter(l => l.status === "warning").length;
  const orders = (logs || []).filter(l => l.eventType.startsWith("ORDER")).length;
  const riskBreaches = (logs || []).filter(l => l.eventType === "RISK_BREACH").length;

  return (
    <div className="p-4 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total Events</div>
          <div className="text-xl font-semibold mono">{(logs || []).length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Risk Warnings</div>
          <div className={`text-xl font-semibold mono ${warnings > 0 ? "text-warning-amt" : "text-profit"}`}>{warnings}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Risk Breaches</div>
          <div className={`text-xl font-semibold mono ${riskBreaches > 0 ? "text-loss" : "text-profit"}`}>{riskBreaches}</div>
        </CardContent></Card>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          data-testid="button-export-csv"
          onClick={() => logs && downloadCSV(logs)}
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Export CSV (1099)
        </Button>
        <div className="text-xs text-muted-foreground mono ml-auto">{(logs || []).length} audit entries</div>
      </div>

      {/* Wash Trade Alert */}
      {warnings > 2 && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-warning-amt/10 border border-warning-amt/30 text-xs text-warning-amt">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Wash trade detection: {warnings} potential issues flagged. Review before year-end tax reporting.</span>
        </div>
      )}

      {/* Audit Log Table */}
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-1">
          <CardTitle className="text-sm font-medium">Audit Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Timestamp</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Event</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Ticker</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Description</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Amount</th>
                  <th className="text-center px-4 py-2.5 text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array(15).fill(0).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td colSpan={6} className="px-4 py-2"><Skeleton className="h-4" /></td>
                    </tr>
                  ))
                  : (logs || []).map(log => (
                    <tr key={log.id} data-testid={`audit-row-${log.id}`} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 mono text-muted-foreground whitespace-nowrap">
                        {format(parseISO(log.createdAt), "MM/dd HH:mm")}
                      </td>
                      <td className="px-4 py-2">{eventBadge(log.eventType)}</td>
                      <td className="px-4 py-2 mono font-medium">{log.ticker || "—"}</td>
                      <td className="px-4 py-2 text-foreground/80 max-w-xs">{log.description}</td>
                      <td className="px-4 py-2 text-right mono">
                        {log.amount != null ? `$${log.amount.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2 flex items-center justify-center">
                        {statusIcon(log.status)}
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
