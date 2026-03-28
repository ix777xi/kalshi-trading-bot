import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Save, Play, Pause, Square, Key, Bell, Bot, Cpu, Wifi, WifiOff, TestTube, Trash2, CheckCircle2, XCircle } from "lucide-react";

type Settings = {
  id: number; kalshiApiKey: string; kalshiApiKeyId: string;
  hasPrivateKey: boolean;
  notifyOnSignal: boolean; notifyOnFill: boolean; minEdgeAlert: number;
  scanFrequency: number; llmModel: string; updatedAt: string;
};

type Portfolio = { botStatus: string };

type ConnectionStatus = "idle" | "testing" | "connected" | "failed";

export default function SettingsPage() {
  const { toast } = useToast();

  const { data: settings, isLoading: sLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const { data: portfolioData } = useQuery<{ portfolio: Portfolio }>({
    queryKey: ["/api/portfolio"],
  });

  const [form, setForm] = useState<Partial<Settings & { kalshiPrivateKey: string }>>({});
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [connectionMsg, setConnectionMsg] = useState("");
  const [showClearKeyConfirm, setShowClearKeyConfirm] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  const updateSettings = useMutation({
    mutationFn: (data: Partial<Settings & { kalshiPrivateKey: string }>) =>
      apiRequest("PUT", "/api/settings", data),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setPrivateKeyInput(""); // Clear the input after save
      toast({ title: "Settings saved", description: "Your settings have been saved successfully." });
      // Auto-test connection if a private key was provided or exists
      if (privateKeyInput.trim() || settings?.hasPrivateKey) {
        await handleTestConnection();
      }
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e?.message || "Failed to save settings", variant: "destructive" });
    },
  });

  const clearKeyMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/settings", { clearPrivateKey: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setConnectionStatus("idle");
      setConnectionMsg("");
      setShowClearKeyConfirm(false);
      toast({ title: "Private key cleared", description: "Your RSA private key has been removed." });
    },
    onError: (e: any) => {
      toast({ title: "Clear failed", description: e?.message || "Failed to clear key", variant: "destructive" });
      setShowClearKeyConfirm(false);
    },
  });

  const controlBot = useMutation({
    mutationFn: (action: string) => apiRequest("POST", "/api/bot/control", { action }),
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({ title: `Bot ${action}`, description: `Bot has been set to ${action}.` });
    },
    onError: (e: any) => {
      toast({ title: "Bot control failed", description: e?.message, variant: "destructive" });
    },
  });

  const handleTestConnection = async () => {
    setConnectionStatus("testing");
    setConnectionMsg("");
    try {
      const result = await apiRequest("GET", "/api/live/test");
      const data = result as any;
      if (data && data.balance !== undefined) {
        const balanceDollars = (data.balance / 100).toFixed(2);
        setConnectionStatus("connected");
        setConnectionMsg(`Connected — Balance: $${balanceDollars}`);
        toast({ title: "Connection successful", description: `Balance: $${balanceDollars}` });
      } else if (data?.error) {
        setConnectionStatus("failed");
        setConnectionMsg(data.error);
        toast({ title: "Connection failed", description: data.error, variant: "destructive" });
      } else {
        setConnectionStatus("connected");
        setConnectionMsg("Connected successfully");
        toast({ title: "Connection successful" });
      }
    } catch (e: any) {
      setConnectionStatus("failed");
      setConnectionMsg(e?.message || "Connection failed");
      toast({ title: "Connection failed", description: e?.message || "Connection failed", variant: "destructive" });
    }
  };

  const handleSave = () => {
    const payload: any = { ...form };
    if (privateKeyInput.trim()) {
      payload.kalshiPrivateKey = privateKeyInput.trim();
    } else {
      delete payload.kalshiPrivateKey;
    }
    updateSettings.mutate(payload);
  };

  const botStatus = portfolioData?.portfolio?.botStatus || "stopped";

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      {/* Bot Controls */}
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Bot Controls</CardTitle>
          <Badge
            variant="outline"
            className={`ml-auto text-xs ${botStatus === "running" ? "text-profit border-profit/40" : botStatus === "paused" ? "text-warning-amt border-warning-amt/40" : "text-muted-foreground"}`}
          >
            {botStatus}
          </Badge>
        </CardHeader>
        <CardContent className="p-4 pt-0 flex gap-2 flex-wrap">
          <Button
            variant="default"
            size="sm"
            data-testid="button-bot-start"
            onClick={() => controlBot.mutate("running")}
            disabled={botStatus === "running" || controlBot.isPending}
          >
            <Play className="w-3.5 h-3.5 mr-1.5" /> Start
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="button-bot-pause"
            onClick={() => controlBot.mutate("paused")}
            disabled={botStatus === "paused" || controlBot.isPending}
          >
            <Pause className="w-3.5 h-3.5 mr-1.5" /> Pause
          </Button>
          <Button
            variant="destructive"
            size="sm"
            data-testid="button-bot-stop"
            onClick={() => controlBot.mutate("stopped")}
            disabled={botStatus === "stopped" || controlBot.isPending}
          >
            <Square className="w-3.5 h-3.5 mr-1.5" /> Stop
          </Button>
        </CardContent>
      </Card>

      {/* API Configuration */}
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <Key className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Kalshi API Configuration</CardTitle>
          {settings?.hasPrivateKey && (
            <Badge variant="outline" className="ml-auto text-xs text-profit border-profit/40">
              Private Key Configured
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          {sLoading ? <Skeleton className="h-40" /> : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">API Key ID</Label>
                <Input
                  data-testid="input-api-key-id"
                  value={form.kalshiApiKeyId || ""}
                  onChange={e => setForm(f => ({ ...f, kalshiApiKeyId: e.target.value }))}
                  className="h-9 text-sm mono"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">RSA Private Key (PEM)</Label>
                <Textarea
                  data-testid="input-private-key"
                  value={privateKeyInput}
                  onChange={e => setPrivateKeyInput(e.target.value)}
                  className="font-mono text-xs resize-none"
                  rows={8}
                  placeholder={
                    settings?.hasPrivateKey
                      ? "••••••••••••••••••••••••••••••••\n(Private key is configured — paste new key to replace)"
                      : "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {settings?.hasPrivateKey
                    ? "A private key is saved. Leave blank to keep the existing key, or paste a new one to replace it."
                    : "Paste your RSA private key PEM. It will be stored server-side and never sent back to the browser."}
                </p>
              </div>

              {/* Connection Test */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="button-test-connection"
                  onClick={handleTestConnection}
                  disabled={connectionStatus === "testing" || !settings?.hasPrivateKey}
                >
                  <TestTube className="w-3.5 h-3.5 mr-1.5" />
                  {connectionStatus === "testing" ? "Testing..." : "Test Connection"}
                </Button>

                {settings?.hasPrivateKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-loss border-loss/40 hover:bg-loss/10"
                    data-testid="button-clear-private-key"
                    onClick={() => setShowClearKeyConfirm(true)}
                    disabled={clearKeyMutation.isPending}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Clear Private Key
                  </Button>
                )}

                {connectionStatus === "idle" && !settings?.hasPrivateKey && (
                  <span className="text-xs text-muted-foreground">Save a private key first to test</span>
                )}
              </div>

              {/* Connection status — more prominent */}
              {connectionStatus === "connected" && (
                <div className="flex items-center gap-2.5 p-3 rounded-md bg-profit/10 border border-profit/30" data-testid="status-connection-ok">
                  <CheckCircle2 className="w-4 h-4 text-profit shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-profit">Connected</div>
                    <div className="text-xs text-muted-foreground">{connectionMsg}</div>
                  </div>
                </div>
              )}
              {connectionStatus === "failed" && (
                <div className="flex items-center gap-2.5 p-3 rounded-md bg-loss/10 border border-loss/30" data-testid="status-connection-fail">
                  <XCircle className="w-4 h-4 text-loss shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-loss">Connection Failed</div>
                    <div className="text-xs text-muted-foreground">{connectionMsg}</div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Notifications</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          {sLoading ? <Skeleton className="h-24" /> : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Notify on Signal</div>
                  <div className="text-xs text-muted-foreground">Alert when a new trading signal is generated</div>
                </div>
                <Switch
                  data-testid="switch-notify-signal"
                  checked={!!form.notifyOnSignal}
                  onCheckedChange={v => setForm(f => ({ ...f, notifyOnSignal: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Notify on Fill</div>
                  <div className="text-xs text-muted-foreground">Alert when an order is filled</div>
                </div>
                <Switch
                  data-testid="switch-notify-fill"
                  checked={!!form.notifyOnFill}
                  onCheckedChange={v => setForm(f => ({ ...f, notifyOnFill: v }))}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Minimum Edge Alert (%)</Label>
                  <span className="text-xs font-medium mono">{form.minEdgeAlert || 5}%</span>
                </div>
                <Slider
                  min={1} max={20} step={0.5}
                  value={[form.minEdgeAlert || 5]}
                  onValueChange={([v]) => setForm(f => ({ ...f, minEdgeAlert: v }))}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* LLM Configuration */}
      <Card>
        <CardHeader className="p-4 pb-2 flex flex-row items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">LLM Configuration</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          {sLoading ? <Skeleton className="h-24" /> : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Probability Model</Label>
                <Select
                  value={form.llmModel || "gpt-4o"}
                  onValueChange={v => setForm(f => ({ ...f, llmModel: v }))}
                >
                  <SelectTrigger className="h-9 text-sm" data-testid="select-llm-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                    <SelectItem value="gpt-4o-mini">GPT-4o-mini</SelectItem>
                    <SelectItem value="claude-3-5-sonnet">Claude 3.5 Sonnet</SelectItem>
                    <SelectItem value="claude-3-haiku">Claude 3 Haiku</SelectItem>
                    <SelectItem value="ensemble">LLM Ensemble</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Scan Frequency (seconds)</Label>
                  <span className="text-xs font-medium mono">{form.scanFrequency || 30}s</span>
                </div>
                <Slider
                  min={10} max={300} step={10}
                  value={[form.scanFrequency || 30]}
                  onValueChange={([v]) => setForm(f => ({ ...f, scanFrequency: v }))}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Save */}
      <Button
        className="w-full"
        data-testid="button-save-settings"
        onClick={handleSave}
        disabled={updateSettings.isPending}
      >
        <Save className="w-4 h-4 mr-2" />
        {updateSettings.isPending ? "Saving..." : "Save Settings"}
      </Button>

      {/* Clear Key Confirmation Dialog */}
      <AlertDialog open={showClearKeyConfirm} onOpenChange={setShowClearKeyConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Private Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove your RSA private key? Live trading will be disabled until you add a new key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-clear-key"
              onClick={() => clearKeyMutation.mutate()}
              disabled={clearKeyMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {clearKeyMutation.isPending ? "Clearing..." : "Clear Private Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
