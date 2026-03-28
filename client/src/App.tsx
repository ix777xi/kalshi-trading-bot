import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Markets from "@/pages/markets";
import Signals from "@/pages/signals";
import Orders from "@/pages/orders";
import Positions from "@/pages/positions";
import Risk from "@/pages/risk";
import Backtest from "@/pages/backtest";
import Compliance from "@/pages/compliance";
import SettingsPage from "@/pages/settings";
import Alpha from "@/pages/alpha";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

type Settings = { hasPrivateKey: boolean };

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/markets" component={Markets} />
      <Route path="/signals" component={Signals} />
      <Route path="/orders" component={Orders} />
      <Route path="/positions" component={Positions} />
      <Route path="/risk" component={Risk} />
      <Route path="/alpha" component={Alpha} />
      <Route path="/backtest" component={Backtest} />
      <Route path="/compliance" component={Compliance} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function LiveDemoBadge() {
  const { data: settingsData } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });
  const hasPrivateKey = settingsData?.hasPrivateKey ?? false;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground mono">
      {hasPrivateKey ? (
        <>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-profit live-pulse" />
          <span className="text-profit font-medium" data-testid="badge-live">LIVE</span>
        </>
      ) : (
        <>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="text-muted-foreground" data-testid="badge-demo">DEMO</span>
        </>
      )}
      <span className="text-border">|</span>
      <span>{new Date().toLocaleTimeString("en-US", { hour12: false })}</span>
    </div>
  );
}

function App() {
  // Force dark mode always for trading dashboard
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const sidebarStyle = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={sidebarStyle as React.CSSProperties}>
          <div className="flex h-screen w-full bg-background overflow-hidden">
            <AppSidebar />
            <div className="flex flex-col flex-1 min-w-0">
              <header className="flex items-center gap-2 h-11 px-4 border-b border-border bg-card/50 shrink-0">
                <SidebarTrigger data-testid="button-sidebar-toggle" className="h-7 w-7" />
                <div className="flex-1" />
                <LiveDemoBadge />
              </header>
              <main className="flex-1 overflow-y-auto overscroll-contain">
                <Router hook={useHashLocation}>
                  <AppRouter />
                </Router>
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
