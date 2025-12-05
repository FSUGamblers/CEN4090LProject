import { storage } from "../storage";
import { auditService } from "./auditService";
import type { InsertQuote, InsertEvent, InsertMarket } from "@shared/schema";

interface OddsApiResponse {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    last_update: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
      }>;
    }>;
  }>;
}

class OddsService {
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.the-odds-api.com/v4";

  constructor() {
    this.apiKey = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || "";
    if (!this.apiKey) {
      console.warn("No Odds API key found. Odds ingestion will be disabled.");
    }
  }

  async fetchOdds(options: {
    leagues?: string[];
    liveOnly?: boolean;
    maxPages?: number;
  } = {}) {
    if (!this.apiKey) {
      throw new Error("Odds API key not configured");
    }

    const job = await storage.createJobRun({
      jobName: "odds_fetch",
      status: "running",
    });

    try {
      await auditService.log("system", "odds_fetch_started", "job", job.id, options);

      // Make actual API calls to The Odds API
      const { data: realOdds, creditUsage } = await this.fetchFromOddsAPI(options);

      // 🔍 TEMP DEBUG: fetch and log a small sample of NFL scores/stats
      await this.debugFetchNflScores();

      await this.processOddsData(realOdds);
      
      // Store cost record as an API cost in USD
      await storage.createCostRecord({
        category: "api",                            // required: api | compute | storage | misc
        amount: creditUsage.used != null ? creditUsage.used.toFixed(2) : "0.00",
        currency: "USD",                            // optional (default "USD"), but explicit is OK
        metadata: {
          operation: "odds_fetch",
          leagues: options.leagues || [],
          eventsProcessed: realOdds.length,
        },
      });


      await storage.updateJobRun(job.id, {
        status: "success",
        finishedAt: new Date(),
        metrics: {
          eventsProcessed: realOdds.length,
          quotesCreated: realOdds.reduce((sum, event) => sum + event.bookmakers.length * 2, 0),
        },
      });

      await auditService.log("system", "odds_fetch_completed", "job", job.id, {
        eventsProcessed: realOdds.length,
        creditsUsed: creditUsage.used,
        creditsRemaining: creditUsage.remaining
      });

      return job;
    } catch (error) {
      await storage.updateJobRun(job.id, {
        status: "failed",
        finishedAt: new Date(),
        errorSummary: error instanceof Error ? error.message : "Unknown error",
      });

      await auditService.log("system", "odds_fetch_failed", "job", job.id, {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw error;
    }
  }

  async fetchFromOddsAPI(options: {
    leagues?: string[];
    liveOnly?: boolean;
    maxPages?: number;
  } = {}): Promise<{ data: OddsApiResponse[]; creditUsage: { used: number; remaining: number; } }> {
    if (!this.apiKey) {
      throw new Error("Odds API key not configured");
    }

    const { leagues = ["americanfootball_nfl"], liveOnly = false, maxPages = 3 } = options;
    const allOdds: OddsApiResponse[] = [];
    let totalCreditsUsed = 0;
    let remainingCredits = 500; // Default fallback

    // Fetch odds for each sport
    for (const sport of leagues) {
      const url = `${this.baseUrl}/sports/${sport}/odds`;
      const params = new URLSearchParams({
        apiKey: this.apiKey,
        regions: 'us,us2',
        markets: 'h2h,spreads,totals',
        oddsFormat: 'decimal',
        bookmakers: 'draftkings,fanduel,caesars,betmgm,betrivers,pointsbet,wynnbet',
        dateFormat: 'iso',
      });

      try {
        console.log(`Fetching odds for ${sport}...`);
        const response = await fetch(`${url}?${params.toString()}`);
        
        if (!response.ok) {
          throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
        }

        const data: OddsApiResponse[] = await response.json();
        
        // Track real credit usage from headers
        const remainingRequests = response.headers.get('x-requests-remaining');
        const requestsUsed = response.headers.get('x-requests-used');
        
        // Update credit tracking with real API values
        if (requestsUsed) totalCreditsUsed = parseInt(requestsUsed);
        if (remainingRequests) remainingCredits = parseInt(remainingRequests);
        
        console.log(`Fetched ${data.length} events for ${sport}. Requests remaining: ${remainingRequests}, used: ${requestsUsed}`);
        
        allOdds.push(...data);
        
        // Rate limiting - pause between requests
        if (leagues.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to fetch odds for ${sport}:`, error);
        // Continue with other sports even if one fails
      }
    }

    return {
      data: allOdds,
      creditUsage: {
        used: totalCreditsUsed,
        remaining: remainingCredits
      }
    };
  }

  // 🔍 Option B: helper to fetch and log a sample of NFL scores/stats
  private async debugFetchNflScores(): Promise<void> {
    if (!this.apiKey) {
      console.warn("[ODDS DEBUG] No API key configured; skipping NFL scores sample.");
      return;
    }

    const url = `${this.baseUrl}/sports/americanfootball_nfl/scores`;
    const params = new URLSearchParams({
      apiKey: this.apiKey,
      daysFrom: "3",
    });

    try {
      console.log("[ODDS DEBUG] Fetching sample NFL scores/stats...");
      const response = await fetch(`${url}?${params.toString()}`);

      if (!response.ok) {
        console.warn(
          "[ODDS DEBUG] Failed to fetch NFL scores sample:",
          response.status,
          response.statusText
        );
        return;
      }

      const data = await response.json();
      const sample = Array.isArray(data) ? data.slice(0, 2) : data;

      console.log(
        "[ODDS DEBUG] NFL scores sample:",
        JSON.stringify(sample, null, 2)
      );
    } catch (err) {
      console.error("[ODDS DEBUG] Error while fetching NFL scores sample:", err);
    }
  }

  private async simulateOddsData(): Promise<OddsApiResponse[]> {
    // This simulates the structure of real Odds API data
    // In production, replace this with actual API calls
    return [
      {
        id: "event_1",
        sport_key: "basketball_nba",
        sport_title: "NBA",
        commence_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
        home_team: "Los Angeles Lakers",
        away_team: "Golden State Warriors",
        bookmakers: [
          {
            key: "draftkings",
            title: "DraftKings",
            last_update: new Date().toISOString(),
            markets: [
              {
                key: "h2h",
                outcomes: [
                  { name: "Los Angeles Lakers", price: 2.10 },
                  { name: "Golden State Warriors", price: 1.85 },
                ],
              },
            ],
          },
          {
            key: "fanduel",
            title: "FanDuel",
            last_update: new Date().toISOString(),
            markets: [
              {
                key: "h2h",
                outcomes: [
                  { name: "Los Angeles Lakers", price: 2.15 },
                  { name: "Golden State Warriors", price: 1.87 },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "event_2",
        sport_key: "americanfootball_nfl",
        sport_title: "NFL",
        commence_time: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
        home_team: "Pittsburgh Steelers",
        away_team: "Baltimore Ravens",
        bookmakers: [
          {
            key: "caesars",
            title: "Caesars",
            last_update: new Date().toISOString(),
            markets: [
              {
                key: "totals",
                outcomes: [
                  { name: "Over 45.5", price: 1.92 },
                  { name: "Under 45.5", price: 1.96 },
                ],
              },
            ],
          },
          {
            key: "betmgm",
            title: "BetMGM",
            last_update: new Date().toISOString(),
            markets: [
              {
                key: "totals",
                outcomes: [
                  { name: "Over 45.5", price: 1.89 },
                  { name: "Under 45.5", price: 2.04 },
                ],
              },
            ],
          },
        ],
      },
    ];
  }

  private async processOddsData(oddsData: OddsApiResponse[]) {
    for (const eventData of oddsData) {
      // Ensure sport exists
      let sport = await storage.getSportByCode(eventData.sport_key);
      if (!sport) {
        sport = await storage.createSport({
          name: eventData.sport_title,
          code: eventData.sport_key,
        });
      }

      // Ensure league exists
      const leagues = await storage.getLeagues(sport.id);
      let league = leagues[0];
      if (!league) {
        league = await storage.createLeague({
          sportId: sport.id,
          name: eventData.sport_title,
          region: "US",
        });
      }

      // Create or update event
      const event = await storage.createEvent({
        leagueId: league.id,
        startTime: new Date(eventData.commence_time),
        status: "scheduled",
        externalRefs: { oddsApiId: eventData.id },
      });

      // Process each bookmaker's markets
      for (const bookmaker of eventData.bookmakers) {
        // Ensure sportsbook exists
        const sportsbooks = await storage.getSportsbooks();
        let sportsbook = sportsbooks.find(sb => sb.name === bookmaker.title);
        if (!sportsbook) {
          sportsbook = await storage.createSportsbook({
            name: bookmaker.title,
            supportedStates: ["NJ", "PA", "NY"], // Default states
            constraints: {
              minBet: 1,
              maxBet: 10000,
              marketSupport: ["h2h", "totals", "spreads"],
              notes: "Auto-created from odds data",
            },
          });
        }

        // Process each market
        for (const marketData of bookmaker.markets) {
          // Create market
          const market = await storage.createMarket({
            eventId: event.id,
            marketType: marketData.key,
            outcomes: marketData.outcomes.map((outcome, index) => ({
              id: `outcome_${index}`,
              label: outcome.name,
            })),
          });

          // Create quotes for each outcome
          const quotes: InsertQuote[] = marketData.outcomes.map((outcome, index) => ({
            marketId: market.id,
            sportsbookId: sportsbook!.id,
            outcomeId: `outcome_${index}`,
            priceFormat: "decimal",
            priceValue: outcome.price.toString(),
            isLive: false,
            stateAvailability: ["NJ", "PA", "NY"],
            sourceLatencyMs: 100,
          }));

          await storage.createQuotes(quotes);
        }
      }
    }
  }

  async normalizePrice(price: number, format: "decimal" | "american" | "fractional"): Promise<number> {
    switch (format) {
      case "decimal":
        return price;
      case "american":
        return price > 0 ? (price / 100) + 1 : (100 / Math.abs(price)) + 1;
      case "fractional":
        // Assuming fractional is passed as decimal representation
        return price + 1;
      default:
        return price;
    }
  }
}

export const oddsService = new OddsService();
