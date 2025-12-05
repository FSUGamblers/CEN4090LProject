import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Info, Clock } from "lucide-react";

interface ArbitrageCardProps {
  // Keep this loose so it works with your current API shape
  opportunity: any;
}

/**
 * Convert American odds (e.g. "+150", "-200") to decimal odds.
 * Used only for an example payout; does NOT depend on user bankroll.
 */
function americanToDecimal(americanOdds: string): number | null {
  if (!americanOdds) return null;
  const num = Number(americanOdds);
  if (!Number.isFinite(num) || num === 0) return null;

  if (num > 0) {
    // +150 -> 1 + 150/100 = 2.5
    return 1 + num / 100;
  } else {
    // -200 -> 1 + 100/200 = 1.5
    return 1 + 100 / Math.abs(num);
  }
}

export default function ArbitrageCard({ opportunity }: ArbitrageCardProps) {
  const event = opportunity.event ?? {};
  const market = opportunity.market ?? {};
  const legs = Array.isArray(opportunity.legs) ? opportunity.legs : [];

  // For now we assume the first leg is the recommended side
  const primaryLeg = legs[0];
  if (!primaryLeg) {
    return null;
  }

  // Estimated edge (profitPct / expectedProfitPct)
  const rawProfit =
    opportunity.profitPct ??
    opportunity.expectedProfitPct ??
    opportunity.bestProfitPct ??
    0;
  const profitPct =
    typeof rawProfit === "number" ? rawProfit : Number(rawProfit) || 0;
  const edgeLabel = `${
    profitPct >= 0 ? "+" : ""
  }${profitPct.toFixed(1)}% estimated edge`;

  // Confidence score (0–100)
  const rawConfidence = opportunity.confidenceScore ?? 0;
  const confidence =
    typeof rawConfidence === "number"
      ? Math.max(0, Math.min(100, rawConfidence))
      : 0;

  // Validity window in seconds (how long we expect the line to stay roughly valid)
  const validitySeconds = opportunity.validityWindow ?? 300;
  const validityMinutes = Math.floor(validitySeconds / 60);
  const validityRemainder = validitySeconds % 60;

  // Example buy-in / payout that does NOT depend on user bankroll
  const exampleStake = 100; // purely illustrative
  const dec = americanToDecimal(primaryLeg.odds);
  const examplePayout = dec ? exampleStake * dec : null;
  const exampleProfit = examplePayout ? examplePayout - exampleStake : null;

  const titleText =
    event.homeTeam && event.awayTeam
      ? `${event.homeTeam} vs ${event.awayTeam}`
      : opportunity.eventName ?? "Game";

  const subtitleParts = [
    event.sport,
    market.description || market.type,
    event.startTime,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-col gap-1">
          <span className="text-base font-semibold">{titleText}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {subtitleParts.join(" • ")}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {/* Plain-English recommendation */}
        <div>
          <div className="font-semibold mb-1">Recommended bet</div>
          <p>
            Bet{" "}
            <span className="font-semibold">{primaryLeg.outcome}</span> on{" "}
            <span className="font-semibold">{primaryLeg.sportsbook}</span> at{" "}
            odds <span className="font-mono">{primaryLeg.odds}</span>.
          </p>

          {examplePayout && exampleProfit !== null && (
            <p className="text-muted-foreground mt-1">
              Example: A ${exampleStake} bet would return about $
              {examplePayout.toFixed(0)} total (
              ${exampleProfit.toFixed(0)} profit) if it wins.
              <br />
              You can scale this up or down to your own stake size.
            </p>
          )}
        </div>

        {/* Edge / confidence / freshness badges */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            {edgeLabel}
          </Badge>

          <Badge variant="outline" className="flex items-center gap-1">
            <Info className="h-3 w-3" />
            Model confidence: {confidence.toFixed(0)}/100
          </Badge>

          <Badge variant="outline" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Price freshness: about{" "}
            {validityMinutes > 0
              ? `${validityMinutes}m${
                  validityRemainder ? ` ${validityRemainder}s` : ""
                }`
              : `${validitySeconds}s`}
          </Badge>
        </div>

        {/* Small disclaimer in normal human language */}
        <p className="text-xs text-muted-foreground">
          This is <span className="font-semibold">not</span> guaranteed profit.
          It simply means this side looks better priced than the sportsbook&apos;s
          implied chances, compared with other options on the board. Always
          double-check live odds and bet sizes before placing any wager.
        </p>
      </CardContent>
    </Card>
  );
}

