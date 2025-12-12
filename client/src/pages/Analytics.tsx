import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart as ReBarChart,
  LineChart as ReLineChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { TrendingUp, BarChart3, Clock, Target, DollarSign } from "lucide-react";
import Layout from "@/components/Layout";

const COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(159, 100%, 36%)",
  "hsl(42, 92%, 56%)",
  "hsl(147, 78%, 42%)",
  "hsl(341, 75%, 51%)",
];

type ManualBet = {
  id: string;
  sport: string;
  league?: string | null;
  marketType: string;
  selection: string;
  sportsbook: string;
  oddsAmerican: number;
  stake: string;
  status: "open" | "won" | "lost" | "void" | "settled";
  createdAt: string;
};

type Summary = {
  totalBets: number;
  winRate: number;
  realized: number;
  exposure: number;
  avgOdds: number;
  avgStake: number;
};

function americanProfit(oddsAmerican: number, stake: number) {
  if (oddsAmerican > 0) {
    return (oddsAmerican / 100) * stake;
  }
  return (100 / Math.abs(oddsAmerican)) * stake;
}

function computeSummary(bets: ManualBet[]): Summary {
  if (bets.length === 0) {
    return {
      totalBets: 0,
      winRate: 0,
      realized: 0,
      exposure: 0,
      avgOdds: 0,
      avgStake: 0,
    };
  }

  const stats = bets.reduce(
    (acc, bet) => {
      const stake = Number(bet.stake) || 0;
      const odds = Number(bet.oddsAmerican) || 0;

      acc.totalBets += 1;
      acc.totalStake += stake;
      acc.totalOdds += odds;

      if (bet.status === "open") {
        acc.exposure += stake;
      }

      if (bet.status === "won") {
        acc.realized += americanProfit(odds, stake);
        acc.wins += 1;
      } else if (bet.status === "lost") {
        acc.realized -= stake;
      }

      return acc;
    },
    { totalBets: 0, wins: 0, totalStake: 0, totalOdds: 0, realized: 0, exposure: 0 },
  );

  return {
    totalBets: stats.totalBets,
    winRate: stats.totalBets > 0 ? (stats.wins / stats.totalBets) * 100 : 0,
    realized: stats.realized,
    exposure: stats.exposure,
    avgOdds: stats.totalBets > 0 ? stats.totalOdds / stats.totalBets : 0,
    avgStake: stats.totalBets > 0 ? stats.totalStake / stats.totalBets : 0,
  };
}

function bucketByDay(bets: ManualBet[]) {
  const buckets: Record<string, { date: string; pnl: number; cumulative: number } | undefined> = {};
  let running = 0;

  const sorted = [...bets].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  for (const bet of sorted) {
    const stake = Number(bet.stake) || 0;
    const odds = Number(bet.oddsAmerican) || 0;
    const pnl =
      bet.status === "won" ? americanProfit(odds, stake) : bet.status === "lost" ? -stake : 0;
    const key = new Date(bet.createdAt).toISOString().slice(0, 10);

    running += pnl;

    if (!buckets[key]) {
      buckets[key] = { date: key, pnl: 0, cumulative: 0 };
    }

    buckets[key]!.pnl += pnl;
    buckets[key]!.cumulative = running;
  }

  return Object.values(buckets);
}

function breakdownBySport(bets: ManualBet[]) {
  const map = new Map<string, { name: string; value: number }>();

  bets.forEach((bet) => {
    const existing = map.get(bet.sport) || { name: bet.sport || "Unknown", value: 0 };
    map.set(bet.sport, { ...existing, value: existing.value + 1 });
  });

  return Array.from(map.values());
}

function breakdownByStatus(bets: ManualBet[]) {
  const map = new Map<string, { status: string; count: number; exposure: number }>();

  bets.forEach((bet) => {
    const stake = Number(bet.stake) || 0;
    const existing = map.get(bet.status) || { status: bet.status, count: 0, exposure: 0 };
    map.set(bet.status, {
      status: bet.status,
      count: existing.count + 1,
      exposure: existing.exposure + (bet.status === "open" ? stake : 0),
    });
  });

  return Array.from(map.values());
}

