import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Radio,
  Wifi,
  WifiOff,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Trophy,
  Calendar,
  AlertTriangle,
  DollarSign,
  Layers,
  RefreshCw,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

// ── Team name mapping ─────────────────────────────────────────────────────────
const TEAM_NAMES: Record<string, string> = {
  ATL: "Atlanta Hawks",
  BOS: "Boston Celtics",
  BKN: "Brooklyn Nets",
  CHA: "Charlotte Hornets",
  CHI: "Chicago Bulls",
  CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks",
  DEN: "Denver Nuggets",
  DET: "Detroit Pistons",
  GS:  "Golden State Warriors",
  GSW: "Golden State Warriors",
  HOU: "Houston Rockets",
  IND: "Indiana Pacers",
  LAC: "LA Clippers",
  LAL: "LA Lakers",
  MEM: "Memphis Grizzlies",
  MIA: "Miami Heat",
  MIL: "Milwaukee Bucks",
  MIN: "Minnesota Timberwolves",
  NO:  "New Orleans Pelicans",
  NOP: "New Orleans Pelicans",
  NY:  "New York Knicks",
  NYK: "New York Knicks",
  OKC: "Oklahoma City Thunder",
  ORL: "Orlando Magic",
  PHI: "Philadelphia 76ers",
  PHX: "Phoenix Suns",
  POR: "Portland Trail Blazers",
  SAC: "Sacramento Kings",
  SA:  "San Antonio Spurs",
  SAS: "San Antonio Spurs",
  TOR: "Toronto Raptors",
  UTA: "Utah Jazz",
  UTAH: "Utah Jazz",
  WAS: "Washington Wizards",
  WSH: "Washington Wizards",
};

