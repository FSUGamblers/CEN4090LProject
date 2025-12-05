import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import StatsCard from "@/components/StatsCard";
import ArbitrageCard from "@/components/ArbitrageCard";
import HedgeAlert from "@/components/HedgeAlert";
import JobStatus from "@/components/JobStatus";
import { useToast } from "@/hooks/use-toast";
import { 
  TrendingUp, 
  Shield, 
  BarChart3, 
  DollarSign,
  RefreshCw,
  Filter,
  Bell
} from "lucide-react";
import type { DashboardStats, ArbitrageOpportunityDisplay, HedgeAlertDisplay, JobStatusDisplay, StateAccessDisplay, ExpenseSummary } from "@/types";

// --- Arbitrage scan types from POST /api/scan/arbs ---

type ArbLeg = {
  outcome: string;
  sportsbook: string;
  odds: string; // American odds, e.g. "+100"
  stake: number;
};

type ArbEvent = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  sport: string;
  league: string;
  startTime: string; // formatted string from API, e.g. "12/7/2025, 1:00:00 PM"
};

type ArbMarket = {
  type: string;        // "SPREADS" | "H2H" | "TOTALS"
  description: string; // "Moneyline", "Point Spread", "Over/Under"
};

type ArbitrageOpportunity = {
  event: ArbEvent;
  market: ArbMarket;
  legs: ArbLeg[];
  profitPct: number;
  validityWindow: number;
  confidenceScore: number;
  lockedProfit: number;
};

type ArbsScanResponse = {
  success: boolean;
  maxProfitPick: ArbitrageOpportunity | null;
  rankedOpportunities: ArbitrageOpportunity[];
  comprehensiveOddsData: any[]; // we won't use this yet on the UI
  creditUsage: {
    used: number;
    remaining: number;
    requestsUsed: number;
    creditsConsumed: number;
  };
  executionTime: number;
  timestamp: string;
  cacheExpiresAt: string;
};

