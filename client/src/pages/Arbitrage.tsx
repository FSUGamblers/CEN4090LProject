import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import ArbitrageCard from "@/components/ArbitrageCard";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Search,
  Filter,
  TrendingUp,
  Clock,
  AlertTriangle,
  Crown,
  CreditCard,
} from "lucide-react";
import type { ArbitrageOpportunityDisplay } from "@/types";

/* -------------------- Types -------------------- */
interface ScanRequest {
  states: string[];
  sports?: string[];
  regions?: string[];
  markets?: string[];
  minProfitPct?: number;
  useCachedOdds?: boolean; 
}


/**
 * IMPORTANT: In the agent response, each leg's `stake` is in basis points of
 * some notional bankroll (e.g., 5000 = 50% of bankroll).
 * We normalize that into `stakeBps` for display as "% of bankroll".
 */
interface MaxProfitPick {
  eventId?: string;
  marketId?: string;
  eventName?: string;
  marketType?: string;
  description?: string;
  legs: Array<{
    outcome: string;
    sportsbook: string;
    odds: string;
    // basis points of bankroll: 5000 -> 50% of bankroll
    stakeBps: number;
  }>;
  // Expected locked profit as a percentage of bankroll (e.g., 1.5 = 1.5%)
  expectedProfitPct: number;
  // Confidence already normalized to 0–100 (we will display as "%")
  confidenceScore: number;
}

interface ArbitrageScanResult {
  success: boolean;
  maxProfitPick?: MaxProfitPick;
  /**
   * All opportunities returned by the scan, already ranked by edge/safety.
   * We mirror `rankedOpportunities` from the backend so the UI always has
   * a consistent list to work with.
   */
  allOpportunities: ArbitrageOpportunityDisplay[];
  rankedOpportunities: ArbitrageOpportunityDisplay[];
  creditUsage: {
    requestsUsed: number;
    creditsConsumed: number;
  };
  cacheExpiresAt: string;
}

/* -------------------- Normalization helpers -------------------- */

function normalizeConfidence(raw: unknown): number {
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 0;

  // Cases:
  //  - 0–1  -> treat as probability, convert to %
  //  - 1–100 -> already a percent
  //  - >100  -> assume basis points style (e.g. 9500 -> 95%), clamp to 100
  if (num <= 1) return num * 100;
  if (num <= 100) return num;
  return Math.min(100, num / 100);
}

function normalizeMaxProfitPick(raw: any | undefined | null): MaxProfitPick | undefined {
  if (!raw) return undefined;

  // Profit: prefer expectedProfitPct, fall back to profitPct/bestProfitPct
  const profitSource =
    typeof raw.expectedProfitPct === "number"
      ? raw.expectedProfitPct
      : typeof raw.profitPct === "number"
      ? raw.profitPct
      : typeof raw.bestProfitPct === "number"
      ? raw.bestProfitPct
      : 0;

  const expectedProfitPct = Number.isFinite(profitSource) ? Number(profitSource) : 0;

  const legs = Array.isArray(raw.legs)
    ? raw.legs.map((leg: any) => ({
        outcome: String(leg.outcome ?? leg.label ?? leg.outcomeLabel ?? ""),
        sportsbook: String(leg.sportsbook ?? leg.book ?? leg.bookName ?? ""),
        odds:
          typeof leg.odds === "number"
            ? leg.odds.toString()
            : String(leg.odds ?? ""),
        // Treat raw `stake` as basis points of bankroll if provided,
        // otherwise fall back to any existing stakeBps-like field.
        stakeBps: Number(leg.stake ?? leg.stakeBps ?? 0),
      }))
    : [];

  const confidenceScore = normalizeConfidence(raw.confidenceScore);

  return {
    eventId: raw.eventId ?? raw.event?.id,
    marketId: raw.marketId ?? raw.market?.id ?? raw.marketType,
    eventName:
      raw.eventName ??
      raw.event?.name ??
      (raw.event?.homeTeam && raw.event?.awayTeam
        ? `${raw.event.homeTeam} vs ${raw.event.awayTeam}`
        : undefined),
    marketType: raw.marketType ?? raw.market?.type,
    description: raw.market?.description ?? raw.description,
    legs,
    expectedProfitPct,
    confidenceScore,
  };
}

