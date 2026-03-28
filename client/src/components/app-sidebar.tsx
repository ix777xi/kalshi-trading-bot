import { Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import {
  LayoutDashboard, TrendingUp, Zap, ShoppingCart, Briefcase,
  Shield, FlaskConical, ClipboardList, Settings, Activity,
  ChevronRight, Sparkles, User, Bot
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, group: "Overview" },
  { title: "Markets", url: "/markets", icon: TrendingUp, group: "Trading" },
  { title: "Signals", url: "/signals", icon: Zap, group: "Trading" },
  { title: "Orders", url: "/orders", icon: ShoppingCart, group: "Trading" },
  { title: "Positions", url: "/positions", icon: Briefcase, group: "Trading" },
  { title: "Risk", url: "/risk", icon: Shield, group: "Management" },
  { title: "Backtest", url: "/backtest", icon: FlaskConical, group: "Management" },
  { title: "Compliance", url: "/compliance", icon: ClipboardList, group: "Management" },
  { title: "Human in the Loop", url: "/hitl", icon: User, group: "Trading" },
  { title: "Alpha Edges", url: "/alpha", icon: Sparkles, group: "Strategy" },
  { title: "Bot Control", url: "/autonomous", icon: Bot, group: "Autonomous" },
  { title: "Settings", url: "/settings", icon: Settings, group: "System" },
];

// Preserve group order
const GROUP_ORDER = ["Overview", "Trading", "Management", "Strategy", "Autonomous", "System"];

const grouped = navItems.reduce((acc, item) => {
  if (!acc[item.group]) acc[item.group] = [];
  acc[item.group].push(item);
  return acc;
}, {} as Record<string, typeof navItems>);

export function AppSidebar() {
  const [location] = useHashLocation();

  const { data: portfolioData } = useQuery({
    queryKey: ["/api/portfolio"],
    refetchInterval: 30000,
  });

  const { data: botStatusData } = useQuery({
    queryKey: ["/api/bot/status"],
    refetchInterval: 10000,
  });

  const portfolio = (portfolioData as any)?.portfolio;
  const botStatus = portfolio?.botStatus || "stopped";
  const botMode = (botStatusData as any)?.mode || "hitl";
  const isHalted = botMode === "halted";

  const statusColor =
    botStatus === "running" ? "text-profit" :
    botStatus === "paused" ? "text-warning-amt" :
    "text-loss";

  const statusBg =
    botStatus === "running" ? "bg-profit" :
    botStatus === "paused" ? "bg-warning-amt" :
    "bg-loss";

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          {/* SVG Logo */}
          <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-label="KalshiBot logo">
            <rect width="32" height="32" rx="6" fill="hsl(217, 91%, 60%)" />
            <path d="M8 22 L14 12 L20 18 L26 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="26" cy="10" r="2.5" fill="white" />
            <path d="M8 26 L26 26" stroke="white" strokeWidth="1.5" strokeOpacity="0.4" strokeLinecap="round" />
          </svg>
          <div>
            <div className="text-sm font-semibold text-foreground tracking-tight">KalshiBot</div>
            <div className="flex items-center gap-1.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusBg} live-pulse`} />
              <span className={`text-xs font-medium mono capitalize ${statusColor}`}>{botStatus}</span>
            </div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        {GROUP_ORDER.filter(g => grouped[g]).map(group => {
          const items = grouped[group];
          return (
          <SidebarGroup key={group}>
            <SidebarGroupLabel className="text-xs text-muted-foreground/60 uppercase tracking-widest px-3 py-1">
              {group}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => {
                  const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild data-active={isActive}>
                        <Link href={item.url} className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-muted-foreground"}`}>
                          <item.icon className="w-4 h-4 shrink-0" />
                          <span>{item.title}</span>
                          {isActive && <ChevronRight className="w-3 h-3 ml-auto opacity-60" />}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-border">
        <div className="text-xs text-muted-foreground/50 text-center">
          <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
            Created with Perplexity Computer
          </a>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