export default function Dashboard() {
  const { toast } = useToast();

  // 1) Dashboard stats
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });
  const netPnlToday = stats?.dailyPnl ?? 0;

  // 2) Shared active opportunities from backend (any page / previous scans)
  const { data: activeOpportunities = [], isLoading: activeOppLoading } =
    useQuery<ArbitrageOpportunity[]>({
      queryKey: ["/api/arbitrage/opportunities"],
    });

  // 3) Arbitrage scan state (POST /api/scan/arbs) – local, for fresh runs
  const [scanResult, setScanResult] = React.useState<ArbsScanResponse | null>(null);
  const [scanLoading, setScanLoading] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);

  const handleRunArbScan = async () => {
    setScanLoading(true);
    setScanError(null);

    try {
      const res = await fetch("/api/scan/arbs", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // NOTE: these two fields are REQUIRED by the backend Zod schema:
          //   states: string[]
          //   confirmed: boolean
          //
          // Use "NJ" here because that's what you've been testing with.
          // Later you can wire this up to your real state-access config.
          states: ["NJ"],
          confirmed: true,
        }),
      });

      if (!res.ok) {
        throw new Error(`Scan failed with status ${res.status}`);
      }

      const data = (await res.json()) as ArbsScanResponse;
      setScanResult(data);

      toast({
        title: "Scan complete",
        description: "Value scan finished successfully.",
      });
    } catch (error) {
      console.error("Error running value scan:", error);
      setScanError(error instanceof Error ? error.message : "Unknown error");

      toast({
        title: "Error",
        description: "Failed to run value scan",
        variant: "destructive",
      });
    } finally {
      setScanLoading(false);
    }
  };

  // Prefer the most recent scan on this page; otherwise fall back to shared active opps
  const baseOpportunities: ArbitrageOpportunity[] =
    scanResult?.rankedOpportunities?.length
      ? scanResult.rankedOpportunities
      : activeOpportunities;

  const profitableOpportunities: ArbitrageOpportunity[] =
    baseOpportunities.filter((opp) => opp.profitPct > 0);

  const lastScanTimeLabel =
    scanResult?.timestamp
      ? new Date(scanResult.timestamp).toLocaleTimeString()
      : null;

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<JobStatusDisplay[]>({
    queryKey: ["/api/jobs"],
    select: (data: any[]) =>
      data.slice(0, 3).map((job) => ({
        name: job.jobName,
        status: job.status,
        lastRun: job.finishedAt
          ? new Date(job.finishedAt).toLocaleString()
          : "Running...",
        displayName: job.jobName
          .replace(/_/g, " ")
          .replace(/\b\w/g, (l: string) => l.toUpperCase()),
      })),
  });

  // This is now the "board" we use for empty / non-empty messaging
  const displayedOpportunities = baseOpportunities;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live value opportunities and system status
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm text-muted-foreground">Live Data</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="relative"
            data-testid="button-notifications"
          >
            <Bell className="w-4 h-4" />
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 w-5 h-5 text-xs p-0 flex items-center justify-center"
            >
              3
            </Badge>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Active Opportunities"
          value={stats?.activeOpportunities?.toString() || "0"}
          change=""
          icon={TrendingUp}
          variant="primary"
          isLoading={statsLoading}
        />
        <StatsCard
          title="Avg Estimated Edge %"
          value={`${stats?.avgProfit || "0"}%`}
          change=""
          icon={BarChart3}
          variant="success"
          isLoading={statsLoading}
        />
        <StatsCard
          title="Tracked Bets"
          value={stats?.trackedBets?.toString() || "0"}
          change=""
          icon={Shield}
          variant="info"
          isLoading={statsLoading}
        />
        <StatsCard
          title="Daily PnL"
          value={`$${stats?.dailyPnl || 0}`}
          change=""
          icon={DollarSign}
          variant={stats && stats.dailyPnl > 0 ? "success" : "destructive"}
          isLoading={statsLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Value Opportunities */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle>Live Value Opportunities</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Scan across books for mispriced or better-value sides, based on recent stats and current odds.
                  These are not risk-free or guaranteed profits.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {lastScanTimeLabel && (
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    Last scan: {lastScanTimeLabel}
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={handleRunArbScan}
                  data-testid="button-refresh-arbitrage"
                  disabled={scanLoading}
                >
                  <RefreshCw className="w-4 h-4 mr-1" />
                  {scanLoading ? "Scanning..." : "Refresh"}
                </Button>
                <Button variant="outline" size="sm" data-testid="button-filters">
                  <Filter className="w-4 h-4 mr-1" />
                  Filters
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {scanError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Error running scan: {scanError}
              </div>
            )}

            {scanLoading && (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-20 bg-muted rounded-lg"></div>
                  </div>
                ))}
              </div>
            )}

            {!scanLoading && !scanResult && !scanError && displayedOpportunities.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No value opportunities loaded yet. Click{" "}
                <span className="font-semibold">Refresh</span> to run your
                first scan, or visit the Arbitrage page.
              </div>
            )}

            {!scanLoading &&
              scanResult &&
              displayedOpportunities.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No value opportunities were found in the latest scan.
                  Try scanning again later when lines have moved.
                </div>
              )}

            {!scanLoading && profitableOpportunities.length > 0 && (
              <div className="space-y-4">
                {profitableOpportunities.slice(0, 3).map((opp) => {
                  const displayOpp = {
                    id: `${opp.event.id}-${opp.market.type}`,
                    event: {
                      homeTeam: opp.event.homeTeam,
                      awayTeam: opp.event.awayTeam,
                      league: opp.event.league,
                      startTime: opp.event.startTime,
                    },
                    market: {
                      type: opp.market.type,
                      description: opp.market.description,
                    },
                    legs: opp.legs.map((leg) => ({
                      outcome: leg.outcome,
                      sportsbook: leg.sportsbook,
                      odds: leg.odds,
                      stake: leg.stake,
                    })),
                    profitPct: opp.profitPct,
                    validityWindow: opp.validityWindow,
                    confidenceScore: opp.confidenceScore,
                  } as ArbitrageOpportunityDisplay;

                  return (
                    <ArbitrageCard key={displayOpp.id} opportunity={displayOpp} />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* System Status Column */}
        <div className="space-y-6">
          {/* Hedge Alerts */}
          <Card>
            <CardHeader>
              <CardTitle>Hedge Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No hedge alerts yet. This will update when real hedge data is
                available.
              </p>
            </CardContent>
          </Card>

          {/* Job Status */}
          <Card>
            <CardHeader>
              <CardTitle>System Jobs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {jobsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-12 bg-muted rounded"></div>
                    </div>
                  ))}
                </div>
              ) : jobs.length > 0 ? (
                jobs.map((job, index) => (
                  <JobStatus
                    key={`${job.name}-${index}`}
                    job={job}
                  />
                ))
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  No recent job runs
                </div>
              )}
            </CardContent>
          </Card>

          {/* State Access */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>State Access</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="button-manage-states"
                >
                  Manage
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No state access metrics yet.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Expense Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Daily Net PnL</CardTitle>
            <Button
              variant="outline"
              size="sm"
              data-testid="button-view-details"
            >
              View Details
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : netPnlToday === 0 ? (
            <p className="text-sm text-muted-foreground">No PnL data yet.</p>
          ) : (
            <p className="text-2xl font-bold">${netPnlToday.toFixed(2)}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
