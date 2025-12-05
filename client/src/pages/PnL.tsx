import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Layout from "@/components/Layout";

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

type PnlSummary = {
  realized: number;
  unrealizedExposure: number;
  potentialUpside: number;
  totalStaked: number;
  roi: number;
};

function americanProfit(oddsAmerican: number, stake: number) {
  if (oddsAmerican > 0) {
    return (oddsAmerican / 100) * stake;
  }
  return (100 / Math.abs(oddsAmerican)) * stake;
}

function summarizePnL(bets: ManualBet[]): PnlSummary {
  return bets.reduce(
    (acc, bet) => {
      const stake = Number(bet.stake) || 0;
      const odds = Number(bet.oddsAmerican) || 0;

      acc.totalStaked += stake;

      if (bet.status === "open") {
        acc.unrealizedExposure += stake;
        acc.potentialUpside += americanProfit(odds, stake);
      }

      if (bet.status === "won") {
        acc.realized += americanProfit(odds, stake);
      } else if (bet.status === "lost") {
        acc.realized -= stake;
      }

      acc.roi = acc.totalStaked > 0 ? (acc.realized / acc.totalStaked) * 100 : 0;

      return acc;
    },
    { realized: 0, unrealizedExposure: 0, potentialUpside: 0, totalStaked: 0, roi: 0 } satisfies PnlSummary,
  );
}

export default function PnL() {
  const { data: bets = [], isLoading } = useQuery<ManualBet[]>({ queryKey: ["/api/bets"] });

  const summary = useMemo(() => summarizePnL(bets), [bets]);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">PnL & Costs</h1>
          <p className="text-sm text-muted-foreground">
            Track realized profit, open exposure, and upside using your manual bet tracker entries.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Realized PnL</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-semibold ${summary.realized >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {summary.realized >= 0 ? "+" : ""}${summary.realized.toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">Based on bets marked won/lost</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Open Exposure</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">${summary.unrealizedExposure.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">Stake amount currently at risk</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Potential Upside</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-emerald-600">${summary.potentialUpside.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">Profit if all open bets win</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">ROI</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-semibold ${summary.roi >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {summary.roi.toFixed(2)}%
              </div>
              <p className="text-xs text-muted-foreground">Realized vs. total staked</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ledger snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : bets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bets recorded yet. Add entries in Hedge Center to see PnL.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="p-2">Selection</th>
                      <th className="p-2">Market</th>
                      <th className="p-2">Odds</th>
                      <th className="p-2">Stake</th>
                      <th className="p-2">Result</th>
                      <th className="p-2">PNL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {bets.map((bet) => {
                      const stake = Number(bet.stake) || 0;
                      const odds = Number(bet.oddsAmerican) || 0;
                      const isOpen = bet.status === "open";
                      const pnl =
                        bet.status === "won"
                          ? americanProfit(odds, stake)
                          : bet.status === "lost"
                            ? -stake
                            : 0;

                      return (
                        <tr key={bet.id} className="align-top">
                          <td className="p-2 font-medium">
                            {bet.selection}
                            <div className="text-xs text-muted-foreground">{bet.sport} {bet.league ? `• ${bet.league}` : ""}</div>
                          </td>
                          <td className="p-2">{bet.marketType}</td>
                          <td className="p-2">{odds > 0 ? `+${odds}` : odds}</td>
                          <td className="p-2">${stake.toFixed(2)}</td>
                          <td className="p-2">
                            <Badge variant={isOpen ? "outline" : pnl >= 0 ? "default" : "destructive"}>{bet.status}</Badge>
                          </td>
                          <td className={`p-2 font-medium ${pnl > 0 ? "text-emerald-600" : pnl < 0 ? "text-red-600" : ""}`}>
                            {isOpen ? "–" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`}
                          </td>
                        </tr>
                      );
                    })}
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
