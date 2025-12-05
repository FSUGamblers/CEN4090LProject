import { storage } from "../storage";
import { auditService } from "./auditService";
import type { ArbitrageOpportunity, Quote } from "@shared/schema";

interface TeamFormStats {
  teamName: string;
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  avgMargin: number; // (pointsFor - pointsAgainst) / games
}


// Credit-conscious arbitrage interfaces
interface EstimateRequest {
  states: string[];
  sports?: string[];
  regions?: string[];
  markets?: string[];
  minProfitPct?: number;
}

interface EstimateResponse {
  endpoints: Array<{
    name: string;
    url: string;
    estimatedRequests: number;
    description: string;
  }>;
  totalEstimatedRequests: number;
  estimatedCreditUsage: number;
  filters: EstimateRequest & {
    eligibleBookmakers?: number;
    warningNote?: string;
  };
}

interface ArbitrageCalculation {
  eventId: string;
  marketId: string;
  legs: Array<{
    sportsbookId: string;
    outcomeId: string;
    priceValue: number;
    stakeFraction: number;
  }>;
  expectedProfitPct: number;
  recommendedStakes: Record<string, number>;
  confidenceScore: number;
}

interface MaxProfitPick {
  event: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    sport: string;
    league: string;
    startTime: string;
  };
  market: {
    type: string;
    description: string;
  };
  legs: Array<{
    outcome: string;
    sportsbook: string;
    odds: string;
    stake: number;
  }>;
  profitPct: number;
  lockedProfit: number;
  validityWindow: number;
  confidenceScore: number;
}