function teamName(abbr: string): string {
  return TEAM_NAMES[abbr] ?? abbr;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface LiveGame {
  espnId: string;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  period: number;
  clock: string;
  status: "pre" | "in" | "post";
  kalshiHomeTicker: string | null;
  kalshiAwayTicker: string | null;
  kalshiHomePrice: number;
  kalshiAwayPrice: number;
  modelHomeProb: number;
  modelAwayProb: number;
  homeEdge: number;
  awayEdge: number;
  signal: "BUY_HOME" | "BUY_AWAY" | "SELL_HOME" | "SELL_AWAY" | "HOLD" | "NONE";
  reasoning: string;
  gameTime: string;
}

interface LiveSportsState {
  activeGames: LiveGame[];
  upcomingGames: LiveGame[];
  completedGames: LiveGame[];
  tradesToday: number;
  livePnl: number;
  activePositions: number;
  lastScan: string;
  engineRunning: boolean;
}

// ── Signal colour helpers ─────────────────────────────────────────────────────
function signalColor(signal: LiveGame["signal"]) {
  if (signal.startsWith("BUY")) return "text-profit border-profit/40 bg-profit/10";
  if (signal.startsWith("SELL")) return "text-loss border-loss/40 bg-loss/10";
  return "text-muted-foreground border-border bg-muted/20";
}

function signalLabel(signal: LiveGame["signal"], game: LiveGame): string {
  switch (signal) {
    case "BUY_HOME":  return `BUY ${game.home}`;
    case "BUY_AWAY":  return `BUY ${game.away}`;
    case "SELL_HOME": return `SELL ${game.home}`;
    case "SELL_AWAY": return `SELL ${game.away}`;
    case "HOLD":      return "HOLD";
    default:          return "NO SIGNAL";
  }
}

function periodLabel(period: number): string {
  if (period <= 4) return `Q${period}`;
  return `OT${period - 4}`;
}

// ── Probability Bar component ─────────────────────────────────────────────────
function ProbBar({ game }: { game: LiveGame }) {
  const awayProb = game.modelAwayProb;
  const homeProb = game.modelHomeProb;
  const kalshiAway = game.kalshiAwayPrice;
  const kalshiHome = game.kalshiHomePrice;

  // Positions along the 0-100 bar
  const modelHomePos  = homeProb * 100;
  const kalshiHomePos = kalshiHome * 100;
  const hasGap = Math.abs(game.homeEdge) > 0.05 || Math.abs(game.awayEdge) > 0.05;

  const gapLeft  = Math.min(modelHomePos, kalshiHomePos);
  const gapRight = Math.max(modelHomePos, kalshiHomePos);
  const gapWidth = gapRight - gapLeft;

  return (
    <div className="space-y-2">
      {/* Bar */}
      <div className="relative h-5 rounded-full overflow-hidden bg-muted/30 flex">
        {/* Away (blue) section */}
        <div
          className="h-full bg-blue-500/30 transition-all duration-700"
          style={{ width: `${awayProb * 100}%` }}
        />
        {/* Home (red/amber) section */}
        <div
          className="h-full bg-amber-500/30 flex-1 transition-all duration-700"
        />

        {/* Gap highlight */}
        {hasGap && gapWidth > 1 && (
          <div
            className="absolute top-0 h-full bg-yellow-400/25 border-x border-yellow-400/50"
            style={{ left: `${gapLeft}%`, width: `${gapWidth}%` }}
          />
        )}

        {/* Kalshi marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-white/60"
          style={{ left: `${kalshiHomePos}%` }}
          title={`Kalshi: ${(kalshiHome * 100).toFixed(0)}¢`}
        />

        {/* Model marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-yellow-300"
          style={{ left: `${modelHomePos}%` }}
          title={`Model: ${(homeProb * 100).toFixed(0)}%`}
        />
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-blue-400">
          <span className="font-semibold">{game.away}</span>
          <span>{(awayProb * 100).toFixed(0)}%</span>
          <span className="text-muted-foreground/50">|</span>
          <span className="text-muted-foreground/70">Kalshi {(kalshiAway * 100).toFixed(0)}¢</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-0.5 bg-white/60 inline-block" />
          <span className="text-muted-foreground/60">Kalshi</span>
          <span className="w-2 h-0.5 bg-yellow-300 inline-block ml-1" />
          <span className="text-yellow-300">Model</span>
        </div>
        <div className="flex items-center gap-2 text-amber-400">
          <span className="text-muted-foreground/70">Kalshi {(kalshiHome * 100).toFixed(0)}¢</span>
          <span className="text-muted-foreground/50">|</span>
          <span>{(homeProb * 100).toFixed(0)}%</span>
          <span className="font-semibold">{game.home}</span>
        </div>
      </div>

      {/* Edge summary */}
      <div className="flex items-center justify-center gap-4 text-xs">
        <span className="text-muted-foreground">
          Model: <span className="text-amber-300">{game.home} {(homeProb * 100).toFixed(0)}%</span>
        </span>
        <span className="text-border">|</span>
        <span className="text-muted-foreground">
          Kalshi: <span className="text-white/70">{game.home} {(kalshiHome * 100).toFixed(0)}¢</span>
        </span>
        {hasGap && (
          <>
            <span className="text-border">|</span>
            <span className="text-yellow-400 font-semibold">
              Edge: {(Math.max(Math.abs(game.homeEdge), Math.abs(game.awayEdge)) * 100).toFixed(1)}%
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Active game card ──────────────────────────────────────────────────────────
function ActiveGameCard({ game }: { game: LiveGame }) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (game.signal !== "HOLD" && game.signal !== "NONE") {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
  }, [game.signal]);

  const isBuy  = game.signal.startsWith("BUY");
  const isSell = game.signal.startsWith("SELL");

  return (
    <Card
      className={cn(
        "border transition-all duration-300",
        flash && isBuy  && "border-profit/60 shadow-profit/20 shadow-lg",
        flash && isSell && "border-loss/60  shadow-loss/20  shadow-lg",
        !flash && "border-border"
      )}
      data-testid={`card-game-${game.espnId}`}
    >
      <CardContent className="p-4 space-y-4">
        {/* Score row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Away team */}
            <div className="text-right">
              <div className="text-xs text-muted-foreground">{teamName(game.away)}</div>
              <div className="text-2xl font-bold mono text-blue-400">{game.awayScore}</div>
              <div className="text-xs text-muted-foreground mono">{game.away}</div>
            </div>

            {/* Period / clock */}
            <div className="text-center px-3">
              <div className="text-xs text-muted-foreground">
                {periodLabel(game.period)}
              </div>
              <div className="text-xl font-bold mono text-foreground">{game.clock}</div>
              <div className="flex items-center gap-1 justify-center mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-profit live-pulse inline-block" />
                <span className="text-xs text-profit font-medium">LIVE</span>
              </div>
            </div>

            {/* Home team */}
            <div className="text-left">
              <div className="text-xs text-muted-foreground">{teamName(game.home)}</div>
              <div className="text-2xl font-bold mono text-amber-400">{game.homeScore}</div>
              <div className="text-xs text-muted-foreground mono">{game.home}</div>
            </div>
          </div>

          {/* Signal badge */}
          <div className="text-right space-y-1.5">
            <Badge
              variant="outline"
              className={cn("text-xs font-semibold px-3 py-1", signalColor(game.signal))}
              data-testid={`badge-signal-${game.espnId}`}
            >
              {signalLabel(game.signal, game)}
            </Badge>
            {game.kalshiHomeTicker && (
              <div className="text-xs text-muted-foreground/50 mono truncate max-w-[180px]">
                {game.kalshiHomeTicker}
              </div>
            )}
          </div>
        </div>

        <Separator className="bg-border/50" />

        {/* Probability bar */}
        <ProbBar game={game} />

        <Separator className="bg-border/50" />

        {/* Reasoning */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          {game.reasoning}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Countdown to next game ────────────────────────────────────────────────────
function Countdown({ gameTime }: { gameTime: string }) {
  const [diff, setDiff] = useState<number>(0);

  useEffect(() => {
    const target = new Date(gameTime).getTime();
    const update = () => {
      const now = Date.now();
      setDiff(Math.max(0, target - now));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [gameTime]);

  const totalSecs = Math.floor(diff / 1000);
  const hours     = Math.floor(totalSecs / 3600);
  const mins      = Math.floor((totalSecs % 3600) / 60);
  const secs      = totalSecs % 60;

  if (diff <= 0) return <span className="text-profit font-medium">Starting soon</span>;

  return (
    <span className="mono text-foreground">
      {hours > 0 ? `${hours}h ` : ""}{mins}m {String(secs).padStart(2, "0")}s
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LiveSports() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [engineStartTime, setEngineStartTime] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<LiveSportsState>({
    queryKey: ["/api/live-sports"],
    refetchInterval: (data) => ((data as any)?.engineRunning ? 5000 : 30000),
  });

  // Uptime counter
  useEffect(() => {
    if (!data?.engineRunning) {
      setUptimeSeconds(0);
      return;
    }
    const id = setInterval(() => {
      setUptimeSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [data?.engineRunning]);

  const toggleMutation = useMutation({
    mutationFn: () => apiRequest("POST", "./api/live-sports/toggle"),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["/api/live-sports"] });
      const on = res?.engineRunning ?? false;
      setEngineStartTime(res?.engineStartTime ?? null);
      if (on) setUptimeSeconds(0);
      toast({
        title: on ? "Live Sports Engine: ON" : "Live Sports Engine: OFF",
        description: on
          ? "Now monitoring NBA games every 15 seconds."
          : "Engine stopped. No active monitoring.",
      });
    },
  });

  const engineRunning = data?.engineRunning ?? false;

  // Stats
  const uptimeDisplay = (() => {
    const h = Math.floor(uptimeSeconds / 3600);
    const m = Math.floor((uptimeSeconds % 3600) / 60);
    const s = uptimeSeconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  })();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header ────────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Radio className="w-5 h-5 text-profit" />
            Live Sports Trading
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitors NBA games in real-time via ESPN. Trades automatically in autonomous mode.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Status pill */}
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border",
              engineRunning
                ? "text-profit border-profit/40 bg-profit/10"
                : "text-muted-foreground border-border bg-muted/20"
            )}
            data-testid="status-engine"
          >
            {engineRunning ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-profit live-pulse" />
                Engine: ACTIVE
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                Engine: OFF
              </>
            )}
          </div>

          {/* Toggle button */}
          <Button
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            variant={engineRunning ? "destructive" : "default"}
            size="sm"
            data-testid="button-engine-toggle"
            className={cn(!engineRunning && "bg-profit hover:bg-profit/90 text-black")}
          >
            {toggleMutation.isPending ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : engineRunning ? (
              <WifiOff className="w-3.5 h-3.5 mr-1.5" />
            ) : (
              <Wifi className="w-3.5 h-3.5 mr-1.5" />
            )}
            {engineRunning ? "Turn Off" : "Turn On"}
          </Button>
        </div>
      </div>

      {/* Stats bar ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            icon: <Layers className="w-4 h-4 text-blue-400" />,
            label: "Live Positions",
            value: isLoading ? "—" : String(data?.activePositions ?? 0),
            testId: "stat-positions",
          },
          {
            icon: <DollarSign className="w-4 h-4 text-profit" />,
            label: "Sports P&L Today",
            value: isLoading ? "—" : `$${(data?.livePnl ?? 0).toFixed(2)}`,
            testId: "stat-pnl",
            color: (data?.livePnl ?? 0) >= 0 ? "text-profit" : "text-loss",
          },
          {
            icon: <Activity className="w-4 h-4 text-amber-400" />,
            label: "Trades Today",
            value: isLoading ? "—" : String(data?.tradesToday ?? 0),
            testId: "stat-trades",
          },
          {
            icon: <Clock className="w-4 h-4 text-muted-foreground" />,
            label: "Engine Uptime",
            value: engineRunning ? uptimeDisplay : "—",
            testId: "stat-uptime",
          },
        ].map((s) => (
          <Card key={s.label} className="border-border bg-card/50">
            <CardContent className="p-3 flex items-center gap-2.5">
              {s.icon}
              <div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div
                  className={cn("text-sm font-semibold mono", (s as any).color)}
                  data-testid={s.testId}
                >
                  {s.value}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      )}

      {/* ── ACTIVE GAMES ────────────────────────────────────────────────────── */}
      {!isLoading && (
        <section data-testid="section-active-games">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-profit" />
            <h2 className="text-sm font-semibold text-foreground">Live Games</h2>
            {(data?.activeGames?.length ?? 0) > 0 && (
              <Badge variant="outline" className="text-xs text-profit border-profit/40 bg-profit/10">
                {data!.activeGames.length} in progress
              </Badge>
            )}
          </div>

          {(data?.activeGames?.length ?? 0) === 0 ? (
            <Card className="border-border border-dashed bg-card/30">
              <CardContent className="p-8 text-center space-y-2">
                <Trophy className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm font-medium text-muted-foreground">No games in progress right now</p>
                {(data?.upcomingGames?.length ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground/60">
                    Next game: <Countdown gameTime={data!.upcomingGames[0].gameTime} />
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {data!.activeGames.map((game) => (
                <ActiveGameCard key={game.espnId} game={game} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── UPCOMING GAMES ──────────────────────────────────────────────────── */}
      {!isLoading && (data?.upcomingGames?.length ?? 0) > 0 && (
        <section data-testid="section-upcoming-games">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-foreground">Upcoming Games</h2>
          </div>

          <Card className="border-border bg-card/50">
            <CardContent className="p-0 divide-y divide-border/40">
              {data!.upcomingGames.map((game) => (
                <div
                  key={game.espnId}
                  className="flex items-center justify-between px-4 py-3"
                  data-testid={`row-upcoming-${game.espnId}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-semibold text-foreground">
                      {game.away} <span className="text-muted-foreground font-normal text-xs">@</span> {game.home}
                    </div>
                    <div className="text-xs text-muted-foreground hidden sm:block">
                      {teamName(game.away)} vs {teamName(game.home)}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs">
                    {/* Kalshi prices */}
                    {game.kalshiHomePrice > 0 && (
                      <div className="text-muted-foreground hidden sm:flex gap-2">
                        <span>{game.away} <span className="text-foreground mono">{(game.kalshiAwayPrice * 100).toFixed(0)}¢</span></span>
                        <span>{game.home} <span className="text-foreground mono">{(game.kalshiHomePrice * 100).toFixed(0)}¢</span></span>
                      </div>
                    )}
                    {/* Countdown */}
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <Countdown gameTime={game.gameTime} />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── COMPLETED GAMES ─────────────────────────────────────────────────── */}
      {!isLoading && (data?.completedGames?.length ?? 0) > 0 && (
        <section data-testid="section-completed-games">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Completed Games</h2>
          </div>

          <Card className="border-border bg-card/50">
            <CardContent className="p-0 divide-y divide-border/40">
              {data!.completedGames.map((game) => {
                const homeWon = game.homeScore > game.awayScore;
                return (
                  <div
                    key={game.espnId}
                    className="flex items-center justify-between px-4 py-3"
                    data-testid={`row-completed-${game.espnId}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={cn("text-sm font-semibold", homeWon ? "text-amber-400" : "text-blue-400")}>
                        {game.away}
                      </span>
                      <span className="text-xl font-bold mono text-foreground">
                        {game.awayScore} – {game.homeScore}
                      </span>
                      <span className={cn("text-sm font-semibold", !homeWon ? "text-amber-400" : "text-blue-400")}>
                        {game.home}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-xs text-muted-foreground border-border">
                      FINAL
                    </Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── EMPTY STATE (off + no games) ──────────────────────────────────────── */}
      {!isLoading &&
        (data?.activeGames?.length ?? 0) === 0 &&
        (data?.upcomingGames?.length ?? 0) === 0 &&
        (data?.completedGames?.length ?? 0) === 0 && (
          <Card className="border-border border-dashed bg-card/20">
            <CardContent className="p-10 text-center space-y-3">
              <Trophy className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-muted-foreground">No NBA games today</p>
              <p className="text-xs text-muted-foreground/50">
                The engine monitors live games during the NBA regular season and playoffs.
              </p>
            </CardContent>
          </Card>
        )}

      {/* ── Info cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
        <Card className="border-border bg-card/40">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" />
              How It Works
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 text-xs text-muted-foreground space-y-1.5">
            <p>• Polls ESPN scoreboard every 15 seconds during active games</p>
            <p>• Computes win probability from score differential + quarter weighting</p>
            <p>• Compares model probability to live Kalshi market prices</p>
            <p>• Signals trades when edge &gt; 5% — auto-executes in autonomous mode</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/40">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-warning-amt" />
              Risk Controls
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 text-xs text-muted-foreground space-y-1.5">
            <p>• Max $100 per game (hard cap)</p>
            <p>• Max 3 simultaneous live positions</p>
            <p>• No trades in final 2 minutes of Q4</p>
            <p>• Stops trading if live sports P&L &lt; –$50 today</p>
          </CardContent>
        </Card>
      </div>

      {/* Last scan timestamp */}
      {data?.lastScan && (
        <p className="text-xs text-muted-foreground/40 text-center mono">
          Last scan: {new Date(data.lastScan).toLocaleTimeString("en-US", { hour12: false })}
        </p>
      )}
    </div>
  );
}