export default function Analytics() {
  const { data: bets = [], isLoading } = useQuery<ManualBet[]>({ queryKey: ["/api/bets"] });
  const summary = useMemo(() => computeSummary(bets), [bets]);
  const pnlTimeline = useMemo(() => bucketByDay(bets), [bets]);
  const sportMix = useMemo(() => breakdownBySport(bets), [bets]);
  const statusMix = useMemo(() => breakdownByStatus(bets), [bets]);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Performance snapshots powered by your bet tracker and hedge coverage.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select defaultValue="30d">
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm">
              Export CSV
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Win rate</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{summary.winRate.toFixed(1)}%</div>
              <p className="text-xs text-muted-foreground">Based on settled bets</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Realized PnL</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div
                className={`text-3xl font-semibold ${summary.realized >= 0 ? "text-emerald-600" : "text-red-600"}`}
              >
                {summary.realized >= 0 ? "+" : ""}${summary.realized.toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">Profit from won vs. lost stakes</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Open exposure</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">${summary.exposure.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">Stake still live across books</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg odds</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">
                {summary.avgOdds > 0 ? `+${summary.avgOdds.toFixed(0)}` : summary.avgOdds.toFixed(0)}
              </div>
              <p className="text-xs text-muted-foreground">Mean American odds across wagers</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg stake</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">${summary.avgStake.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">Per bet commitment</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tracked bets</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{summary.totalBets}</div>
              <p className="text-xs text-muted-foreground">Manual entries from Hedge Center</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="pnl" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pnl">PnL Over Time</TabsTrigger>
            <TabsTrigger value="sports">By Sport</TabsTrigger>
            <TabsTrigger value="status">Status & Exposure</TabsTrigger>
          </TabsList>

          <TabsContent value="pnl" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Daily PnL trend</CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                {isLoading ? (
                  <div className="h-full bg-muted animate-pulse rounded" />
                ) : pnlTimeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No settled bets yet to chart.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ReLineChart data={pnlTimeline} margin={{ left: 12, right: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} />
                      <YAxis />
                      <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                      <Line type="monotone" dataKey="cumulative" stroke="hsl(159, 100%, 36%)" strokeWidth={2} />
                      <Line type="monotone" dataKey="pnl" stroke="hsl(217, 91%, 60%)" strokeWidth={2} />
                    </ReLineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sports" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Volume by sport</CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                {isLoading ? (
                  <div className="h-full bg-muted animate-pulse rounded" />
                ) : sportMix.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bets recorded yet.</p>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={sportMix} dataKey="value" nameKey="name" label> 
                            {sportMix.map((entry, index) => (
                              <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2 text-sm">
                      {sportMix.map((item, idx) => (
                        <div key={item.name} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-3 w-3 rounded-full"
                              style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                            ></span>
                            <span className="font-medium">{item.name}</span>
                          </div>
                          <Badge variant="outline">{item.value} bets</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="status" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Exposure by status</CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                {isLoading ? (
                  <div className="h-full bg-muted animate-pulse rounded" />
                ) : statusMix.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bets to display.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ReBarChart data={statusMix} margin={{ left: 12, right: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="status" />
                      <YAxis />
                      <Tooltip formatter={(value: number, name) => (name === "exposure" ? `$${value.toFixed(2)}` : value)} />
                      <Bar dataKey="count" fill="hsl(217, 91%, 60%)" name="Bets" />
                      <Bar dataKey="exposure" fill="hsl(42, 92%, 56%)" name="Open stake" />
                    </ReBarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent bets</CardTitle>
              <Badge variant="outline">Hedge Center</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : bets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bets recorded yet. Track wagers in the Hedge Center.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="p-2">Selection</th>
                      <th className="p-2">Market</th>
                      <th className="p-2">Odds</th>
                      <th className="p-2">Stake</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Placed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {bets.slice(0, 8).map((bet) => (
                      <tr key={bet.id} className="align-top">
                        <td className="p-2 font-medium">
                          {bet.selection}
                          <div className="text-xs text-muted-foreground">
                            {bet.league ? `${bet.sport} • ${bet.league}` : bet.sport}
                          </div>
                        </td>
                        <td className="p-2">{bet.marketType}</td>
                        <td className="p-2">{bet.oddsAmerican > 0 ? `+${bet.oddsAmerican}` : bet.oddsAmerican}</td>
                        <td className="p-2">${Number(bet.stake).toFixed(2)}</td>
                        <td className="p-2">
                          <Badge variant={bet.status === "open" ? "outline" : bet.status === "won" ? "default" : "destructive"}>
                            {bet.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {new Date(bet.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