/* -------------------- Agent bridge -------------------- */
/** Normalizes any agent response shape into ArbitrageScanResult */
function normalizeAgentResult(payload: any): ArbitrageScanResult {
  // Backend returns the result at the top-level; keep support for { result: {...} } too.
  const root = payload?.result ?? payload ?? {};

  const maxProfitPick = normalizeMaxProfitPick(
    root.maxProfitPick ?? root.bestOpportunity ?? root.topOpportunity
  );

  // Prefer the new backend field `rankedOpportunities`, but still support
  // older shapes (`allOpportunities` / `opportunities`) for flexibility.
  const rawList =
    root.rankedOpportunities ??
    root.allOpportunities ??
    root.opportunities ??
    [];

  const normalizedList: ArbitrageOpportunityDisplay[] = Array.isArray(rawList)
    ? (rawList as ArbitrageOpportunityDisplay[])
    : [];

  const creditUsage = {
    requestsUsed: Number(root.creditUsage?.requestsUsed ?? root.requestsUsed ?? 0) || 0,
    creditsConsumed:
      Number(root.creditUsage?.creditsConsumed ?? root.creditsConsumed ?? 0) || 0,
  };

  const cacheExpiresAt: string =
    typeof root.cacheExpiresAt === "string"
      ? root.cacheExpiresAt
      : new Date(Date.now() + 5 * 60 * 1000).toISOString(); // default 5m

  return {
    success: typeof payload?.success === "boolean" ? payload.success : true,
    maxProfitPick,
    allOpportunities: normalizedList,
    rankedOpportunities: normalizedList,
    creditUsage,
    cacheExpiresAt,
  };
}

/** Calls the credit-conscious arbitrage scan endpoint. */
async function runAgentScan(request: ScanRequest): Promise<ArbitrageScanResult> {
  const res = await apiRequest("POST", "/api/scan/arbs", {
    ...request,
    confirmed: true,
    useCachedOdds: true, // 👈 add this temporarily while iterating
  });
  const data = await res.json();
  return normalizeAgentResult(data);
}