class ArbitrageService {
  // State map for sportsbook filtering (state -> accessible bookmakers)
  private stateMap: Record<string, string[]> = {
    "AL": ["draftkings", "fanduel", "caesars", "betmgm"],
    "AK": ["draftkings", "fanduel"],
    "AZ": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "pointsbet", "wynnbet"],
    "AR": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "CA": ["draftkings", "fanduel"],
    "CO": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "pointsbet", "wynnbet"],
    "CT": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "DE": ["draftkings", "fanduel", "betmgm", "betrivers"],
    "FL": ["draftkings", "fanduel", "caesars", "betmgm"],
    "GA": ["draftkings", "fanduel"],
    "HI": ["draftkings", "fanduel"],
    "ID": ["draftkings", "fanduel"],
    "IL": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "pointsbet", "wynnbet"],
    "IN": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "pointsbet"],
    "IA": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "KS": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "KY": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "LA": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "ME": ["draftkings", "fanduel", "caesars", "betmgm"],
    "MD": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "MA": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "wynnbet"],
    "MI": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "pointsbet", "wynnbet"],
    "MN": ["draftkings", "fanduel", "caesars", "betmgm"],
    "MS": ["draftkings", "fanduel", "caesars", "betmgm"],
    "MO": ["draftkings", "fanduel", "caesars", "betmgm"],
    "MT": ["draftkings", "fanduel"],
    "NE": ["draftkings", "fanduel", "caesars", "betmgm"],
    "NV": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "pointsbet", "wynnbet"],
    "NH": ["draftkings", "fanduel", "caesars", "betmgm"],
    "NJ": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "pointsbet", "wynnbet"],
    "NM": ["draftkings", "fanduel"],
    "NY": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "pointsbet", "wynnbet"],
    "NC": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "ND": ["draftkings", "fanduel"],
    "OH": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "pointsbet"],
    "OK": ["draftkings", "fanduel"],
    "OR": ["draftkings", "fanduel"],
    "PA": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers", "pointsbet", "wynnbet"],
    "RI": ["draftkings", "fanduel", "caesars", "betmgm"],
    "SC": ["draftkings", "fanduel"],
    "SD": ["draftkings", "fanduel"],
    "TN": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "TX": ["draftkings", "fanduel"],
    "UT": ["draftkings", "fanduel"],
    "VT": ["draftkings", "fanduel", "caesars", "betmgm"],
    "VA": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "WA": ["draftkings", "fanduel"],
    "WV": ["draftkings", "fanduel", "caesars", "betmgm", "betrivers"],
    "WI": ["draftkings", "fanduel"],
    "WY": ["draftkings", "fanduel"]
  };

  // Inside class ArbitrageService { ... }
  private oddsCache:
    | {
        expiresAt: number;
        data: any[]; // same shape as comprehensiveOddsData
        creditUsage: { used: number; remaining: number };
      }
    | null = null;

  private async getNflTeamFormStats(): Promise<Map<string, TeamFormStats>> {
    const result = new Map<string, TeamFormStats>();

    try {
      const apiKey = process.env.ODDS_API_KEY;
      if (!apiKey) {
        console.warn("[ARB] No ODDS_API_KEY set; skipping team form stats");
        return result;
      }

      const url = new URL(
        "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/scores"
      );

      // Look back ~2 weeks of completed games
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("daysFrom", "-14");
      url.searchParams.set("dateFormat", "iso");
      url.searchParams.set("completed", "true");

      const resp = await fetch(url.toString());
      if (!resp.ok) {
        console.warn(
          "[ARB] getNflTeamFormStats: non-200 from scores endpoint",
          resp.status,
          await resp.text()
        );
        return result;
      }

      const games: any[] = await resp.json();

      const upsertTeam = (teamName: string, pf: number, pa: number) => {
        const key = teamName.trim();
        let rec = result.get(key);
        if (!rec) {
          rec = {
            teamName: key,
            games: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            avgMargin: 0,
          };
          result.set(key, rec);
        }
        rec.games += 1;
        rec.pointsFor += pf;
        rec.pointsAgainst += pa;
      };

      for (const game of games) {
        if (!Array.isArray(game.scores) || game.scores.length !== 2) {
          continue;
        }


        const [homeScoreObj, awayScoreObj] = game.scores;
        const homeScore = Number(homeScoreObj?.score);
        const awayScore = Number(awayScoreObj?.score);

        if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

        upsertTeam(homeScoreObj.name, homeScore, awayScore);
        upsertTeam(awayScoreObj.name, awayScore, homeScore);
      }

      // ✅ Use forEach instead of "for...of result.values()" to avoid
      // downlevelIteration / ES2015 target issues
      result.forEach((rec) => {
        if (rec.games > 0) {
          rec.avgMargin = (rec.pointsFor - rec.pointsAgainst) / rec.games;
        }
      });

      console.log(
        "[ARB] getNflTeamFormStats built form map for",
        result.size,
        "teams"
      );
    } catch (err) {
      console.error("[ARB] Failed to fetch NFL team form stats:", err);
    }

    return result;
  }


  /**
   * Credit-conscious estimate: NO API calls, just planning
   * Shows user exactly what endpoints would be hit and estimated costs
   * Enhanced for more accurate request counting per architect feedback
   */
  async estimateAPIUsage(request: EstimateRequest): Promise<EstimateResponse> {
    const { 
      states, 
      sports = ["americanfootball_nfl"], 
      regions = ["us", "us2"], 
      markets = ["h2h", "spreads", "totals"],
      minProfitPct = 1.0 
    } = request;
    
    if (!states || states.length === 0) {
      throw new Error("State filtering is mandatory - please select at least one state");
    }

    const endpoints: EstimateResponse["endpoints"] = [];
    let totalRequests = 0;

    // Sports enumeration (only if sports filter is "all")
    if (sports.includes("all")) {
      endpoints.push({
        name: "Sports Enumeration",
        url: "GET /v4/sports",
        estimatedRequests: 1,
        description: "Get list of active sports and leagues"
      });
      totalRequests += 1;
    }

    // Calculate actual sports to fetch
    const selectedSports = sports.includes("all") 
      ? ["americanfootball_nfl", "basketball_nba", "baseball_mlb", "icehockey_nhl", "soccer_epl"]
      : sports;

    // Live & Upcoming odds (per sport × region combination)
    // Note: Each sport-region gets one call, but markets are passed as comma-separated params
    const liveUpcomingRequests = selectedSports.length * regions.length;
    
    endpoints.push({
      name: "Live & Upcoming Odds",
      url: "GET /v4/sports/{sport}/odds",
      estimatedRequests: liveUpcomingRequests,
      description: `Live/upcoming odds for ${selectedSports.length} sports × ${regions.length} regions (markets: ${markets.join(", ")})`
    });
    totalRequests += liveUpcomingRequests;

    // Additional requests if bookmaker filtering is used (state-based filtering)
    // This doesn't add requests but affects the filtering logic
    const eligibleBookmakers = this.filterBookmakersByStates(states);
    const bookmakerFilterNote = eligibleBookmakers.length < 10 
      ? ` (filtered to ${eligibleBookmakers.length} bookmakers for ${states.join(", ")})`
      : ` (${eligibleBookmakers.length} bookmakers available in ${states.join(", ")})`;

    // Event details (only called when user clicks on specific events)
    endpoints.push({
      name: "Event Details (on-demand)",
      url: "GET /v4/sports/{sport}/events/{event}/odds", 
      estimatedRequests: 0,
      description: "Extended markets per event - only called when user clicks event details" + bookmakerFilterNote
    });

    // Historical data (if enabled by feature flag - not included in base estimate)
    endpoints.push({
      name: "Historical Data (feature flag)",
      url: "GET /v4/historical/sports/{sport}/odds",
      estimatedRequests: 0,
      description: "Historical odds data - only if enabled and user confirms date range"
    });

    // Enhanced credit estimation based on Odds API pricing tiers
    // Base: $10/month = 1000 requests, or ~$0.01 per request
    const estimatedCreditUsage = totalRequests * 1;
    
    // Add warning if request count is high
    const warningNote = totalRequests > 50 
      ? "High request count - consider narrowing sports or regions to reduce cost"
      : totalRequests > 20 
        ? "Moderate request count - results will be comprehensive"
        : "Low request count - efficient scan";

    return {
      endpoints,
      totalEstimatedRequests: totalRequests,
      estimatedCreditUsage,
      filters: {
        ...request,
        eligibleBookmakers: eligibleBookmakers.length,
        warningNote
      }
    };
  }

  /**
   * Execute arbitrage scan: Makes actual API calls after user confirmation
   * Stores ALL fetched data in database and returns comprehensive odds display data
   */
  async scanArbitrageOpportunities(
    request: EstimateRequest,
    userId: string
  ): Promise<{
    maxProfitPick: MaxProfitPick | null;
    rankedOpportunities: MaxProfitPick[];
    comprehensiveOddsData: Array<{
      event: {
        id: string;
        homeTeam: string;
        awayTeam: string;
        sport: string;
        league: string;
        startTime: string;
        status: string;
      };
      markets: Array<{
        type: string;
        description: string;
        outcomes: Array<{
          name: string;
          odds: Array<{
            sportsbook: string;
            price: string;
            decimal: number;
          }>;
        }>;
      }>;
    }>;
    creditUsage: {
      used: number;
      remaining: number;
      requestsUsed: number;
      creditsConsumed: number;
    };
    executionTime: number;
  }> {
    const startTime = Date.now();
    let totalCreditsUsed = 0;
    let remainingCredits = 500;

    // Normalize minProfitPct once (used for ranking / thresholds)
    const minProfitPct = request.minProfitPct ?? 0.1;

    const job = await storage.createJobRun({
      jobName: "arbitrage_scan",
      status: "running",
    });

    try {
      await auditService.log(
        userId,
        "arbitrage_scan_started",
        "job",
        job.id,
        request
      );

      // Step 1: Filter eligible sportsbooks by states
      const eligibleBookmakers = this.filterBookmakersByStates(request.states);
      if (eligibleBookmakers.length === 0) {
        throw new Error(
          `No sportsbooks accessible in selected states: ${request.states.join(", ")}`
        );
      }

      // Step 2: Reuse cached odds if still fresh; otherwise fetch new ones
      const cacheTtlMs = 10 * 60 * 1000; // 10 minutes
      let comprehensiveData: any[] | null = null;

      const now = Date.now();
      if (this.oddsCache && this.oddsCache.expiresAt > now) {
        console.log(
          "[VALUE] Reusing cached odds data from previous scan; expires at",
          new Date(this.oddsCache.expiresAt).toISOString()
        );
        comprehensiveData = this.oddsCache.data;
        // For cached runs, we treat this as using 0 new credits
        totalCreditsUsed = 0;
        remainingCredits = this.oddsCache.creditUsage.remaining ?? 500;
      } else {
        const { comprehensiveData: freshData, creditUsage } =
          await this.fetchAndStoreOddsData(request, eligibleBookmakers);

        comprehensiveData = freshData || [];
        totalCreditsUsed = creditUsage.used;
        remainingCredits = creditUsage.remaining;

        this.oddsCache = {
          expiresAt: now + cacheTtlMs,
          data: comprehensiveData,
          creditUsage: {
            used: creditUsage.used,
            remaining: creditUsage.remaining,
          },
        };

        console.log(
          "[ARB] scan: fetchAndStoreOddsData returned",
          comprehensiveData ? comprehensiveData.length : 0,
          "events with markets"
        );
      }

      // Step 3: Calculate value / safest opportunities from stored odds
      const opportunities = await this.calculateArbitrageOpportunities(
        comprehensiveData || [],
        minProfitPct
      );

      // Step 4: Rank by edge (profitPct) and select Max Profit Pick
      const rankedOpportunities = opportunities.sort(
        (a, b) => b.profitPct - a.profitPct
      );
      const maxProfitPick =
        rankedOpportunities.length > 0 ? rankedOpportunities[0] : null;

      // Step 5: Store the top pick (clamped) even if not strictly positive EV
      if (maxProfitPick) {
        try {
          // Clamp expectedProfitPct to fit NUMERIC(3,2) -> [-9.99, 9.99]
          const clampedProfitPct = Math.max(
            -9.99,
            Math.min(9.99, maxProfitPick.profitPct)
          );

          await storage.createArbitrageOpportunity({
            eventId: maxProfitPick.event.id,
            // Synthetic market key (aggregated "best of board")
            marketId: "market_" + maxProfitPick.market.type.toLowerCase(),
            legs: maxProfitPick.legs.map((leg) => ({
              // If your schema stores numeric sportsbook IDs, adapt here
              sportsbookId: leg.sportsbook.toLowerCase(),
              outcomeId: leg.outcome,
              priceValue: this.convertAmericanToDecimal(
                parseInt(leg.odds.replace(/[+]/g, ""))
              ),
              // Normalize stake to fraction of notional bankroll (10000 units)
              stakeFraction: leg.stake / 10000,
            })),
            expectedProfitPct: clampedProfitPct.toFixed(2),
            notionalBankroll: "10000",
            recommendedStakes: Object.fromEntries(
              maxProfitPick.legs.map((leg) => [leg.sportsbook, leg.stake])
            ),
            validityWindow: 300, // 5 minutes
            confidenceScore: maxProfitPick.confidenceScore.toString(),
            constraintsApplied: [`states:${request.states.join(",")}`],
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          });
        } catch (err) {
          console.error(
            "[ARB] Failed to persist arbitrage/value opportunity:",
            err
          );
          // Don't rethrow – scan should still succeed
        }
      }

      const executionTime = Date.now() - startTime;

      await storage.updateJobRun(job.id, {
        status: "success",
        finishedAt: new Date(),
        metrics: {
          opportunitiesFound: opportunities.length,
          maxProfitPct: maxProfitPick?.profitPct || 0,
          executionTimeMs: executionTime,
          statesFiltered: request.states.length,
          eligibleBookmakers: eligibleBookmakers.length,
        },
      });

      await auditService.log(
        userId,
        "arbitrage_scan_completed",
        "job",
        job.id,
        {
          opportunitiesFound: opportunities.length,
          maxProfit: maxProfitPick?.lockedProfit || 0,
        }
      );

      return {
        maxProfitPick,
        // Full ranked board to drive “All Value / Safer Opportunities”
        rankedOpportunities: rankedOpportunities.slice(0, 10),
        comprehensiveOddsData: comprehensiveData || [],
        creditUsage: {
          used: totalCreditsUsed,
          remaining: remainingCredits,
          requestsUsed: totalCreditsUsed,
          creditsConsumed: totalCreditsUsed,
        },
        executionTime,
      };
    } catch (error) {
      await storage.updateJobRun(job.id, {
        status: "failed",
        finishedAt: new Date(),
        errorSummary: error instanceof Error ? error.message : "Unknown error",
      });

      throw error;
    }
  }






  /**
   * Filter bookmakers by state accessibility using state map
   */
  private filterBookmakersByStates(states: string[]): string[] {
    if (!states || states.length === 0) return [];
    
    // Find bookmakers accessible in ALL selected states (AND logic)
    const accessibleBookmakers: string[] = [];
    
    for (const [state, bookmakers] of Object.entries(this.stateMap)) {
      if (states.includes(state)) {
        if (accessibleBookmakers.length === 0) {
          accessibleBookmakers.push(...bookmakers);
        } else {
          // Keep only bookmakers that exist in this state too
          for (let i = accessibleBookmakers.length - 1; i >= 0; i--) {
            if (!bookmakers.includes(accessibleBookmakers[i])) {
              accessibleBookmakers.splice(i, 1);
            }
          }
        }
      }
    }
    
    return Array.from(new Set(accessibleBookmakers)); // Remove duplicates
  }

  /**
   * Fetch odds data from Odds API and store ALL data in database
   */
    private async fetchAndStoreOddsData(
      request: EstimateRequest,
      eligibleBookmakers: string[]
    ): Promise<{
      opportunities: any[];
      creditUsage: { used: number; remaining: number };
      comprehensiveData: Array<{
        event: {
          id: string;
          homeTeam: string;
          awayTeam: string;
          sport: string;
          league: string;
          startTime: string;
          status: string;
        };
        markets: Array<{
          type: string;
          description: string;
          outcomes: Array<{
            name: string;
            odds: Array<{
              sportsbook: string;
              price: string;
              decimal: number;
            }>;
          }>;
        }>;
      }>;
    }> {
      // Only NFL for now
      const sports =
        request.sports?.includes("all")
          ? ["americanfootball_nfl"]
          : request.sports || ["americanfootball_nfl"];

      let totalCreditsUsed = 0;
      let remainingCredits = 500;

      // Import oddsService dynamically to avoid circular dependencies
      const { oddsService } = await import("./oddsService");

      try {
        // Fetch real odds from The Odds API
        const { data: apiData, creditUsage: apiCreditUsage } =
          await oddsService.fetchFromOddsAPI({
            leagues: sports,
            liveOnly: false,
            maxPages: 3,
          });

        // Track real credit usage
        totalCreditsUsed = apiCreditUsage.used;
        remainingCredits = apiCreditUsage.remaining;

        console.log(
          `API returned ${apiData.length} events. Processing and storing in database...`
        );

        // Process and store ALL fetched data in database (returns a rich, structured view)
        const comprehensiveData = await this.processAndStoreOddsData(
          apiData,
          eligibleBookmakers
        );

        // Convert that structured view into the format used by the arbitrage calculator
        const oddsData = this.convertToArbitrageFormat(
          comprehensiveData,
          eligibleBookmakers
        );

        return {
          opportunities: oddsData,
          comprehensiveData,
          creditUsage: {
            used: totalCreditsUsed,
            remaining: remainingCredits,
          },
        };
      } catch (error) {
        console.error("Failed to fetch real odds data:", error);
        throw error;
      }
    }

  /**
   * Process and store API data in database with proper relationships
   */
  private async processAndStoreOddsData(apiData: any[], eligibleBookmakers: string[]): Promise<Array<{
    event: {
      id: string;
      homeTeam: string;
      awayTeam: string;
      sport: string;
      league: string;
      startTime: string;
      status: string;
    };
    markets: Array<{
      type: string;
      description: string;
      outcomes: Array<{
        name: string;
        odds: Array<{
          sportsbook: string;
          price: string;
          decimal: number;
        }>;
      }>;
    }>;
  }>> {
    const comprehensiveData = [];
    
    for (const eventData of apiData) {
      try {
        // 1. Ensure sport exists
        let sport = await storage.getSportByCode(eventData.sport_key);
        if (!sport) {
          sport = await storage.createSport({
            name: eventData.sport_title,
            code: eventData.sport_key,
          });
        }

        // 2. Ensure league exists
        const leagues = await storage.getLeagues(sport.id);
        let league = leagues.find(l => l.name === eventData.sport_title);
        if (!league) {
          league = await storage.createLeague({
            sportId: sport.id,
            name: eventData.sport_title,
            region: "US",
          });
        }

        // 3. Ensure teams exist
        const homeTeam = await storage.findOrCreateTeam(eventData.home_team, league.id);
        const awayTeam = await storage.findOrCreateTeam(eventData.away_team, league.id);

        // 4. Create or update event
        const event = await storage.createEvent({
          leagueId: league.id,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          startTime: new Date(eventData.commence_time),
          status: "scheduled",
          externalRefs: { oddsApiId: eventData.id },
        });

        // 5. Process markets and quotes
        const eventMarkets = [];
        
        for (const bookmaker of eventData.bookmakers) {
          // Filter by eligible bookmakers
          if (!eligibleBookmakers.includes(bookmaker.key)) {
            continue;
          }
          
          // Ensure sportsbook exists
          const sportsbooks = await storage.getSportsbooks();
          let sportsbook = sportsbooks.find(sb => sb.name.toLowerCase() === bookmaker.title.toLowerCase());
          if (!sportsbook) {
            sportsbook = await storage.createSportsbook({
              name: bookmaker.title,
              supportedStates: ["NJ", "PA", "NY"], // Default states
              constraints: {
                minBet: 1,
                maxBet: 10000,
                marketSupport: ["h2h", "spreads", "totals"],
                notes: "Auto-created from API data"
              }
            });
          }

          for (const marketData of bookmaker.markets) {
            // Find or create market
            const existingMarkets = await storage.getMarkets(event.id);
            let market = existingMarkets.find(m => m.marketType === marketData.key);

            // Normalize outcomes for this market so each side has a stable ID
            const normalizedOutcomes = marketData.outcomes.map((outcome: any, index: number) => {
              const baseName = outcome.name || `Outcome ${index + 1}`;
              const baseId = `${marketData.key}_${baseName}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "");

              return {
                id: baseId,
                label: baseName,
              };
            });

            // Create market if it doesn't exist yet
            if (!market) {
              market = await storage.createMarket({
                eventId: event.id,
                marketType: marketData.key,
                outcomes: normalizedOutcomes,
              });
            }

            // Create quotes for each outcome, using the normalized outcome IDs
            for (let i = 0; i < marketData.outcomes.length; i++) {
              const outcome = marketData.outcomes[i];
              const outcomeMeta = normalizedOutcomes[i];
              const outcomeId =
                outcomeMeta?.id ||
                `${marketData.key}_${i}`;

              await storage.createQuote({
                marketId: market.id,
                sportsbookId: sportsbook.id,
                outcomeId,
                priceFormat: "decimal",
                priceValue: outcome.price.toString(), // still decimal odds from the API
                isLive: false,
                stateAvailability: sportsbook.supportedStates,
              });
            }
          }
        }

      // 6. Build comprehensive display data DIRECTLY from the API event
      // This avoids any mismatch between DB storage and our in-memory view for arbitrage.
      const marketGroups = new Map<
        string,
        {
          type: string;
          description: string;
          outcomes: Map<
            string,
            {
              name: string;
              odds: Array<{
                sportsbook: string;
                price: string;
                decimal: number;
              }>;
            }
          >;
        }
      >();

      for (const bookmaker of eventData.bookmakers || []) {
        // Respect the same eligibleBookmakers filter we used for storage
        if (!eligibleBookmakers.includes(bookmaker.key)) continue;

        const sportsbookName = bookmaker.title;

        for (const marketData of bookmaker.markets || []) {
          const marketType = marketData.key; // e.g. "h2h", "spreads", "totals"
          const description = this.getMarketDescription(marketType);

          let group = marketGroups.get(marketType);
          if (!group) {
            group = {
              type: marketType,
              description,
              outcomes: new Map(),
            };
            marketGroups.set(marketType, group);
          }

          for (const outcome of marketData.outcomes || []) {
            const outcomeName = outcome.name || "Outcome";

            let outcomeEntry = group.outcomes.get(outcomeName);
            if (!outcomeEntry) {
              outcomeEntry = { name: outcomeName, odds: [] };
              group.outcomes.set(outcomeName, outcomeEntry);
            }

            const decimal = Number(outcome.price);
            // Filter out garbage/degenerate odds
            if (!Number.isFinite(decimal) || decimal <= 1.01) continue;

            outcomeEntry.odds.push({
              sportsbook: sportsbookName,
              price: this.formatPrice(decimal), // uses your existing helper
              decimal,
            });
          }
        }
      }

      // Convert marketGroups -> eventMarketData in the shape expected by calculateArbitrageOpportunities
      const eventMarketData: Array<{
        type: string;
        description: string;
        outcomes: Array<{
          name: string;
          odds: Array<{
            sportsbook: string;
            price: string;
            decimal: number;
          }>;
        }>;
      }> = [];

      // Iterate over marketGroups without using `for...of` on the Map
      marketGroups.forEach((group) => {
        // Make TS aware of the outcome shape
        const allOutcomes = Array.from(
          group.outcomes.values()
        ) as {
          name: string;
          odds: {
            sportsbook: string;
            price: string;
            decimal: number;
          }[];
        }[];

        const filteredOutcomes = allOutcomes.filter((o) => o.odds.length > 0);

        // Only keep markets where we have at least 2 outcomes with odds
        if (filteredOutcomes.length < 2) {
          return;
        }

        eventMarketData.push({
          type: group.type,
          description: group.description,
          outcomes: filteredOutcomes,
        });
      });


      // Finally push this event into comprehensiveData
      comprehensiveData.push({
        event: {
          id: event.id,
          homeTeam: eventData.home_team,
          awayTeam: eventData.away_team,
          sport: eventData.sport_title,
          league: league.name,
          startTime: new Date(eventData.commence_time).toLocaleString(),
          status: "scheduled",
        },
        markets: eventMarketData,
      });


      } catch (error) {
        console.error(`Error processing event ${eventData.id}:`, error);
        continue;
      }
    }
    
    console.log(`Stored ${comprehensiveData.length} events with comprehensive data in database`);
    return comprehensiveData;
  }

  /**
   * Convert comprehensive odds data into the format used by calculateArbitrageOpportunities
   */
  private convertToArbitrageFormat(
    comprehensiveData: any[],
    eligibleBookmakers: string[]
  ) {
    console.log(
      `Converting ${comprehensiveData.length} events for arbitrage calculations`
    );

    // Helper: normalize a sportsbook display name into a key like "draftkings"
    const toKey = (name: string) =>
      (name || "").toLowerCase().replace(/\s+/g, "");

    return (comprehensiveData || []).map((entry: any) => {
      const event = entry.event || {};
      const markets = entry.markets || [];

      return {
        eventId: event.id,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        sport: event.sport,
        league: event.league,
        startTime: event.startTime,
        markets: markets.map((market: any) => ({
          type: market.type,
          description: market.description,
          outcomes: (market.outcomes || []).map((outcome: any) => {
            // outcome.odds: [{ sportsbook, price: string ("+110" / "-120"), decimal: number }]
            const oddsArray = (outcome.odds || []) as Array<any>;

            const filteredOdds = oddsArray.filter((od) => {
              if (!eligibleBookmakers || eligibleBookmakers.length === 0)
                return true;
              const key = toKey(od.sportsbook);
              return eligibleBookmakers.includes(key);
            });

            const bookmakers = filteredOdds.map((od) => {
              const decimal = Number(od.decimal);

              // Convert decimal odds back to an "American-style" price
              let american: number;
              if (decimal >= 2) {
                american = Math.round((decimal - 1) * 100);
              } else {
                american = Math.round(-100 / (decimal - 1));
              }

              return {
                key: toKey(od.sportsbook),
                price: american,
              };
            });

            return {
              name: outcome.name,
              bookmakers,
            };
          }),
        })),
      };
    });
  }


  /**
   * Helper method to format price for display
   */
  private formatPrice(decimal: number): string {
    if (decimal >= 2.0) {
      return `+${Math.round((decimal - 1) * 100)}`;
    } else {
      return `-${Math.round(100 / (decimal - 1))}`;
    }
  }

  /**
   * Helper method to get market description
   */
  private getMarketDescription(marketType: string): string {
    const descriptions: Record<string, string> = {
      "h2h": "Moneyline",
      "spreads": "Point Spread",
      "totals": "Over/Under"
    };
    return descriptions[marketType] || marketType.toUpperCase();
  }
  


  /**
   * Calculate arbitrage opportunities from odds data
   */
  /**
   * Calculate arbitrage / best-value opportunities from odds data.
   *
   * oddsData = comprehensiveData from processAndStoreOddsData:
   * [
   *   {
   *     event: { id, homeTeam, awayTeam, sport, league, startTime, status },
   *     markets: [
   *       {
   *         type,
   *         description,
   *         outcomes: [
   *           {
   *             name,
   *             odds: [
   *               { sportsbook, price, decimal }
   *             ]
   *           }
   *         ]
   *       }
   *     ]
   *   }
   * ]
   */
  private async calculateArbitrageOpportunities(
    eventsData: Array<{
      event: {
        id: string;
        homeTeam: string;
        awayTeam: string;
        sport: string;
        league: string;
        startTime: string;
        status: string;
      };
      markets: Array<{
        type: string;
        description: string;
        outcomes: Array<{
          name?: string;
          label?: string;
          id?: string;
          odds: Array<{
            sportsbook: string;
            price: string;   // american-style string, e.g. "+120"
            decimal: number; // decimal odds used for math
          }>;
        }>;
      }>;
    }>,
    minProfitPct: number
  ): Promise<MaxProfitPick[]> {
    const safeMinProfit = minProfitPct ?? 0.1;

    console.log(
      "[ARB] calculateArbitrageOpportunities called with",
      eventsData ? eventsData.length : 0,
      "events, minProfitPct =",
      safeMinProfit
    );

    const allCandidates: MaxProfitPick[] = [];
    let totalMarkets = 0;
    let marketsWith2Outcomes = 0;
    let debugMarketLogsRemaining = 5; // only spam a few markets

    // 🔹 NEW: basic NFL team "form" ratings from recent scores
    let teamFormStats = new Map<string, TeamFormStats>();
    try {
      teamFormStats = await this.getNflTeamFormStats();
    } catch (err) {
      console.error("[ARB] Error loading team form stats, continuing without:", err);
    }

    for (const eventWrapper of eventsData || []) {
      if (!eventWrapper || !eventWrapper.event || !eventWrapper.markets) continue;

      const eventInfo = eventWrapper.event;

      // Compute a simple "form signal" for this matchup if we have enough data
      const homeForm = teamFormStats.get(eventInfo.homeTeam);
      const awayForm = teamFormStats.get(eventInfo.awayTeam);

      let matchupFormSignal = 0; // -1 = away much stronger, +1 = home much stronger, 0 = even/unknown
      if (
        eventInfo.sport === "americanfootball_nfl" &&
        homeForm &&
        awayForm &&
        homeForm.games >= 3 &&
        awayForm.games >= 3
      ) {
        const marginDiff = homeForm.avgMargin - awayForm.avgMargin; // positive -> home outscoring opps more
        // Cap at about 2 TDs in either direction to avoid insane values
        const capped = Math.max(-14, Math.min(14, marginDiff));
        matchupFormSignal = capped / 14; // [-1, 1]
      }

      for (const market of eventWrapper.markets || []) {
        totalMarkets++;

        const allOutcomes = market.outcomes || [];

        // DEBUG: show raw outcomes + odds shape for a few markets
        if (debugMarketLogsRemaining > 0) {
          const rawOutcomesDebug = allOutcomes.map((o: any) => ({
            label: (o as any).label || o.name || (o as any).id,
            hasOdds: Array.isArray(o.odds) && o.odds.length > 0,
            oddsCount: Array.isArray(o.odds) ? o.odds.length : 0,
            oddsSample: (o.odds || []).slice(0, 2).map((od: any) => ({
              sportsbook: od.sportsbook,
              price: od.price,
              decimal: od.decimal,
            })),
          }));
          console.log("[ARB DEBUG] market raw outcomes", {
            eventId: eventInfo.id,
            homeTeam: eventInfo.homeTeam,
            awayTeam: eventInfo.awayTeam,
            marketType: market.type,
            description: market.description,
            outcomeCount: allOutcomes.length,
            rawOutcomesDebug,
          });
        }

        // 1) Filter to outcomes that actually have odds
        const rawOutcomes = allOutcomes.filter(
          (o: any) => o && Array.isArray(o.odds) && o.odds.length > 0
        );

        if (debugMarketLogsRemaining > 0) {
          console.log("[ARB DEBUG] market filtered outcomes", {
            eventId: eventInfo.id,
            marketType: market.type,
            description: market.description,
            filteredCount: rawOutcomes.length,
          });
        }

        if (rawOutcomes.length < 2) {
          if (debugMarketLogsRemaining > 0) {
            console.log("[ARB DEBUG] SKIP: fewer than 2 outcomes with odds", {
              eventId: eventInfo.id,
              marketType: market.type,
              description: market.description,
            });
            debugMarketLogsRemaining--;
          }
          continue;
        }

        // 2) For each outcome, pick the best decimal price across all sportsbooks
        const bestOutcomeOdds: Array<{
          name: string;
          sportsbook: string;
          american: string;
          decimal: number;
        }> = [];

        rawOutcomes.forEach((outcome: any, index: number) => {
          let bestDecimal = 0;
          let bestSportsbook = "";
          let bestPriceStr = "";

          for (const odd of outcome.odds || []) {
            const decimal = Number(odd.decimal);
            if (!isFinite(decimal) || decimal <= 1.01) {
              if (debugMarketLogsRemaining > 0) {
                console.log("[ARB DEBUG] skipping odd due to bad decimal", {
                  outcomeLabel:
                    (outcome as any).label ||
                    outcome.name ||
                    (outcome as any).id,
                  sportsbook: odd.sportsbook,
                  price: odd.price,
                  decimal,
                });
              }
              continue;
            }

            if (decimal > bestDecimal) {
              bestDecimal = decimal;
              bestSportsbook = odd.sportsbook;
              bestPriceStr = odd.price;
            }
          }

          if (bestSportsbook) {
            const baseName =
              (outcome as any).label ||
              outcome.name ||
              (outcome as any).id ||
              `Outcome ${index + 1}`;

            // Ensure outcome names are unique per market
            let name = baseName;
            let suffix = 2;
            while (bestOutcomeOdds.some((o) => o.name === name)) {
              name = `${baseName} #${suffix}`;
              suffix++;
            }

            bestOutcomeOdds.push({
              name,
              sportsbook: bestSportsbook,
              american: bestPriceStr,
              decimal: bestDecimal,
            });
          } else if (debugMarketLogsRemaining > 0) {
            console.log("[ARB DEBUG] SKIP outcome: no valid decimal odds", {
              outcomeLabel:
                (outcome as any).label ||
                outcome.name ||
                (outcome as any).id ||
                `Outcome ${index + 1}`,
            });
          }
        });

        if (bestOutcomeOdds.length < 2) {
          if (debugMarketLogsRemaining > 0) {
            console.log(
              "[ARB DEBUG] SKIP: fewer than 2 outcomes with valid prices",
              {
                eventId: eventInfo.id,
                marketType: market.type,
                description: market.description,
                bestOutcomeCount: bestOutcomeOdds.length,
                bestOutcomeOdds,
              }
            );
            debugMarketLogsRemaining--;
          }
          continue;
        }

        marketsWith2Outcomes++;

        // 3) Classic arbitrage math: sum of implied probs, then "edge"
        const impliedProbs = bestOutcomeOdds.map((o) => 1 / o.decimal);
        const sumImplied = impliedProbs.reduce((acc, p) => acc + p, 0);
        const profitPct = (1 / sumImplied - 1) * 100; // >0 = true arb, <0 = house edge

        if (allCandidates.length < 5) {
          console.log("[ARB] sample market", {
            eventId: eventInfo.id,
            marketType: market.type,
            description: market.description,
            outcomeCount: bestOutcomeOdds.length,
            outcomeNames: bestOutcomeOdds.map((o) => o.name),
            sum: sumImplied,
            profitPct,
          });
        }

        // 4) Stake sizing using standard hedged allocation
        const bankroll = 10000;
        const stakes = bestOutcomeOdds.map((o) => {
          const weight = (1 / o.decimal) / sumImplied; // fraction of bankroll on this leg
          const stake = bankroll * weight;
          return Math.round(stake * 100) / 100; // round to cents
        });

        const totalStake = stakes.reduce((a, b) => a + b, 0);
        const guaranteedReturn =
          stakes.length > 0 ? stakes[0] * bestOutcomeOdds[0].decimal : 0;
        const lockedProfit = guaranteedReturn - totalStake;

        // 5) Confidence score:
        //    - market "edge" (profitPct) in [-5, +5]  -> [0, 1]
        //    - how strong the form signal is (big point diff vs opponents)
        //    - whether the odds favorite aligns with the stronger team
        const profitComponent = Math.max(
          0,
          Math.min(1, (profitPct + 5) / 10)
        ); // 0..1

        const formStrength = Math.min(1, Math.abs(matchupFormSignal)); // 0..1

        let formAlignment = 0.5; // neutral default
        if (matchupFormSignal !== 0 && bestOutcomeOdds.length === 2) {
          const [opt1, opt2] = bestOutcomeOdds;
          const homeName = eventInfo.homeTeam.toLowerCase();
          const awayName = eventInfo.awayTeam.toLowerCase();

          // Lower decimal => shorter odds => favorite
          const favorite =
            opt1.decimal <= opt2.decimal ? opt1 : opt2;
          const favoriteName = favorite.name.toLowerCase();

          const expectedFavorite =
            matchupFormSignal > 0
              ? homeName
              : matchupFormSignal < 0
              ? awayName
              : null;

          if (expectedFavorite) {
            if (favoriteName.includes(expectedFavorite)) {
              // Market favorite matches the recently-stronger team
              formAlignment = 1;
            } else {
              // Market is favoring the team with worse recent form
              formAlignment = 0.2;
            }
          }
        }

        const combinedScore =
          0.5 * profitComponent + 0.3 * formAlignment + 0.2 * formStrength;
        const confidenceScore = Math.round(combinedScore * 100);

        const legs = bestOutcomeOdds.map((o, idx) => ({
          outcome: o.name,
          sportsbook: this.formatSportsbookName(o.sportsbook),
          odds: o.american,
          stake: stakes[idx],
        }));

        allCandidates.push({
          event: {
            id: eventInfo.id,
            homeTeam: eventInfo.homeTeam,
            awayTeam: eventInfo.awayTeam,
            sport: eventInfo.sport,
            league: eventInfo.league,
            startTime: new Date(eventInfo.startTime).toLocaleString(),
          },
          market: {
            type: (market.type || "").toUpperCase(),
            description: market.description,
          },
          legs,
          profitPct,
          validityWindow: 120,
          confidenceScore,
          lockedProfit,
        });
      }
    }

    console.log(
      "[ARB] markets scanned:",
      totalMarkets,
      "with >=2 valid outcomes:",
      marketsWith2Outcomes,
      "candidates built:",
      allCandidates.length
    );

    if (allCandidates.length === 0) {
      console.log("[ARB] No candidates built at all");
      return [];
    }

    // --- "Safest/value slice" selection logic ---

    // 1) Markets with true arb or positive edge >= safeMinProfit
    const positive = allCandidates.filter(
      (c) => c.profitPct >= safeMinProfit
    );

    // 2) "Safer" markets: small house edge, cap at -5% so we don't show trash
    const negative = allCandidates.filter(
      (c) => c.profitPct < safeMinProfit && c.profitPct >= -5
    );

    positive.sort((a, b) => b.profitPct - a.profitPct);
    negative.sort((a, b) => b.profitPct - a.profitPct);

    const combined = [...positive, ...negative];

    if (combined.length === 0) {
      // If literally nothing is better than -5%, just return the top 30 by edge.
      const sortedByProfit = [...allCandidates].sort(
        (a, b) => b.profitPct - a.profitPct
      );
      console.log(
        "[ARB] no candidates above -5% edge; returning top",
        Math.min(30, sortedByProfit.length),
        "by profitPct"
      );
      return sortedByProfit.slice(0, 30);
    }

    console.log("[ARB] combined positive + safest/value markets", {
      positiveCount: positive.length,
      nearEvenCount: negative.length,
      maxProfitPct: combined[0].profitPct,
      minProfitPct: combined[combined.length - 1].profitPct,
    });

    // Return at most 30 of the "best slice" of the board
    return combined.slice(0, 30);
  }




  /**
   * Convert American odds to decimal odds
   */
  private convertAmericanToDecimal(americanOdds: number): number {
    if (americanOdds > 0) {
      return (americanOdds / 100) + 1;
    } else {
      return (100 / Math.abs(americanOdds)) + 1;
    }
  }

  /**
   * Format sportsbook name for display
   */
  private formatSportsbookName(key: string): string {
    const names: Record<string, string> = {
      "fanduel": "FanDuel",
      "draftkings": "DraftKings", 
      "caesars": "Caesars",
      "betmgm": "BetMGM",
      "betrivers": "BetRivers"
    };
    return names[key] || key;
  }

  /**
   * Format American odds for display
   */
  private formatOdds(americanOdds: number): string {
    return americanOdds > 0 ? `+${americanOdds}` : `${americanOdds}`;
  }

  /**
   * Get state map for admin management
   */
  getStateMap(): Record<string, string[]> {
    return { ...this.stateMap };
  }

  /**
   * Update state map (admin function)
   */
  updateStateMap(newStateMap: Record<string, string[]>): void {
    this.stateMap = { ...newStateMap };
  }

  // Legacy method - kept for backward compatibility during transition
  async recalculateArbitrage() {
    // This method is deprecated in favor of the credit-conscious scan approach
    // Return a mock job for now to maintain API compatibility
    const job = await storage.createJobRun({
      jobName: "arbitrage_recalc",
      status: "success",
    });

    await storage.updateJobRun(job.id, {
      status: "success",
      finishedAt: new Date(),
      metrics: { message: "Use the new credit-conscious scan instead" },
    });

    return job;
  }

  private async detectArbitrage(
    eventId: string,
    marketId: string,
    quotes: Quote[]
  ): Promise<ArbitrageCalculation | null> {
    if (quotes.length < 2) return null;

    // Group quotes by outcome
    const outcomeGroups = quotes.reduce((groups, quote) => {
      if (!groups[quote.outcomeId]) {
        groups[quote.outcomeId] = [];
      }
      groups[quote.outcomeId].push(quote);
      return groups;
    }, {} as Record<string, Quote[]>);

    const outcomes = Object.keys(outcomeGroups);
    if (outcomes.length < 2) return null;

    // Find best odds for each outcome
    const bestOdds = outcomes.map(outcomeId => {
      const quotes = outcomeGroups[outcomeId];
      const bestQuote = quotes.reduce((best, current) => {
        const currentPrice = parseFloat(current.priceValue);
        const bestPrice = parseFloat(best.priceValue);
        return currentPrice > bestPrice ? current : best;
      });

      return {
        outcomeId,
        quote: bestQuote,
        price: parseFloat(bestQuote.priceValue),
      };
    });

    // Calculate arbitrage
    const impliedProbabilities = bestOdds.map(odd => 1 / odd.price);
    const totalImpliedProb = impliedProbabilities.reduce((sum, prob) => sum + prob, 0);

    // Check if arbitrage exists (total implied probability < 1)
    if (totalImpliedProb >= 1) return null;

    const profitMargin = 1 - totalImpliedProb;
    const expectedProfitPct = (profitMargin * 100);

    // Calculate stake fractions
    const defaultBankroll = 10000;
    const legs = bestOdds.map((odd, index) => {
      const stakeFraction = impliedProbabilities[index] / totalImpliedProb;
      return {
        sportsbookId: odd.quote.sportsbookId,
        outcomeId: odd.outcomeId,
        priceValue: odd.price,
        stakeFraction,
      };
    });

    // Calculate recommended stakes
    const recommendedStakes = legs.reduce((stakes, leg) => {
      stakes[leg.sportsbookId] = Math.round(defaultBankroll * leg.stakeFraction);
      return stakes;
    }, {} as Record<string, number>);

    // Calculate confidence score based on odds stability and market depth
    const confidenceScore = this.calculateConfidenceScore(quotes);

    return {
      eventId,
      marketId,
      legs,
      expectedProfitPct,
      recommendedStakes,
      confidenceScore,
    };
  }

  private calculateConfidenceScore(quotes: Quote[]): number {
    // Simple confidence calculation based on:
    // - Number of quotes (more = better)
    // - Recency of quotes (newer = better)
    // - Spread between best and worst odds (tighter = better)

    const now = Date.now();
    const avgAge = quotes.reduce((sum, quote) => {
      return sum + (now - new Date(quote.timestamp!).getTime());
    }, 0) / quotes.length;

    // Score based on age (newer is better, max 1 hour old gets full points)
    const ageScore = Math.max(0, 1 - (avgAge / (60 * 60 * 1000))); // 1 hour = 0 points

    // Score based on quote count (more quotes = more confidence)
    const countScore = Math.min(1, quotes.length / 5); // 5+ quotes = full points

    // Combined score
    return Math.round((ageScore * 0.6 + countScore * 0.4) * 100) / 100;
  }

  /**
   * Legacy simulation method - maintained for backward compatibility
   * TODO: Consider removing or integrating with credit-conscious flow
   */
  async simulateArbitrage(params: {
    bankroll: number;
    targetProfit?: number;
    markets: string[];
  }) {
    await auditService.log("system", "arbitrage_simulation_started", "calculation", null, params);

    // For demonstration, return a mock simulation
    // In production, this would calculate actual stakes and outcomes
    const simulation = {
      bankroll: params.bankroll,
      stakes: {
        "Lakers (+110)": Math.round(params.bankroll * 0.52),
        "Warriors (-115)": Math.round(params.bankroll * 0.48),
      },
      expectedProfit: params.bankroll * 0.032, // 3.2% profit
      profitMargin: 3.2,
      worstCaseScenario: params.bankroll * 0.028,
      bestCaseScenario: params.bankroll * 0.035,
      riskAssessment: {
        maxLoss: 0,
        probability: 1.0,
        recommendations: [
          "Verify odds are still available before placing",
          "Monitor for line movements",
          "Consider reducing stake sizes for safer play",
        ],
      },
    };

    await auditService.log("system", "arbitrage_simulation_completed", "calculation", null, {
      expectedProfit: simulation.expectedProfit,
      profitMargin: simulation.profitMargin,
    });

    return simulation;
  }
}

export const arbitrageService = new ArbitrageService();

// Export types for API usage
export type { EstimateRequest, EstimateResponse, MaxProfitPick };
