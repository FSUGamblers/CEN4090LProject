import {
  users,
  sports,
  leagues,
  teams,
  sportsbooks,
  computeLocations,
  events,
  markets,
  quotes,
  arbitrageOpportunities,
  userBets,
  hedgeSuggestions,
  costRecords,
  pnlRecords,
  jobRuns,
  featureFlags,
  auditLogs,
  insertCostRecordSchema,
  type User,
  type UpsertUser,
  type Sport,
  type League,
  type Team,
  type Sportsbook,
  type ComputeLocation,
  type Event,
  type Market,
  type Quote,
  type ArbitrageOpportunity,
  type UserBet,
  type HedgeSuggestion,
  type CostRecord,
  type PnlRecord,
  type JobRun,
  type FeatureFlag,
  type AuditLog,
  type InsertSport,
  type InsertLeague,
  type InsertTeam,
  type InsertSportsbook,
  type InsertComputeLocation,
  type InsertEvent,
  type InsertMarket,
  type InsertQuote,
  type InsertArbitrageOpportunity,
  type InsertUserBet,
  type InsertHedgeSuggestion,
  type InsertCostRecord,
  type InsertPnlRecord,
  type InsertJobRun,
  type InsertFeatureFlag,
  type InsertAuditLog,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  // User operations (required for App Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Sports operations
  getSports(): Promise<Sport[]>;
  createSport(sport: InsertSport): Promise<Sport>;
  getSportByCode(code: string): Promise<Sport | undefined>;

  // League operations
  getLeagues(sportId?: string): Promise<League[]>;
  createLeague(league: InsertLeague): Promise<League>;

  // Team operations
  getTeams(leagueId?: string): Promise<Team[]>;
  createTeam(team: InsertTeam): Promise<Team>;

  // Sportsbook operations
  getSportsbooks(): Promise<Sportsbook[]>;
  createSportsbook(sportsbook: InsertSportsbook): Promise<Sportsbook>;
  getSportsbooksByState(stateCode: string): Promise<Sportsbook[]>;

  // Compute location operations
  getComputeLocations(): Promise<ComputeLocation[]>;
  createComputeLocation(location: InsertComputeLocation): Promise<ComputeLocation>;
  getActiveComputeLocations(): Promise<ComputeLocation[]>;

  // Event operations
  getEvents(filters?: {
    leagueId?: string;
    status?: string;
    from?: Date;
    to?: Date;
    sportId?: string;
  }): Promise<Event[]>;
  getEvent(id: string): Promise<Event | undefined>;
  createEvent(event: InsertEvent): Promise<Event>;

  // Market operations
  getMarkets(eventId: string): Promise<Market[]>;
  createMarket(market: InsertMarket): Promise<Market>;

  // Quote operations
  getQuotes(marketId: string, live?: boolean): Promise<Quote[]>;
  createQuote(quote: InsertQuote): Promise<Quote>;
  createQuotes(quotes: InsertQuote[]): Promise<Quote[]>;

  // Arbitrage opportunity operations
  getArbitrageOpportunities(filters?: {
    leagueId?: string;
    minProfit?: number;
    live?: boolean;
    stateCode?: string;
    sportId?: string;
    activeOnly?: boolean;
  }): Promise<ArbitrageOpportunity[]>;
  createArbitrageOpportunity(opportunity: InsertArbitrageOpportunity): Promise<ArbitrageOpportunity>;
  deleteExpiredArbitrageOpportunities(): Promise<void>;

  // User bet operations
  getUserBets(userId: string, filters?: { status?: string; sportId?: string }): Promise<UserBet[]>;
  getUserBet(id: string): Promise<UserBet | undefined>;
  createUserBet(bet: InsertUserBet): Promise<UserBet>;
  updateUserBet(id: string, updates: Partial<UserBet>): Promise<UserBet>;

  // Hedge suggestion operations
  getHedgeSuggestions(userBetId: string): Promise<HedgeSuggestion[]>;
  createHedgeSuggestion(suggestion: InsertHedgeSuggestion): Promise<HedgeSuggestion>;

  // Cost and PnL operations
  createCostRecord(cost: InsertCostRecord): Promise<CostRecord>;
  createPnlRecord(pnl: InsertPnlRecord): Promise<PnlRecord>;
  getPnlSummary(from?: Date, to?: Date, bucket?: string): Promise<any>;

  // Job operations
  getJobRuns(): Promise<JobRun[]>;
  createJobRun(job: InsertJobRun): Promise<JobRun>;
  updateJobRun(id: string, updates: Partial<JobRun>): Promise<JobRun>;

  // Feature flag operations
  getFeatureFlags(): Promise<FeatureFlag[]>;
  getFeatureFlag(key: string): Promise<FeatureFlag | undefined>;
  upsertFeatureFlag(flag: InsertFeatureFlag): Promise<FeatureFlag>;

  // Audit log operations
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(filters?: { since?: Date; actor?: string }): Promise<AuditLog[]>;

  // Comprehensive odds data operations for Lines page and arbitrage display
  getComprehensiveOddsData(filters?: {
    sportId?: string;
    stateCode?: string;
    since?: Date;
    eventStatus?: string;
    limit?: number;
  }): Promise<Array<{
    event: Event & {
      sport: Sport;
      league: League;
      homeTeam?: Team;
      awayTeam?: Team;
    };
    markets: Array<{
      market: Market;
      quotes: Array<Quote & { sportsbook: Sportsbook }>;
    }>;
  }>>;

  // Get all events with comprehensive details (teams, sport, league)
  getEventsWithDetails(filters?: {
    sportId?: string;
    leagueId?: string;
    status?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<Array<Event & {
    sport: Sport;
    league: League;
    homeTeam?: Team;
    awayTeam?: Team;
  }>>;

  getEventWithDetails(eventId: string): Promise<
    (Event & {
      sport: Sport;
      league: League;
      homeTeam?: Team;
      awayTeam?: Team;
    }) | undefined
  >;

  // Get quotes with full context for arbitrage calculations
  getQuotesWithContext(filters?: {
    eventId?: string;
    marketType?: string;
    live?: boolean;
    stateCode?: string;
  }): Promise<Array<Quote & {
    sportsbook: Sportsbook;
    market: Market & {
      event: Event & {
        sport: Sport;
        league: League;
        homeTeam?: Team;
        awayTeam?: Team;
      };
    };
  }>>;

  // Helper method to ensure teams exist and create if needed
  findOrCreateTeam(name: string, leagueId: string, shortName?: string): Promise<Team>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    // Ensure legacy databases allow nullable event IDs for manual bets
    // This aligns runtime schema with the latest migrations even if they haven't been applied.
    void this.ensureUserBetEventIdNullable();
  }

  private async ensureUserBetEventIdNullable() {
    try {
      await db.execute(sql`ALTER TABLE "user_bets" ALTER COLUMN "event_id" DROP NOT NULL`);
    } catch (error) {
      // If the constraint has already been dropped or the query fails, log at debug level and continue.
      console.debug("Schema check: user_bets.event_id already nullable or alter failed", error);
    }
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Sports operations
  async getSports(): Promise<Sport[]> {
    return await db.select().from(sports);
  }

  async createSport(sport: InsertSport): Promise<Sport> {
    const [created] = await db.insert(sports).values(sport).returning();
    return created;
  }

  async getSportByCode(code: string): Promise<Sport | undefined> {
    const [sport] = await db.select().from(sports).where(eq(sports.code, code));
    return sport;
  }

  // League operations
  async getLeagues(sportId?: string): Promise<League[]> {
    if (sportId) {
      return await db.select().from(leagues).where(eq(leagues.sportId, sportId));
    }
    return await db.select().from(leagues);
  }

  async createLeague(league: InsertLeague): Promise<League> {
    const [created] = await db.insert(leagues).values(league).returning();
    return created;
  }

  // Team operations
  async getTeams(leagueId?: string): Promise<Team[]> {
    if (leagueId) {
      return await db.select().from(teams).where(eq(teams.leagueId, leagueId));
    }
    return await db.select().from(teams);
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    const [created] = await db.insert(teams).values(team).returning();
    return created;
  }

  // Sportsbook operations
  async getSportsbooks(): Promise<Sportsbook[]> {
    return await db.select().from(sportsbooks);
  }

  async createSportsbook(sportsbook: InsertSportsbook): Promise<Sportsbook> {
    const [created] = await db.insert(sportsbooks).values(sportsbook).returning();
    return created;
  }

  async getSportsbooksByState(stateCode: string): Promise<Sportsbook[]> {
    return await db
      .select()
      .from(sportsbooks)
      .where(sql`${stateCode} = ANY(${sportsbooks.supportedStates})`);
  }

  // Compute location operations
  async getComputeLocations(): Promise<ComputeLocation[]> {
    return await db.select().from(computeLocations);
  }

  async createComputeLocation(location: InsertComputeLocation): Promise<ComputeLocation> {
    const [created] = await db.insert(computeLocations).values(location).returning();
    return created;
  }

  async getActiveComputeLocations(): Promise<ComputeLocation[]> {
    return await db
      .select()
      .from(computeLocations)
      .where(eq(computeLocations.status, "active"));
  }

  // Event operations
  async getEvents(filters?: {
    leagueId?: string;
    status?: string;
    from?: Date;
    to?: Date;
    sportId?: string;
  }): Promise<Event[]> {
    let query = db.select().from(events);
    
    if (filters) {
      const conditions = [];
      if (filters.leagueId) conditions.push(eq(events.leagueId, filters.leagueId));
      if (filters.status) conditions.push(eq(events.status, filters.status));
      if (filters.from) conditions.push(gte(events.startTime, filters.from));
      if (filters.to) conditions.push(lte(events.startTime, filters.to));
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
    }
    
    return await query.orderBy(desc(events.startTime));
  }

  async getEvent(id: string): Promise<Event | undefined> {
    const [event] = await db.select().from(events).where(eq(events.id, id));
    return event;
  }

  async createEvent(event: InsertEvent): Promise<Event> {
    const [created] = await db.insert(events).values(event).returning();
    return created;
  }

  // Market operations
  async getMarkets(eventId: string): Promise<Market[]> {
    return await db.select().from(markets).where(eq(markets.eventId, eventId));
  }

  async createMarket(market: InsertMarket): Promise<Market> {
    const [created] = await db.insert(markets).values(market).returning();
    return created;
  }

  // Quote operations
  async getQuotes(marketId: string, live?: boolean): Promise<Quote[]> {
    const whereClause =
      live === undefined
        ? eq(quotes.marketId, marketId)
        : and(
            eq(quotes.marketId, marketId),
            eq(quotes.isLive, live)
          );

    return await db
      .select()
      .from(quotes)
      .where(whereClause)
      .orderBy(desc(quotes.timestamp));
  }




  async createQuote(quote: InsertQuote): Promise<Quote> {
    //const [created] = await db.insert(quotes).values(quote).returning();
    const [created] = await db.select().from(quotes).orderBy(desc(quotes)).limit(1000);
    return created;
  }

  async createQuotes(quotesData: InsertQuote[]): Promise<Quote[]> {
    return await db.insert(quotes).values(quotesData).returning();
  }


  // Arbitrage opportunity operations
  async getArbitrageOpportunities(filters?: {
    leagueId?: string;
    minProfit?: number;
    live?: boolean;
    stateCode?: string;
    sportId?: string;
    activeOnly?: boolean;
  }): Promise<ArbitrageOpportunity[]> {
    let query = db.select().from(arbitrageOpportunities);

    const conditions = [] as any[];

    if (filters?.minProfit) {
      conditions.push(
        gte(arbitrageOpportunities.expectedProfitPct, filters.minProfit.toString())
      );
    }

    if (filters?.activeOnly) {
      conditions.push(gte(arbitrageOpportunities.expiresAt, new Date()));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return await query.orderBy(desc(arbitrageOpportunities.expectedProfitPct));
  }

  async createArbitrageOpportunity(opportunity: InsertArbitrageOpportunity): Promise<ArbitrageOpportunity> {
    const [created] = await db.insert(arbitrageOpportunities).values(opportunity).returning();
    return created;
  }

  async deleteExpiredArbitrageOpportunities(): Promise<void> {
    await db
      .delete(arbitrageOpportunities)
      .where(lte(arbitrageOpportunities.expiresAt, new Date()));
  }

  // User bet operations
  async getUserBets(userId: string, filters?: { status?: string; sportId?: string }): Promise<UserBet[]> {
    let query = db.select().from(userBets).where(eq(userBets.userId, userId));

    if (filters?.status) {
      query = query.where(and(eq(userBets.userId, userId), eq(userBets.status, filters.status)));
    }

    return await query.orderBy(desc(userBets.createdAt));
  }

  async getUserBet(id: string): Promise<UserBet | undefined> {
    const [bet] = await db.select().from(userBets).where(eq(userBets.id, id));
    return bet;
  }

  async createUserBet(bet: InsertUserBet): Promise<UserBet> {
    const [created] = await db.insert(userBets).values(bet).returning();
    return created;
  }

  async updateUserBet(id: string, updates: Partial<UserBet>): Promise<UserBet> {
    const [updated] = await db
      .update(userBets)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(userBets.id, id))
      .returning();
    return updated;
  }

  // Hedge suggestion operations
  async getHedgeSuggestions(userBetId: string): Promise<HedgeSuggestion[]> {
    return await db
      .select()
      .from(hedgeSuggestions)
      .where(eq(hedgeSuggestions.userBetId, userBetId))
      .orderBy(desc(hedgeSuggestions.createdAt));
  }

  async createHedgeSuggestion(suggestion: InsertHedgeSuggestion): Promise<HedgeSuggestion> {
    const [created] = await db.insert(hedgeSuggestions).values(suggestion).returning();
    return created;
  }

  // Cost and PnL operations
  async createCostRecord(cost: InsertCostRecord): Promise<CostRecord> {
    const parsed = insertCostRecordSchema.parse({
      ...cost,
      category: cost.category ?? "api",
    });

    const [created] = await db.insert(costRecords).values(parsed).returning();
    return created;
  }

  async createPnlRecord(pnl: InsertPnlRecord): Promise<PnlRecord> {
    const [created] = await db.insert(pnlRecords).values(pnl).returning();
    return created;
  }

  async getPnlSummary(from?: Date, to?: Date, bucket?: string): Promise<any> {
    let query = db.select().from(pnlRecords);
    
    if (from && to) {
      query = query.where(and(gte(pnlRecords.timestamp, from), lte(pnlRecords.timestamp, to)));
    }
    
    const records = await query;
    
    // Group by type and calculate totals
    const summary = records.reduce((acc, record) => {
      if (!acc[record.type]) {
        acc[record.type] = 0;
      }
      acc[record.type] += Number(record.amount);
      return acc;
    }, {} as Record<string, number>);
    
    return summary;
  }

  // Job operations
  async getJobRuns(): Promise<JobRun[]> {
    return await db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt));
  }

  async createJobRun(job: InsertJobRun): Promise<JobRun> {
    const [created] = await db.insert(jobRuns).values(job).returning();
    return created;
  }

  async updateJobRun(id: string, updates: Partial<JobRun>): Promise<JobRun> {
    const [updated] = await db
      .update(jobRuns)
      .set(updates)
      .where(eq(jobRuns.id, id))
      .returning();
    return updated;
  }

  // Feature flag operations
  async getFeatureFlags(): Promise<FeatureFlag[]> {
    return await db.select().from(featureFlags);
  }

  async getFeatureFlag(key: string): Promise<FeatureFlag | undefined> {
    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.key, key));
    return flag;
  }

  async upsertFeatureFlag(flag: InsertFeatureFlag): Promise<FeatureFlag> {
    const [created] = await db
      .insert(featureFlags)
      .values(flag)
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: {
          ...flag,
          updatedAt: new Date(),
        },
      })
      .returning();
    return created;
  }

  // Audit log operations
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs).values(log).returning();
    return created;
  }

  async getAuditLogs(filters?: { since?: Date; actor?: string }): Promise<AuditLog[]> {
    let query = db.select().from(auditLogs);

    if (filters) {
      const conditions = [];
      if (filters.since) conditions.push(gte(auditLogs.timestamp, filters.since));
      if (filters.actor) conditions.push(eq(auditLogs.actor, filters.actor));

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
    }

    return await query.orderBy(desc(auditLogs.timestamp));
  }


  // Comprehensive odds data operations for Lines page and arbitrage display
  async getComprehensiveOddsData(filters?: {
    sportId?: string;
    stateCode?: string;
    since?: Date;
    eventStatus?: string;
    limit?: number;
  }): Promise<Array<{
    event: Event & {
      sport: Sport;
      league: League;
      homeTeam?: Team;
      awayTeam?: Team;
    };
    markets: Array<{
      market: Market;
      quotes: Array<Quote & { sportsbook: Sportsbook }>;
    }>;
  }>> {
    // Get events with details first
    const eventsWithDetails = await this.getEventsWithDetails({
      sportId: filters?.sportId,
      status: filters?.eventStatus,
      from: filters?.since,
      limit: filters?.limit
    });

    const result = [];
    
    for (const event of eventsWithDetails) {
      const markets = await db.select().from(markets).where(eq(markets.eventId, event.id));
      
      const marketsWithQuotes = [];
      for (const market of markets) {
        // Get quotes for this market
        const marketQuotes = await db.select().from(quotes).where(eq(quotes.marketId, market.id));
        
        const quotesWithSportsbooks = [];
        for (const quote of marketQuotes) {
          const [sportsbook] = await db.select().from(sportsbooks).where(eq(sportsbooks.id, quote.sportsbookId));
          
          // Filter by state if provided
          if (filters?.stateCode && sportsbook?.supportedStates && !sportsbook.supportedStates.includes(filters.stateCode)) {
            continue;
          }
          
          if (sportsbook) {
            quotesWithSportsbooks.push({
              ...quote,
              sportsbook
            });
          }
        }
        
        marketsWithQuotes.push({
          market,
          quotes: quotesWithSportsbooks
        });
      }
      
      result.push({
        event,
        markets: marketsWithQuotes
      });
    }
    
    return result;
  }

  // Get all events with comprehensive details (teams, sport, league)
  async getEventsWithDetails(filters?: {
    sportId?: string;
    leagueId?: string;
    status?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<Array<Event & {
    sport: Sport;
    league: League;
    homeTeam?: Team;
    awayTeam?: Team;
  }>> {
    // Get basic events first
    let eventQuery = db.select().from(events);
    
    if (filters) {
      const conditions = [];
      if (filters.leagueId) conditions.push(eq(events.leagueId, filters.leagueId));
      if (filters.status) conditions.push(eq(events.status, filters.status));
      if (filters.from) conditions.push(gte(events.startTime, filters.from));
      if (filters.to) conditions.push(lte(events.startTime, filters.to));
      
      if (conditions.length > 0) {
        eventQuery = eventQuery.where(and(...conditions));
      }
    }
    
    eventQuery = eventQuery.orderBy(desc(events.startTime));
    
    if (filters?.limit) {
      eventQuery = eventQuery.limit(filters.limit);
    }

    const eventResults = await eventQuery;
    
    const enrichedEvents = [];
    
    for (const event of eventResults) {
      // Get league and sport details
      const [league] = await db.select().from(leagues).where(eq(leagues.id, event.leagueId));
      let sport = null;
      if (league) {
        [sport] = await db.select().from(sports).where(eq(sports.id, league.sportId));
      }
      
      // Filter by sportId if specified
      if (filters?.sportId && sport?.id !== filters.sportId) {
        continue;
      }
      
      // Get home and away teams
      let homeTeam = null;
      let awayTeam = null;
      
      if (event.homeTeamId) {
        [homeTeam] = await db.select().from(teams).where(eq(teams.id, event.homeTeamId));
      }
      if (event.awayTeamId) {
        [awayTeam] = await db.select().from(teams).where(eq(teams.id, event.awayTeamId));
      }
      
      enrichedEvents.push({
        ...event,
        sport: sport || { id: '', name: '', code: '', createdAt: new Date() },
        league: league || { id: '', sportId: '', name: '', region: '', createdAt: new Date() },
        homeTeam,
        awayTeam
      });
    }
    
    return enrichedEvents;
  }

  // Helper method to get a single event with full details by ID
  async getEventWithDetails(eventId: string): Promise<(Event & {
    sport: Sport;
    league: League;
    homeTeam?: Team;
    awayTeam?: Team;
  }) | undefined> {
    // Get the event
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    if (!event) return undefined;

    // Get league and sport details
    const [league] = await db.select().from(leagues).where(eq(leagues.id, event.leagueId));
    if (!league) return undefined;

    const [sport] = await db.select().from(sports).where(eq(sports.id, league.sportId));
    if (!sport) return undefined;

    // Get home and away teams
    let homeTeam = null;
    let awayTeam = null;
    
    if (event.homeTeamId) {
      [homeTeam] = await db.select().from(teams).where(eq(teams.id, event.homeTeamId));
    }
    if (event.awayTeamId) {
      [awayTeam] = await db.select().from(teams).where(eq(teams.id, event.awayTeamId));
    }

    return {
      ...event,
      sport,
      league,
      homeTeam,
      awayTeam
    };
  }

  // Get quotes with full context for arbitrage calculations
  async getQuotesWithContext(filters?: {
    eventId?: string;
    marketType?: string;
    live?: boolean;
    stateCode?: string;
  }): Promise<Array<Quote & {
    sportsbook: Sportsbook;
    market: Market & {
      event: Event & {
        sport: Sport;
        league: League;
        homeTeam?: Team;
        awayTeam?: Team;
      };
    };
  }>> {
    // Build the quotes query with proper filtering
    let quotesQuery = db.select().from(quotes);
    
    if (filters?.live !== undefined) {
      quotesQuery = quotesQuery.where(eq(quotes.isLive, filters.live));
    }

    const quotesResults = await quotesQuery.orderBy(desc(quotes.timestamp));
    const enrichedQuotes = [];
    
    // Cache for events and sportsbooks to avoid repeated queries
    const eventCache = new Map<string, Event & { sport: Sport; league: League; homeTeam?: Team; awayTeam?: Team; } | null>();
    const sportsbookCache = new Map<string, Sportsbook>();
    const marketCache = new Map<string, Market>();
    
    for (const quote of quotesResults) {
      // Get sportsbook (with caching)
      let sportsbook = sportsbookCache.get(quote.sportsbookId);
      if (!sportsbook) {
        const [sb] = await db.select().from(sportsbooks).where(eq(sportsbooks.id, quote.sportsbookId));
        if (!sb) continue;
        sportsbook = sb;
        sportsbookCache.set(quote.sportsbookId, sportsbook);
      }
      
      // Filter by state if specified
      if (filters?.stateCode && sportsbook.supportedStates && !sportsbook.supportedStates.includes(filters.stateCode)) {
        continue;
      }
      
      // Get market (with caching)
      let market = marketCache.get(quote.marketId);
      if (!market) {
        const [m] = await db.select().from(markets).where(eq(markets.id, quote.marketId));
        if (!m) continue;
        market = m;
        marketCache.set(quote.marketId, market);
      }
      
      // Filter by market type if specified
      if (filters?.marketType && market.marketType !== filters.marketType) {
        continue;
      }
      
      // Filter by event ID if specified
      if (filters?.eventId && market.eventId !== filters.eventId) {
        continue;
      }
      
      // Get event with details (with caching)
      let eventDetail = eventCache.get(market.eventId);
      if (eventDetail === undefined) {
        const event = await this.getEventWithDetails(market.eventId);
        eventDetail = event || null;
        eventCache.set(market.eventId, eventDetail);
      }
      
      if (eventDetail && sportsbook) {
        enrichedQuotes.push({
          ...quote,
          sportsbook,
          market: {
            ...market,
            event: eventDetail
          }
        });
      }
    }
    
    return enrichedQuotes;
  }

  // Helper method to ensure teams exist and create if needed
  async findOrCreateTeam(name: string, leagueId: string, shortName?: string): Promise<Team> {
    // Try to find existing team first
    const existingTeams = await this.getTeams(leagueId);
    const existingTeam = existingTeams.find(t => t.name === name || t.shortName === shortName);
    
    if (existingTeam) {
      return existingTeam;
    }
    
    // Create new team if not found
    return await this.createTeam({
      leagueId,
      name,
      shortName: shortName || name.substring(0, 3).toUpperCase()
    });
  }
}

class InMemoryStorage implements IStorage {
  private users = new Map<string, User>();
  private sports: any[] = [];
  private leagues: any[] = [];
  private teams: any[] = [];
  private sportsbooks: any[] = [];
  private computeLocations: any[] = [];
  private events: any[] = [];
  private markets: any[] = [];
  private quotes: any[] = [];
  private arbitrageOpportunities: any[] = [];
  private userBetsStore: any[] = [];
  private hedgeSuggestionsStore: any[] = [];
  private costRecordsStore: any[] = [];
  private pnlRecordsStore: any[] = [];
  private jobRunsStore: any[] = [];
  private featureFlagsStore: any[] = [];
  private auditLogsStore: any[] = [];

  private ensureId<T>(payload: T): T & { id: string } {
    return { ...payload, id: (payload as any).id ?? randomUUID() } as T & { id: string };
  }

  private toTime(value: any): number {
    return value ? new Date(value as any).getTime() : 0;
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const existing = this.users.get(userData.id);
    const user: User = {
      id: userData.id,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      profileImageUrl: userData.profileImageUrl,
      role: existing?.role ?? "member",
      status: existing?.status ?? "active",
      notificationPrefs: existing?.notificationPrefs ?? { inApp: true, email: true, webhook: false },
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };

    this.users.set(user.id, user);
    return user;
  }

  async getSports(): Promise<Sport[]> {
    return [...this.sports];
  }

  async createSport(sport: InsertSport): Promise<Sport> {
    const created = this.ensureId({ ...sport, createdAt: new Date() }) as Sport;
    this.sports.push(created);
    return created;
  }

  async getSportByCode(code: string): Promise<Sport | undefined> {
    return this.sports.find((sport) => sport.code === code);
  }

  async getLeagues(sportId?: string): Promise<League[]> {
    return this.leagues.filter((league) => !sportId || league.sportId === sportId);
  }

  async createLeague(league: InsertLeague): Promise<League> {
    const created = this.ensureId({ ...league, createdAt: new Date() }) as League;
    this.leagues.push(created);
    return created;
  }

  async getTeams(leagueId?: string): Promise<Team[]> {
    return this.teams.filter((team) => !leagueId || team.leagueId === leagueId);
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    const created = this.ensureId({ ...team, createdAt: new Date() }) as Team;
    this.teams.push(created);
    return created;
  }

  async getSportsbooks(): Promise<Sportsbook[]> {
    return [...this.sportsbooks];
  }

  async createSportsbook(sportsbook: InsertSportsbook): Promise<Sportsbook> {
    const created = this.ensureId({
      ...sportsbook,
      supportedStates: sportsbook.supportedStates ?? [],
      createdAt: new Date(),
    }) as Sportsbook;
    this.sportsbooks.push(created);
    return created;
  }

  async getSportsbooksByState(stateCode: string): Promise<Sportsbook[]> {
    return this.sportsbooks.filter((book) => book.supportedStates?.includes(stateCode));
  }

  async getComputeLocations(): Promise<ComputeLocation[]> {
    return [...this.computeLocations];
  }

  async createComputeLocation(location: InsertComputeLocation): Promise<ComputeLocation> {
    const created = this.ensureId({
      ...location,
      status: location.status ?? "active",
      createdAt: new Date(),
    }) as ComputeLocation;
    this.computeLocations.push(created);
    return created;
  }

  async getActiveComputeLocations(): Promise<ComputeLocation[]> {
    return this.computeLocations.filter((loc) => loc.status === "active");
  }

  async getEvents(filters?: { leagueId?: string; status?: string; from?: Date; to?: Date; sportId?: string }): Promise<Event[]> {
    return this.events.filter((event) => {
      const matchesLeague = !filters?.leagueId || event.leagueId === filters.leagueId;
      const matchesStatus = !filters?.status || event.status === filters.status;
      const league = this.leagues.find((l) => l.id === event.leagueId);
      const matchesSport = !filters?.sportId || league?.sportId === filters.sportId;
      const matchesFrom = !filters?.from || event.startTime >= filters.from;
      const matchesTo = !filters?.to || event.startTime <= filters.to;
      return matchesLeague && matchesStatus && matchesSport && matchesFrom && matchesTo;
    });
  }

  async getEvent(id: string): Promise<Event | undefined> {
    return this.events.find((event) => event.id === id);
  }

  async getEventWithDetails(eventId: string): Promise<(Event & { sport: Sport; league: League; homeTeam?: Team; awayTeam?: Team }) | undefined> {
    const event = await this.getEvent(eventId);
    if (!event) return undefined;
    const league = this.leagues.find((l) => l.id === event.leagueId)!;
    const sport = this.sports.find((s) => s.id === league?.sportId)!;
    const homeTeam = event.homeTeamId ? this.teams.find((t) => t.id === event.homeTeamId) : undefined;
    const awayTeam = event.awayTeamId ? this.teams.find((t) => t.id === event.awayTeamId) : undefined;
    return { ...event, sport, league, homeTeam, awayTeam };
  }

  async createEvent(event: InsertEvent): Promise<Event> {
    const created = this.ensureId({
      ...event,
      status: (event as any).status ?? event.status ?? "scheduled",
      createdAt: new Date(),
    }) as Event;
    this.events.push(created);
    return created;
  }

  async getMarkets(eventId: string): Promise<Market[]> {
    return this.markets.filter((market) => market.eventId === eventId);
  }

  async createMarket(market: InsertMarket): Promise<Market> {
    const created = this.ensureId({ ...market, createdAt: new Date() }) as Market;
    this.markets.push(created);
    return created;
  }

  async getQuotes(marketId: string, _live?: boolean): Promise<Quote[]> {
    return this.quotes.filter((quote) => quote.marketId === marketId);
  }

  async createQuote(quote: InsertQuote): Promise<Quote> {
    const created = this.ensureId({ ...quote, timestamp: new Date() }) as Quote;
    this.quotes.push(created);
    return created;
  }

  async createQuotes(quotes: InsertQuote[]): Promise<Quote[]> {
    const created = quotes.map((quote) => this.ensureId({ ...quote, timestamp: new Date() }) as Quote);
    this.quotes.push(...created);
    return created;
  }

  async getArbitrageOpportunities(filters?: { leagueId?: string; minProfit?: number; live?: boolean; stateCode?: string; sportId?: string; activeOnly?: boolean }): Promise<ArbitrageOpportunity[]> {
    return this.arbitrageOpportunities.filter((raw) => {
      const opp = raw as any;
      const matchesLeague = !filters?.leagueId || opp.leagueId === filters.leagueId;
      const matchesSport = !filters?.sportId || opp.sportId === filters.sportId;
      const matchesProfit = typeof filters?.minProfit === "undefined" || Number(opp.expectedProfitPct ?? opp.profitPct ?? 0) >= (filters?.minProfit || 0);
      const matchesLive = typeof filters?.live === "undefined" || opp.live === filters.live;
      const matchesActive = !filters?.activeOnly || !opp.expiresAt || new Date(opp.expiresAt).getTime() > Date.now();
      return matchesLeague && matchesSport && matchesProfit && matchesLive && matchesActive;
    }) as ArbitrageOpportunity[];
  }

  async createArbitrageOpportunity(opportunity: InsertArbitrageOpportunity): Promise<ArbitrageOpportunity> {
    const created = this.ensureId({
      ...opportunity,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as ArbitrageOpportunity;
    this.arbitrageOpportunities.push(created);
    return created;
  }

  async deleteExpiredArbitrageOpportunities(): Promise<void> {
    const now = Date.now();
    this.arbitrageOpportunities = this.arbitrageOpportunities.filter((opp) => !opp.expiresAt || opp.expiresAt.getTime() > now);
  }

  async getUserBets(userId: string, filters?: { status?: string; sportId?: string }): Promise<UserBet[]> {
    return this.userBetsStore
      .filter((bet) => bet.userId === userId)
      .filter((bet) => !filters?.status || bet.status === filters.status)
      .sort((a, b) => this.toTime(b.createdAt) - this.toTime(a.createdAt));
  }

  async getUserBet(id: string): Promise<UserBet | undefined> {
    return this.userBetsStore.find((bet) => bet.id === id);
  }

  async createUserBet(bet: InsertUserBet): Promise<UserBet> {
    const created = this.ensureId({
      ...bet,
      status: bet.status ?? "open",
      stake: bet.stake ?? "0",
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as UserBet;
    this.userBetsStore.push(created);
    return created;
  }

  async updateUserBet(id: string, updates: Partial<UserBet>): Promise<UserBet> {
    const existing = await this.getUserBet(id);
    if (!existing) throw new Error("Bet not found");
    const updated: UserBet = { ...existing, ...updates, updatedAt: new Date() };
    this.userBetsStore = this.userBetsStore.map((bet) => (bet.id === id ? updated : bet));
    return updated;
  }

  async getHedgeSuggestions(userBetId: string): Promise<HedgeSuggestion[]> {
    return this.hedgeSuggestionsStore
      .filter((suggestion) => suggestion.userBetId === userBetId)
      .sort((a, b) => this.toTime(b.createdAt) - this.toTime(a.createdAt));
  }

  async createHedgeSuggestion(suggestion: InsertHedgeSuggestion): Promise<HedgeSuggestion> {
    const created = this.ensureId({ ...suggestion, createdAt: new Date() }) as HedgeSuggestion;
    this.hedgeSuggestionsStore.push(created);
    return created;
  }

  async createCostRecord(cost: InsertCostRecord): Promise<CostRecord> {
    const parsed = insertCostRecordSchema.parse({ ...cost, category: cost.category ?? "api" });
    const created = this.ensureId({ ...parsed, timestamp: new Date() }) as CostRecord;
    this.costRecordsStore.push(created);
    return created;
  }

  async createPnlRecord(pnl: InsertPnlRecord): Promise<PnlRecord> {
    const created = this.ensureId({ ...pnl, timestamp: new Date() }) as PnlRecord;
    this.pnlRecordsStore.push(created);
    return created;
  }

  async getPnlSummary(from?: Date, to?: Date, _bucket?: string): Promise<any> {
    const records = this.pnlRecordsStore.filter((record) => {
      if (from && this.toTime(record.timestamp) < from.getTime()) return false;
      if (to && this.toTime(record.timestamp) > to.getTime()) return false;
      return true;
    });

    return records.reduce((acc, record) => {
      acc[record.type] = (acc[record.type] || 0) + Number(record.amount);
      return acc;
    }, {} as Record<string, number>);
  }

  async getJobRuns(): Promise<JobRun[]> {
    return [...this.jobRunsStore].sort((a, b) => this.toTime(b.startedAt) - this.toTime(a.startedAt));
  }

  async createJobRun(job: InsertJobRun): Promise<JobRun> {
    const created = this.ensureId({
      ...job,
      status: job.status ?? "running",
      startedAt: job.startedAt ?? new Date(),
    }) as JobRun;
    this.jobRunsStore.push(created);
    return created;
  }

  async updateJobRun(id: string, updates: Partial<JobRun>): Promise<JobRun> {
    const existing = this.jobRunsStore.find((job) => job.id === id);
    if (!existing) throw new Error("Job run not found");
    const updated: JobRun = { ...existing, ...updates };
    this.jobRunsStore = this.jobRunsStore.map((job) => (job.id === id ? updated : job));
    return updated;
  }

  async getFeatureFlags(): Promise<FeatureFlag[]> {
    return [...this.featureFlagsStore];
  }

  async getFeatureFlag(key: string): Promise<FeatureFlag | undefined> {
    return this.featureFlagsStore.find((flag) => flag.key === key);
  }

  async upsertFeatureFlag(flag: InsertFeatureFlag): Promise<FeatureFlag> {
    const existing = await this.getFeatureFlag(flag.key);
    if (existing) {
      const updated: FeatureFlag = { ...existing, ...flag, updatedAt: new Date() };
      this.featureFlagsStore = this.featureFlagsStore.map((f) => (f.key === flag.key ? updated : f));
      return updated;
    }
    const created: FeatureFlag = { ...flag, createdAt: new Date(), updatedAt: new Date() } as FeatureFlag;
    this.featureFlagsStore.push(created);
    return created;
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const created = this.ensureId({ ...log, timestamp: new Date() }) as AuditLog;
    this.auditLogsStore.push(created);
    return created;
  }

  async getAuditLogs(filters?: { since?: Date; actor?: string }): Promise<AuditLog[]> {
    return this.auditLogsStore.filter((log) => {
      const matchesSince = !filters?.since || (log.timestamp && this.toTime(log.timestamp) >= filters.since.getTime());
      const matchesActor = !filters?.actor || log.actor === filters.actor;
      return matchesSince && matchesActor;
    });
  }

  async getComprehensiveOddsData(filters?: { sportId?: string; stateCode?: string; since?: Date; eventStatus?: string; limit?: number }): Promise<Array<{ event: Event & { sport: Sport; league: League; homeTeam?: Team; awayTeam?: Team }; markets: Array<{ market: Market; quotes: Array<Quote & { sportsbook: Sportsbook }> }> }>> {
    const events = await this.getEventsWithDetails({ sportId: filters?.sportId, status: filters?.eventStatus });
    const results: Array<{ event: Event & { sport: Sport; league: League; homeTeam?: Team; awayTeam?: Team }; markets: Array<{ market: Market; quotes: Array<Quote & { sportsbook: Sportsbook }> }> }> = [];

    for (const event of events) {
      const eventMarkets = this.markets.filter((market) => market.eventId === event.id);
      const marketEntries = eventMarkets.map((market) => {
        const quotes = this.quotes
          .filter((quote) => quote.marketId === market.id)
          .filter((quote) => !filters?.since || this.toTime(quote.timestamp) >= filters.since.getTime())
          .filter((quote) => {
            if (!filters?.stateCode) return true;
            const book = this.sportsbooks.find((b) => b.id === quote.sportsbookId);
            return book?.supportedStates?.includes(filters.stateCode);
          })
          .map((quote) => ({ ...quote, sportsbook: this.sportsbooks.find((b) => b.id === quote.sportsbookId)! }));

        return { market, quotes };
      });

      results.push({ event, markets: marketEntries });
    }

    return results.slice(0, filters?.limit || results.length);
  }

  async getEventsWithDetails(filters?: { sportId?: string; leagueId?: string; status?: string; from?: Date; to?: Date; limit?: number }): Promise<Array<Event & { sport: Sport; league: League; homeTeam?: Team; awayTeam?: Team }>> {
    const events = await this.getEvents({
      sportId: filters?.sportId,
      leagueId: filters?.leagueId,
      status: filters?.status,
      from: filters?.from,
      to: filters?.to,
    });

    const detailed = events.map((event) => {
      const league = this.leagues.find((l) => l.id === event.leagueId)!;
      const sport = this.sports.find((s) => s.id === league?.sportId)!;
      const homeTeam = event.homeTeamId ? this.teams.find((t) => t.id === event.homeTeamId) : undefined;
      const awayTeam = event.awayTeamId ? this.teams.find((t) => t.id === event.awayTeamId) : undefined;
      return { ...event, sport, league, homeTeam, awayTeam };
    });

    return filters?.limit ? detailed.slice(0, filters.limit) : detailed;
  }

  async getQuotesWithContext(filters?: { eventId?: string; marketType?: string; live?: boolean; stateCode?: string }): Promise<Array<Quote & { sportsbook: Sportsbook; market: Market & { event: Event & { sport: Sport; league: League; homeTeam?: Team; awayTeam?: Team } } }>> {
    const filteredQuotes = this.quotes.filter((quote) => {
      const market = this.markets.find((m) => m.id === quote.marketId);
      if (!market) return false;
      const event = this.events.find((e) => e.id === market.eventId);
      if (!event) return false;
      if (filters?.eventId && event.id !== filters.eventId) return false;
      if (filters?.marketType && market.marketType !== filters.marketType) return false;
      if (typeof filters?.live !== "undefined") {
        const isLive = event.status === "live";
        if (isLive !== filters.live) return false;
      }
      if (filters?.stateCode) {
        const book = this.sportsbooks.find((b) => b.id === quote.sportsbookId);
        if (!book?.supportedStates?.includes(filters.stateCode)) return false;
      }
      return true;
    });

    const eventCache = new Map<string, Event & { sport: Sport; league: League; homeTeam?: Team; awayTeam?: Team }>();
    const enrichedQuotes: Array<Quote & { sportsbook: Sportsbook; market: Market & { event: Event & { sport: Sport; league: League; homeTeam?: Team; awayTeam?: Team } } }> = [];

    for (const quote of filteredQuotes) {
      const sportsbook = this.sportsbooks.find((book) => book.id === quote.sportsbookId);
      const market = this.markets.find((m) => m.id === quote.marketId);
      if (!market || !sportsbook) continue;

      let eventDetail = eventCache.get(market.eventId);
      if (!eventDetail) {
        const event = await this.getEventWithDetails(market.eventId);
        if (event) {
          eventCache.set(market.eventId, event);
          eventDetail = event;
        }
      }

      if (eventDetail) {
        enrichedQuotes.push({ ...quote, sportsbook, market: { ...market, event: eventDetail } });
      }
    }

    return enrichedQuotes;
  }

  async findOrCreateTeam(name: string, leagueId: string, shortName?: string): Promise<Team> {
    const existing = this.teams.find((team) => team.name === name || team.shortName === shortName);
    if (existing) return existing;
    return this.createTeam({ leagueId, name, shortName: shortName || name.substring(0, 3).toUpperCase() });
  }
}

export const storage: IStorage = db ? new DatabaseStorage() : new InMemoryStorage();