/* -------------------- Component -------------------- */
export default function Arbitrage() {
  const { toast } = useToast();
  // Shared active opportunities from backend (any page / previous scans)
  const { data: activeOpportunities = [], isLoading: activeOppLoading } =
    useQuery<ArbitrageOpportunityDisplay[]>({
      queryKey: ["/api/arbitrage/opportunities"],
    });

  const [scanResults, setScanResults] = useState<ArbitrageScanResult | null>(null);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);

  const [filters, setFilters] = useState<ScanRequest>({
    // NOTE: The "states" here are Odds-API sports keys, which is a bit misnamed,
    // but we'll keep it as-is to avoid touching the rest of the app.
    states: ["americanfootball_nfl"],
    sports: ["all"],
    regions: ["us", "us2"],
    markets: ["h2h", "spreads", "totals"],
    minProfitPct: 1.0,
  });

  // States & sportsbooks map
  const { data: stateMap } = useQuery<{
    success: boolean;
    stateMap: Record<string, string[]>;
    totalStates: number;
    availableSportsbooks: string[];
  }>({
    queryKey: ["/api/state-map"],
  });

  // Execute arbitrage scan via Agent
  const scanMutation = useMutation({
    mutationFn: async (request: ScanRequest) => runAgentScan(request),
    onSuccess: (data) => {
      setScanResults(data);
      setLastScanTime(new Date());
      toast({
        title: "Agent Scan Complete",
        description: `Found ${data.allOpportunities?.length || 0} opportunities. Credits used: ${
          data.creditUsage?.creditsConsumed || 0
        }`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Agent Scan Failed",
        description: error?.message ?? "The agent was unable to complete the scan.",
        variant: "destructive",
      });
    },
  });

  const handleStartScan = () => {
    if (!filters.states.length) {
      toast({
        title: "State Required",
        description: "Please select at least one state to search sportsbooks",
        variant: "destructive",
      });
      return;
    }
    scanMutation.mutate(filters);
  };

  const availableStates = stateMap?.stateMap ? Object.keys(stateMap.stateMap) : [];

  // Derived stats
  // Prefer the current scan's board; otherwise fall back to shared active opps
  const opportunities: ArbitrageOpportunityDisplay[] =
    scanResults?.allOpportunities?.length
      ? scanResults.allOpportunities
      : activeOpportunities;

  const maxProfitPick = scanResults?.maxProfitPick;
  const totalOpportunities = opportunities.length;

  const displayMaxProfit =
    maxProfitPick && typeof maxProfitPick.expectedProfitPct === "number"
      ? maxProfitPick.expectedProfitPct
      : 0;

  const creditsUsed = scanResults?.creditUsage?.creditsConsumed ?? 0;

  // Only show "Maximum Profit Opportunity" if we actually have a positive edge
  const showMaxProfitCard =
    !!maxProfitPick && maxProfitPick.expectedProfitPct > 0 && maxProfitPick.legs.length > 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Arbitrage Scanner (Agent)</h1>
          <p className="text-sm text-muted-foreground">
            The agent searches your selected states & sportsbooks for live arbitrage opportunities.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastScanTime && (
            <span className="text-sm text-muted-foreground">
              Last scan: {lastScanTime.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Opportunities</p>
                <p className="text-2xl font-bold">{totalOpportunities}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Max Profit %</p>
                <p className="text-2xl font-bold text-green-500">
                  {displayMaxProfit.toFixed(2)}%
                </p>
              </div>
              <Crown className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Credits Used</p>
                <p className="text-2xl font-bold">{creditsUsed}</p>
              </div>
              <CreditCard className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Cache Expires</p>
                <p className="text-2xl font-bold">
                  {scanResults?.cacheExpiresAt
                    ? `${Math.max(
                        0,
                        Math.ceil(
                          (new Date(scanResults.cacheExpiresAt).getTime() - Date.now()) /
                            60000
                        )
                      )}m`
                    : "0m"}
                </p>
              </div>
              <Clock className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Scan Configuration */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Scan Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  States (Required)
                </Label>
                {availableStates.length > 0 ? (
                  availableStates.map((state) => (
                    <div key={state} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`state-${state}`}
                        checked={filters.states.includes(state)}
                        onChange={(e) => {
                          setFilters((prev) => ({
                            ...prev,
                            states: e.target.checked
                              ? [...prev.states, state]
                              : prev.states.filter((s) => s !== state),
                          }));
                        }}
                        data-testid={`checkbox-state-${state}`}
                      />
                      <Label htmlFor={`state-${state}`} className="text-sm">
                        {state}
                      </Label>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">Loading states...</div>
                )}
                {filters.states.length > 0 && stateMap?.stateMap && (
                  <p className="text-xs text-green-600 dark:text-green-400">
                    ✓{" "}
                    {
                      Array.from(
                        new Set(
                          filters.states.flatMap((s) => stateMap.stateMap[s] || [])
                        )
                      ).length
                    }{" "}
                    sportsbooks available
                  </p>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="sports-select">Sports</Label>
                <Select
                  value={filters.sports?.[0] || "all"}
                  onValueChange={(value) =>
                    setFilters((prev) => ({ ...prev, sports: [value] }))
                  }
                >
                  <SelectTrigger id="sports-select" data-testid="select-sports">
                    <SelectValue placeholder="All Sports" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sports</SelectItem>
                    <SelectItem value="americanfootball_nfl">NFL</SelectItem>
                    <SelectItem value="basketball_nba">NBA</SelectItem>
                    <SelectItem value="baseball_mlb">MLB</SelectItem>
                    <SelectItem value="icehockey_nhl">NHL</SelectItem>
                    <SelectItem value="soccer_epl">Soccer (EPL)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="min-profit">Min Profit %</Label>
                <Input
                  id="min-profit"
                  type="number"
                  step="0.1"
                  min="0.1"
                  placeholder="1.0"
                  value={filters.minProfitPct}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      minProfitPct: parseFloat(e.target.value) || 1.0,
                    }))
                  }
                  data-testid="input-min-profit"
                />
              </div>

              <div className="space-y-2">
                <Label>Markets</Label>
                <div className="space-y-2">
                  {["h2h", "spreads", "totals"].map((market) => (
                    <div key={market} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`market-${market}`}
                        checked={filters.markets?.includes(market)}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            markets: e.target.checked
                              ? [...(prev.markets || []), market]
                              : (prev.markets || []).filter((m) => m !== market),
                          }))
                        }
                        data-testid={`checkbox-market-${market}`}
                      />
                      <Label htmlFor={`market-${market}`} className="text-sm capitalize">
                        {market === "h2h"
                          ? "Moneyline"
                          : market === "spreads"
                          ? "Point Spreads"
                          : "Totals (O/U)"}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Separator />

            <Button
              className="w-full"
              onClick={handleStartScan}
              disabled={scanMutation.isPending || filters.states.length === 0}
              data-testid="button-start-scan"
            >
              {scanMutation.isPending ? (
                <>
                  <Search className="w-4 h-4 mr-2 animate-spin" /> Scanning via Agent...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" /> Search All Sportsbooks
                </>
              )}
            </Button>

            {filters.states.length === 0 && (
              <Alert className="border-red-500/20 bg-red-50 dark:bg-red-950/20">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <AlertTitle className="text-red-700 dark:text-red-400">
                  State Required
                </AlertTitle>
                <AlertDescription className="text-red-600 dark:text-red-300">
                  Select at least one state to search available sportsbooks
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        <div className="lg:col-span-3 space-y-6">
          {showMaxProfitCard && maxProfitPick && (
            <Card className="border-2 border-green-500/20 bg-green-50/50 dark:bg-green-950/20">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <Crown className="w-5 h-5" />
                    Maximum Profit Opportunity
                  </CardTitle>
                  <Badge className="bg-green-600 text-white">
                    {maxProfitPick.expectedProfitPct.toFixed(2)}% Profit
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="font-medium">Betting Legs</h4>
                    {maxProfitPick.legs.map((leg, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 bg-white dark:bg-gray-900 rounded-lg border"
                      >
                        <div>
                          <p className="font-medium">{leg.outcome}</p>
                          <p className="text-sm text-muted-foreground">
                            {leg.sportsbook}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-green-600">{leg.odds}</p>
                          <p className="text-sm text-muted-foreground">
                            {/* stakeBps is basis points; convert to % of bankroll */}
                            {leg.stakeBps > 0
                              ? `${(leg.stakeBps / 100).toFixed(1)}% of bankroll`
                              : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-medium">Performance Metrics</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center p-3 bg-white dark:bg-gray-900 rounded-lg border">
                        <p className="text-sm text-muted-foreground">Expected Profit</p>
                        <p className="text-lg font-bold text-green-600">
                          {maxProfitPick.expectedProfitPct.toFixed(2)}%
                        </p>
                      </div>
                      <div className="text-center p-3 bg-white dark:bg-gray-900 rounded-lg border">
                        <p className="text-sm text-muted-foreground">Confidence</p>
                        <p className="text-lg font-bold text-blue-600">
                          {(maxProfitPick.confidenceScore ?? 0).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>All Value / Safer Opportunities</CardTitle>
                <Badge variant="secondary">{opportunities.length} Found</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {scanMutation.isPending ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-24 bg-muted rounded-lg"></div>
                    </div>
                  ))}
                </div>
              ) : opportunities.length > 0 ? (
                <div className="space-y-4">
                  {[...opportunities]
                    .sort((a, b) => (b.profitPct || 0) - (a.profitPct || 0))
                    .map((opportunity) => {
                      const isFeatured =
                        maxProfitPick && opportunity.id === maxProfitPick.eventId;
                      return (
                        <div
                          key={opportunity.id}
                          className={isFeatured ? "opacity-50 relative" : ""}
                        >
                          {isFeatured && (
                            <div className="absolute inset-0 bg-green-500/10 rounded-lg border border-green-500/20 flex items-center justify-center">
                              <Badge className="bg-green-600 text-white">
                                Featured Above
                              </Badge>
                            </div>
                          )}
                          <ArbitrageCard opportunity={opportunity} />
                        </div>
                      );
                    })}
                </div>
              ) : scanResults && showMaxProfitCard ? (
                // We have a top opportunity card above but no additional ones
                <div className="text-center py-12">
                  <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">Only Top Opportunity Found</h3>
                  <p className="text-muted-foreground mb-4">
                    The agent found one best value / safer hedged opportunity (shown
                    above), but no additional markets met your settings.
                  </p>
                </div>
              ) : scanResults ? (
                <div className="text-center py-12">
                  <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Opportunities Found</h3>
                  <p className="text-muted-foreground mb-4">
                    No value / safer hedged opportunities were found with your current
                    settings. Try scanning again later when lines have moved or broadening
                    your filters.
                  </p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">Ready to Scan</h3>
                  <p className="text-muted-foreground mb-4">
                    Configure your settings and click &quot;Search All Sportsbooks&quot;
                    to run the agent.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
