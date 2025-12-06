import type { ArbitrageOpportunityDisplay } from "@/types";

export interface ArbitrageScanResult {
  success: boolean;
  maxProfitPick?: MaxProfitPick;
  allOpportunities: ArbitrageOpportunityDisplay[];
  rankedOpportunities: ArbitrageOpportunityDisplay[];
  creditUsage: {
    requestsUsed: number;
    creditsConsumed: number;
  };
  cacheExpiresAt: string;
}

export interface MaxProfitPick {
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

export interface CachedArbitrageScan {
  scanResults: ArbitrageScanResult;
  lastScanTime?: string;
}

export const SCAN_CACHE_KEY = "arbitrageScanCache";
export const LAST_ARBITRAGE_SCAN_QUERY_KEY = ["last-arbitrage-scan"] as const;

function normalizeConfidence(raw: unknown): number {
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 0;

  if (num <= 1) return num * 100;
  if (num <= 100) return num;
  return Math.min(100, num / 100);
}

function normalizeMaxProfitPick(raw: any | undefined | null): MaxProfitPick | undefined {
  if (!raw) return undefined;

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
          typeof leg.odds === "number" ? leg.odds.toString() : String(leg.odds ?? ""),
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

/** Normalizes any agent response shape into ArbitrageScanResult */
export function normalizeAgentResult(payload: any): ArbitrageScanResult {
  const root = payload?.result ?? payload ?? {};

  const maxProfitPick = normalizeMaxProfitPick(
    root.maxProfitPick ?? root.bestOpportunity ?? root.topOpportunity
  );

  const rawList =
    root.rankedOpportunities ?? root.allOpportunities ?? root.opportunities ?? [];

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
      : new Date(Date.now() + 5 * 60 * 1000).toISOString();

  return {
    success: typeof payload?.success === "boolean" ? payload.success : true,
    maxProfitPick,
    allOpportunities: normalizedList,
    rankedOpportunities: normalizedList,
    creditUsage,
    cacheExpiresAt,
  };
}

export function readCachedScan(): CachedArbitrageScan | null {
  if (typeof window === "undefined") return null;

  const cachedValue = localStorage.getItem(SCAN_CACHE_KEY);
  if (!cachedValue) return null;

  try {
    const parsed = JSON.parse(cachedValue);
    if (!parsed?.scanResults) return null;

    return {
      scanResults: normalizeAgentResult(parsed.scanResults),
      lastScanTime: parsed.lastScanTime,
    };
  } catch (error) {
    console.error("Failed to parse cached arbitrage scan", error);
    return null;
  }
}

export function persistCachedScan(cache: CachedArbitrageScan) {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    SCAN_CACHE_KEY,
    JSON.stringify({
      scanResults: cache.scanResults,
      lastScanTime: cache.lastScanTime,
    }),
  );
}
