import type { Express } from "express";
import { createServer, type Server } from "http";
import { n8nAgentService } from "./services/n8nAgentService";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./auth";
import { z } from "zod";
import {
  insertEventSchema,
  insertMarketSchema,
  insertQuoteSchema,
  insertUserBetSchema,
  insertCostRecordSchema,
  insertPnlRecordSchema,
  insertJobRunSchema,
  insertFeatureFlagSchema,
  insertAuditLogSchema,
} from "@shared/schema";
import { oddsService } from "./services/oddsService";
import { arbitrageService, type EstimateRequest } from "./services/arbitrageService";
import { jobScheduler } from "./services/jobScheduler";
import { computeHedgeCandidates } from "./services/hedgeService";
import { featureFlagService } from "./services/featureFlagService";
import { auditService } from "./services/auditService";
// Lightweight bearer guard for machine-to-machine calls (e.g., n8n)
function requireBearerOrReject(req: any, res: any, next: any) {
  const expected = process.env.JOB_BEARER_TOKEN;
  if (!expected) {
    console.error('JOB_BEARER_TOKEN not set');
    return res.status(500).json({ message: 'Server misconfigured' });
  }
  const header = req.header('Authorization') || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing bearer token' });
  }
  const token = header.slice('Bearer '.length).trim();
  if (token !== expected) {
    return res.status(403).json({ message: 'Invalid bearer token' });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Dashboard stats
  app.get('/api/dashboard/stats', isAuthenticated, async (req: any, res) => {
    try {
      const [arbitrageOpportunities, userBets, jobRuns] = await Promise.all([
        storage.getArbitrageOpportunities({ activeOnly: true }),
        storage.getUserBets(req.user.claims.sub),
        storage.getJobRuns(),
      ]);

      // Helper to normalize whatever field we're using for "edge"
      const normalizeEdge = (opp: any): number => {
        const raw =
          typeof opp.expectedProfitPct !== 'undefined'
            ? Number(opp.expectedProfitPct)
            : typeof opp.profitPct !== 'undefined'
            ? Number(opp.profitPct)
            : 0;

        return Number.isFinite(raw) ? raw : 0;
      };

      // "Safe" window for value / hedged opportunities (same spirit as calculateArbitrageOpportunities)
      const SAFE_MIN_EDGE = -5; // -5% house edge cutoff for "not trash"

      const safeOpportunities = (arbitrageOpportunities || []).filter(
        (opp: any) => normalizeEdge(opp) >= SAFE_MIN_EDGE
      );

      const activeOpportunities = safeOpportunities.length;

      const trackedBets = (userBets || []).length;

      const avgProfit =
        safeOpportunities.length > 0
          ? safeOpportunities.reduce(
              (sum: number, opp: any) => sum + normalizeEdge(opp),
              0
            ) / safeOpportunities.length
          : 0;

      // Get today's PnL (unchanged)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const pnlSummary = await storage.getPnlSummary(today, tomorrow);
      const dailyPnl = (pnlSummary.realized || 0) + (pnlSummary.unrealized || 0);

      res.json({
        activeOpportunities,
        avgProfit: avgProfit.toFixed(1),
        trackedBets,
        dailyPnl,
        // For now, just mirror trackedBets as a simple hedgeAlerts proxy
        hedgeAlerts: trackedBets,
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      res.status(500).json({ message: 'Failed to fetch dashboard stats' });
    }
  });


  // Sports routes
  app.get('/api/sports', isAuthenticated, async (req, res) => {
    try {
      const sports = await storage.getSports();
      res.json(sports);
    } catch (error) {
      console.error("Error fetching sports:", error);
      res.status(500).json({ message: "Failed to fetch sports" });
    }
  });

  // Events routes
  app.get('/api/events', isAuthenticated, async (req, res) => {
    try {
      const { league, status, from, to, sport } = req.query;
      const events = await storage.getEvents({
        leagueId: league as string,
        status: status as string,
        from: from ? new Date(from as string) : undefined,
        to: to ? new Date(to as string) : undefined,
        sportId: sport as string,
      });
      res.json(events);
    } catch (error) {
      console.error("Error fetching events:", error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  app.get('/api/events/:eventId', isAuthenticated, async (req, res) => {
    try {
      const event = await storage.getEvent(req.params.eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      res.json(event);
    } catch (error) {
      console.error("Error fetching event:", error);
      res.status(500).json({ message: "Failed to fetch event" });
    }
  });

  app.get('/api/events/:eventId/markets', isAuthenticated, async (req, res) => {
    try {
      const markets = await storage.getMarkets(req.params.eventId);
      res.json(markets);
    } catch (error) {
      console.error("Error fetching markets:", error);
      res.status(500).json({ message: "Failed to fetch markets" });
    }
  });

  // Markets routes
  app.get('/api/markets/:marketId/quotes', isAuthenticated, async (req, res) => {
    try {
      const { live } = req.query;
      const quotes = await storage.getQuotes(
        req.params.marketId,
        live === '1' ? true : undefined
      );
      res.json(quotes);
    } catch (error) {
      console.error("Error fetching quotes:", error);
      res.status(500).json({ message: "Failed to fetch quotes" });
    }
  });

  // Lines (comprehensive odds) routes
  app.get('/api/lines', isAuthenticated, async (req, res) => {
    console.log('🔍 /api/lines endpoint HIT with query:', req.query);
    console.log('🔍 User authenticated:', !!req.user);
    try {
      const { sport, state, market_type, live, event } = req.query;
      
      const lines = await storage.getQuotesWithContext({
        eventId: event as string,
        marketType: market_type as string,
        live: live === '1' ? true : live === '0' ? false : undefined,
        stateCode: state as string,
      });
      
      // Additional filtering by sport if specified
      let filteredLines = lines;
      if (sport) {
        filteredLines = lines.filter(line => 
          line.market.event.sport.code === sport || 
          line.market.event.sport.id === sport
        );
      }
      
      console.log(`🔍 Returning ${filteredLines.length} lines`);
      res.json(filteredLines);
    } catch (error) {
      console.error("Error fetching lines:", error);
      res.status(500).json({ message: "Failed to fetch lines" });
    }
  });

  // Odds ingestion routes
  app.post('/api/ingest/odds/run', isAuthenticated, async (req: any, res) => {
    try {
      await auditService.log(req.user.claims.sub, 'odds_ingest_triggered', 'system', null, req.body);
      
      const { leagues, live_only, max_pages } = req.body;
      const job = await oddsService.fetchOdds({
        leagues,
        liveOnly: live_only,
        maxPages: max_pages,
      });
      
      res.json({ jobId: job.id, status: 'started' });
    } catch (error) {
      console.error("Error triggering odds ingest:", error);
      res.status(500).json({ message: "Failed to trigger odds ingest" });
    }
  });

  // Arbitrage routes
  app.get('/api/arbs', isAuthenticated, async (req, res) => {
    try {
      const { league, min_profit, live, state, sport } = req.query;
      const opportunities = await storage.getArbitrageOpportunities({
        leagueId: league as string,
        minProfit: min_profit ? parseFloat(min_profit as string) : undefined,
        live: live === '1' ? true : undefined,
        stateCode: state as string,
        sportId: sport as string,
      });
      
      res.json(opportunities);
    } catch (error) {
      console.error("Error fetching arbitrage opportunities:", error);
      res.status(500).json({ message: "Failed to fetch arbitrage opportunities" });
    }
  });

  app.post('/api/arbs/recalc', isAuthenticated, async (req: any, res) => {
    try {
      await auditService.log(req.user.claims.sub, 'arbitrage_recalc_triggered', 'system', null, {});
      
      const job = await arbitrageService.recalculateArbitrage();
      res.json({ jobId: job.id, status: 'started' });
    } catch (error) {
      console.error("Error triggering arbitrage recalculation:", error);
      res.status(500).json({ message: "Failed to trigger arbitrage recalculation" });
    }
  });

  app.post('/api/arbs/simulate', isAuthenticated, async (req: any, res) => {
    try {
      const { bankroll, target_profit, markets } = req.body;
      
      await auditService.log(req.user.claims.sub, 'arbitrage_simulation', 'calculation', null, {
        bankroll,
        target_profit,
        markets: markets?.length || 0,
      });
      
      const simulation = await arbitrageService.simulateArbitrage({
        bankroll,
        targetProfit: target_profit,
        markets,
      });
      
      res.json(simulation);
    } catch (error) {
      console.error("Error simulating arbitrage:", error);
      res.status(500).json({ message: "Failed to simulate arbitrage" });
    }
  });

  // Credit-Conscious Arbitrage Endpoints
  
  // POST /api/estimate - Shows planned API calls and costs (NO network calls)
  app.post('/api/estimate', isAuthenticated, async (req: any, res) => {
    try {
      const requestSchema = z.object({
        states: z.array(z.string()).min(1, "At least one state is required"),
        sports: z.array(z.string()).optional(),
        regions: z.array(z.string()).optional(),
        markets: z.array(z.string()).optional(),
        minProfitPct: z.number().optional()
      });

      const estimateRequest = requestSchema.parse(req.body) as EstimateRequest;
      
      await auditService.log(req.user.claims.sub, 'estimate_requested', 'system', null, estimateRequest);
      
      const estimate = await arbitrageService.estimateAPIUsage(estimateRequest);
      
      res.json({
        success: true,
        estimate,
        timestamp: new Date().toISOString(),
        note: "This is an estimate only - no API calls were made"
      });
      
    } catch (error) {
      console.error("Error generating estimate:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request parameters",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ message: "Failed to generate estimate" });
    }
  });

  // POST /api/scan/arbs - Execute arbitrage scan after user confirmation
  app.post('/api/scan/arbs', isAuthenticated, async (req: any, res) => {
    try {
      const requestSchema = z.object({
        states: z.array(z.string()).min(1, "At least one state is required"),
        sports: z.array(z.string()).optional(),
        regions: z.array(z.string()).optional(),
        markets: z.array(z.string()).optional(),
        minProfitPct: z.number().optional(),
        // NEW: allow caller to say "only use cached odds from DB"
        useCacheOnly: z.boolean().optional(),
        confirmed: z
          .boolean()
          .refine((val) => val === true, "User confirmation is required"),
      });

      // Parse and separate the confirmation flag from the scan parameters
      const parsed = requestSchema.parse(req.body) as {
        confirmed: boolean;
        useCacheOnly?: boolean;
      } & EstimateRequest;

      const { confirmed, ...scanRequest } = parsed;
      const userId = req.user.claims.sub;

      // Log the confirmed scan request (including useCacheOnly + filters)
      await auditService.log(
        userId,
        'arbitrage_scan_confirmed',
        'system',
        null,
        {
          ...scanRequest,
          confirmed,
        }
      );

      // Delegate to the service:
      //  - scanRequest now includes everything (states, sports, markets, minProfitPct, useCacheOnly)
      //  - arbitrageService.scanArbitrageOpportunities is responsible for:
      //      * deciding whether to reuse cached odds from storage (when useCacheOnly === true)
      //      * running calculateArbitrageOpportunities
      //      * returning a ranked list of "value / safer" opportunities
      const results = await arbitrageService.scanArbitrageOpportunities(
        scanRequest as EstimateRequest & { useCacheOnly?: boolean },
        userId
      );

      // IMPORTANT: do NOT re-filter here by "positive EV" or minProfit.
      // We trust the service's `rankedOpportunities` slice as the authoritative
      // "best / safest" board.
      const rankedOpportunities = results.rankedOpportunities ?? [];
      const maxProfitPick =
        results.maxProfitPick ?? rankedOpportunities[0] ?? null;

      res.json({
        success: true,
        ...results,
        rankedOpportunities,
        maxProfitPick,
        timestamp: new Date().toISOString(),
        // 5 minutes cache window – matches opportunity expiry
        cacheExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
    } catch (error) {
      console.error("Error executing arbitrage scan:", error);

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid request parameters",
          errors: error.errors,
        });
      }

      res.status(500).json({ message: "Failed to execute arbitrage scan" });
    }
  });


  // GET /api/state-map - Get current state-to-sportsbooks mapping
  app.get('/api/state-map', isAuthenticated, async (req: any, res) => {
    try {
      const stateMap = arbitrageService.getStateMap();
      
      res.json({
        success: true,
        stateMap,
        totalStates: Object.keys(stateMap).length,
        availableSportsbooks: Array.from(new Set(Object.values(stateMap).flat())).sort()
      });
      
    } catch (error) {
      console.error("Error fetching state map:", error);
      res.status(500).json({ message: "Failed to fetch state map" });
    }
  });

  // PUT /api/state-map - Update state mapping  
  app.put('/api/state-map', isAuthenticated, async (req: any, res) => {
    try {

      const updateSchema = z.object({
        stateMap: z.record(z.string(), z.array(z.string()))
      });

      const { stateMap } = updateSchema.parse(req.body);
      
      await auditService.log(req.user.claims.sub, 'state_map_updated', 'state_map', null, {
        previousStates: Object.keys(arbitrageService.getStateMap()),
        newStates: Object.keys(stateMap)
      });
      
      arbitrageService.updateStateMap(stateMap);
      
      res.json({
        success: true,
        message: "State map updated successfully",
        stateMap: arbitrageService.getStateMap()
      });
      
    } catch (error) {
      console.error("Error updating state map:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid state map format",
          errors: error.errors 
        });
      }
      
      res.status(500).json({ message: "Failed to update state map" });
    }
  });

  // GET /api/cache/status - Check if cached results are available
  app.get('/api/cache/status', isAuthenticated, async (req: any, res) => {
    try {
      // Check for recent arbitrage opportunities (last 10 minutes)
      const recentCutoff = new Date(Date.now() - 10 * 60 * 1000);
      const opportunities = await storage.getArbitrageOpportunities();
      const recentOpportunities = opportunities.filter(opp => 
        new Date(opp.createdAt!) > recentCutoff
      );
      
      const hasCache = recentOpportunities.length > 0;
      const cacheAge = hasCache 
        ? Math.round((Date.now() - Math.max(...recentOpportunities.map(o => new Date(o.createdAt!).getTime()))) / 1000)
        : null;
      
      const maxCacheAge = 300; // 5 minutes in seconds (matches opportunity expiry)
      
      res.json({
        success: true,
        hasCache,
        cacheAge, // seconds
        cachedOpportunities: recentOpportunities.length,
        maxCacheAge, // 5 minutes - matches opportunity TTL
        recommendation: hasCache 
          ? (cacheAge! < 300 ? "use_cache" : "refresh_recommended") 
          : "scan_required"
      });
      
    } catch (error) {
      console.error("Error checking cache status:", error);
      res.status(500).json({ message: "Failed to check cache status" });
    }
  });

  // Betting routes
  app.post('/api/bets', isAuthenticated, async (req: any, res) => {
    try {
      const betData = insertUserBetSchema.parse({
        ...req.body,
        userId: req.user.claims.sub,
        isTracked: true,
      });

      const bet = await storage.createUserBet(betData);

      await auditService.log(req.user.claims.sub, 'bet_created', 'user_bet', bet.id, {
        stake: bet.stake,
        sport: bet.sport,
        selection: bet.selection,
      });

      res.json(bet);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.warn('Validation failed for bet creation:', error.flatten());
        return res.status(400).json({ message: 'Invalid bet payload', issues: error.flatten() });
      }

      console.error("Error creating bet:", error);
      res.status(500).json({ message: "Failed to create bet" });
    }
  });

  app.get('/api/bets', isAuthenticated, async (req: any, res) => {
    try {
      const { status, sport } = req.query;
      const bets = await storage.getUserBets(req.user.claims.sub, {
        status: status as string,
        sportId: sport as string,
      });
      res.json(bets);
    } catch (error) {
      console.error("Error fetching bets:", error);
      res.status(500).json({ message: "Failed to fetch bets" });
    }
  });

  app.get('/api/bets/:betId', isAuthenticated, async (req, res) => {
    try {
      const bet = await storage.getUserBet(req.params.betId);
      if (!bet) {
        return res.status(404).json({ message: "Bet not found" });
      }
      res.json(bet);
    } catch (error) {
      console.error("Error fetching bet:", error);
      res.status(500).json({ message: "Failed to fetch bet" });
    }
  });

  app.put('/api/bets/:betId', isAuthenticated, async (req: any, res) => {
    try {
      const updateSchema = insertUserBetSchema.partial().pick({
        stake: true,
        oddsAmerican: true,
        sportsbook: true,
        selection: true,
        status: true,
        notes: true,
      });

      const updates = updateSchema.parse(req.body);
      const bet = await storage.updateUserBet(req.params.betId, updates);
      await auditService.log(req.user.claims.sub, 'bet_updated', 'user_bet', bet.id, updates);

      res.json(bet);
    } catch (error) {
      console.error("Error updating bet:", error);
      res.status(500).json({ message: "Failed to update bet" });
    }
  });

  // Hedge candidate probe (uses delayed, DB-touching engine)
  app.get('/api/hedge/candidates', isAuthenticated, async (req: any, res) => {
    try {
      const bets = await storage.getUserBets(req.user.claims.sub, { status: 'open' });
      const hedges = await computeHedgeCandidates(req.user.claims.sub, bets);

      res.json({
        betsAnalyzed: bets.length,
        candidates: hedges,
      });
    } catch (error) {
      console.error('Error computing hedge candidates:', error);
      res.status(500).json({ message: 'Failed to compute hedge candidates' });
    }
  });

  app.delete('/api/bets/:betId', isAuthenticated, async (req: any, res) => {
    try {
      const bet = await storage.getUserBet(req.params.betId);
      if (!bet) {
        return res.status(404).json({ message: "Bet not found" });
      }

      // Soft delete by marking status void for simplicity
      const deleted = await storage.updateUserBet(req.params.betId, { status: 'void' });

      await auditService.log(req.user.claims.sub, 'bet_deleted', 'user_bet', bet.id, {});

      res.json(deleted);
    } catch (error) {
      console.error("Error deleting bet:", error);
      res.status(500).json({ message: "Failed to delete bet" });
    }
  });

  // State access routes
  app.get('/api/state-map', isAuthenticated, async (req, res) => {
    try {
      const [sportsbooks, computeLocations] = await Promise.all([
        storage.getSportsbooks(),
        storage.getComputeLocations(),
      ]);
      
      res.json({
        sportsbooks: sportsbooks.map(book => ({
          id: book.id,
          name: book.name,
          supportedStates: book.supportedStates,
        })),
        computeLocations,
      });
    } catch (error) {
      console.error("Error fetching state map:", error);
      res.status(500).json({ message: "Failed to fetch state map" });
    }
  });

  app.put('/api/state-map', isAuthenticated, async (req: any, res) => {
    try {
      // This would update compute locations and sportsbook state mappings
      // Implementation depends on specific requirements
      
      await auditService.log(req.user.claims.sub, 'state_map_updated', 'system', null, req.body);
      
      res.json({ message: "State map updated successfully" });
    } catch (error) {
      console.error("Error updating state map:", error);
      res.status(500).json({ message: "Failed to update state map" });
    }
  });

  // Costs and PnL routes
  app.post('/api/costs', isAuthenticated, async (req: any, res) => {
    try {
      const costData = insertCostRecordSchema.parse(req.body);
      const cost = await storage.createCostRecord(costData);
      
      await auditService.log(req.user.claims.sub, 'cost_recorded', 'cost_record', cost.id, {
        category: cost.category,
        amount: cost.amount,
      });
      
      res.json(cost);
    } catch (error) {
      console.error("Error creating cost record:", error);
      res.status(500).json({ message: "Failed to create cost record" });
    }
  });

  app.get('/api/pnl', isAuthenticated, async (req, res) => {
    try {
      const { from, to, bucket } = req.query;
      const fromDate = from ? new Date(from as string) : undefined;
      const toDate = to ? new Date(to as string) : undefined;
      
      const pnlSummary = await storage.getPnlSummary(fromDate, toDate, bucket as string);
      res.json(pnlSummary);
    } catch (error) {
      console.error("Error fetching PnL:", error);
      res.status(500).json({ message: "Failed to fetch PnL" });
    }
  });

  // Notifications routes
  app.post('/api/notify/test', isAuthenticated, async (req: any, res) => {
    try {
      // Test notification functionality
      await auditService.log(req.user.claims.sub, 'test_notification_sent', 'notification', null, req.body);
      
      res.json({ message: "Test notification sent successfully" });
    } catch (error) {
      console.error("Error sending test notification:", error);
      res.status(500).json({ message: "Failed to send test notification" });
    }
  });

  app.get('/api/alerts', isAuthenticated, async (req, res) => {
    try {
      const { since } = req.query;
      const sinceDate = since ? new Date(since as string) : undefined;
      
      // Get recent audit logs as alerts
      const alerts = await storage.getAuditLogs({ since: sinceDate });
      res.json(alerts);
    } catch (error) {
      console.error("Error fetching alerts:", error);
      res.status(500).json({ message: "Failed to fetch alerts" });
    }
  });

  // Jobs routes
  app.get('/api/jobs', isAuthenticated, async (req, res) => {
    try {
      const jobs = await storage.getJobRuns();
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  app.post('/api/jobs/:name/run', isAuthenticated, async (req: any, res) => {
    try {
      const jobName = req.params.name;
      
      await auditService.log(req.user.claims.sub, 'job_triggered', 'job', null, { jobName });
      
      const job = await jobScheduler.runJob(jobName);
      res.json(job);
    } catch (error) {
      console.error("Error running job:", error);
      res.status(500).json({ message: "Failed to run job" });
    }
  });
app.post('/api/n8n/jobs/:name/run', requireBearerOrReject, async (req: any, res) => {
  try {
    const jobName = req.params.name;
    await auditService.log('system', 'job_triggered_m2m', 'job', null, { jobName, via: 'n8n' });
    const job = await jobScheduler.runJob(jobName);
    res.json({ ok: true, jobName, job });
  } catch (error) {
    console.error("Error running n8n job:", error);
    res.status(500).json({ message: "Failed to run n8n job" });
  }
});
  // Feature flags routes
  app.get('/api/flags', isAuthenticated, async (req, res) => {
    try {
      const flags = await storage.getFeatureFlags();
      res.json(flags);
    } catch (error) {
      console.error("Error fetching feature flags:", error);
      res.status(500).json({ message: "Failed to fetch feature flags" });
    }
  });

  app.put('/api/flags/:key', isAuthenticated, async (req: any, res) => {
    try {
      const flagData = insertFeatureFlagSchema.parse({
        key: req.params.key,
        ...req.body,
      });
      
      const flag = await storage.upsertFeatureFlag(flagData);
      
      await auditService.log(req.user.claims.sub, 'feature_flag_updated', 'feature_flag', flag.key, {
        enabled: flag.enabled,
      });
      
      res.json(flag);
    } catch (error) {
      console.error("Error updating feature flag:", error);
      res.status(500).json({ message: "Failed to update feature flag" });
    }
  });

  // Optional placement routes (behind feature flag)
  app.post('/api/placement/preview', isAuthenticated, async (req: any, res) => {
    try {
      const autoPlacementEnabled = await featureFlagService.isEnabled('auto_placement');
      if (!autoPlacementEnabled) {
        return res.status(403).json({ message: "Auto placement feature is disabled" });
      }
      
      await auditService.log(req.user.claims.sub, 'placement_preview', 'placement', null, req.body);
      
      // Placeholder for placement preview logic
      res.json({ message: "Placement preview functionality not implemented" });
    } catch (error) {
      console.error("Error previewing placement:", error);
      res.status(500).json({ message: "Failed to preview placement" });
    }
  });

  app.post('/api/placement/confirm', isAuthenticated, async (req: any, res) => {
    try {
      const autoPlacementEnabled = await featureFlagService.isEnabled('auto_placement');
      if (!autoPlacementEnabled) {
        return res.status(403).json({ message: "Auto placement feature is disabled" });
      }
      
      await auditService.log(req.user.claims.sub, 'placement_confirmed', 'placement', null, req.body);
      
      // Placeholder for placement confirmation logic
      res.json({ message: "Placement confirmation functionality not implemented" });
    } catch (error) {
      console.error("Error confirming placement:", error);
      res.status(500).json({ message: "Failed to confirm placement" });
    }
  });

  // GET /api/arbitrage/opportunities - currently active value opportunities
  app.get("/api/arbitrage/opportunities", isAuthenticated, async (req: any, res) => {
    try {
      const opportunities = await storage.getArbitrageOpportunities({ activeOnly: true });
      const sportsbooks = await storage.getSportsbooks();
      const bookMap = new Map(sportsbooks.map((b) => [b.id, b.name]));

      const formatted = await Promise.all(
        opportunities.map(async (opp) => {
          const event = opp.eventId ? await storage.getEventWithDetails(opp.eventId) : undefined;

          return {
            id: opp.id,
            event: {
              homeTeam: event?.homeTeam?.name ?? "Home",
              awayTeam: event?.awayTeam?.name ?? "Away",
              league: event?.league?.name ?? "",
              startTime: event?.startTime?.toISOString?.() ?? "",
            },
            market: {
              type: opp.marketId ?? "",
              description: opp.validityWindow ? "Arbitrage" : "Value",
            },
            legs: (opp.legs || []).map((leg) => ({
              outcome: leg.outcomeId,
              sportsbook: bookMap.get(leg.sportsbookId) ?? leg.sportsbookId,
              odds: Number(leg.priceValue).toString(),
              stake: Number(leg.stakeFraction ?? 0) * 100,
            })),
            profitPct: Number(opp.expectedProfitPct ?? 0),
            validityWindow: Number(opp.validityWindow ?? 300),
            confidenceScore: Number(opp.confidenceScore ?? 0),
          } as const;
        })
      );

      res.json(formatted);
    } catch (error) {
      console.error("Error fetching active arbitrage/value opportunities:", error);
      res.status(500).json({ message: "Failed to fetch opportunities" });
    }
  });

  // Audit logs route
  app.get('/api/audit-logs', isAuthenticated, async (req, res) => {
    try {
      const { since, actor } = req.query;
      const sinceDate = since ? new Date(since as string) : undefined;
      
      const logs = await storage.getAuditLogs({
        since: sinceDate,
        actor: actor as string,
      });
      
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
    
  });
  app.post("/api/agent/n8n/scan", isAuthenticated, async (req: any, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const out = await n8nAgentService.run(rows);

      if (typeof out === "object" && out !== null && "raw" in out && typeof (out as any).raw === "string") {
        res.type("text/plain").status(200).send((out as any).raw);
      } else {
        res.type("application/json").status(200).json(out);
      }
    } catch (err: any) {
      console.error("n8n/scan error:", err);
      res.status(500).json({ message: err?.message ?? "n8n scan failed" });
    }
  });
  const httpServer = createServer(app);
  return httpServer;
}

