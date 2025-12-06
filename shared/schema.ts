import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  decimal,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (required for App Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table (required for App Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role").notNull().default("member"), // admin|member
  status: varchar("status").notNull().default("active"), // active|inactive
  notificationPrefs: jsonb("notification_prefs").$type<{
    inApp: boolean;
    email: boolean;
    webhook: boolean;
  }>().default({
    inApp: true,
    email: true,
    webhook: false,
  }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sports
export const sports = pgTable("sports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(), // Football, Basketball, Baseball, Soccer
  code: varchar("code").notNull().unique(), // NFL, NBA, MLB, EPL
  createdAt: timestamp("created_at").defaultNow(),
});

// Leagues
export const leagues = pgTable("leagues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sportId: varchar("sport_id").notNull().references(() => sports.id),
  name: varchar("name").notNull(),
  region: varchar("region"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Teams
export const teams = pgTable("teams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leagueId: varchar("league_id").notNull().references(() => leagues.id),
  name: varchar("name").notNull(),
  shortName: varchar("short_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Sportsbooks
export const sportsbooks = pgTable("sportsbooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  logoUrl: varchar("logo_url"),
  supportedStates: text("supported_states").array(),
  constraints: jsonb("constraints").$type<{
    minBet: number;
    maxBet: number;
    marketSupport: string[];
    notes: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Compute Locations
export const computeLocations = pgTable("compute_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateCode: varchar("state_code").notNull(),
  status: varchar("status").notNull().default("active"), // active|maintenance
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Events
export const events = pgTable("events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leagueId: varchar("league_id").notNull().references(() => leagues.id),
  homeTeamId: varchar("home_team_id").references(() => teams.id),
  awayTeamId: varchar("away_team_id").references(() => teams.id),
  startTime: timestamp("start_time").notNull(),
  status: varchar("status").notNull().default("scheduled"), // scheduled|live|final
  externalRefs: jsonb("external_refs").$type<Record<string, string>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Markets
export const markets = pgTable("markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id").notNull().references(() => events.id),
  marketType: varchar("market_type").notNull(), // ML, spread, total, etc.
  outcomes: jsonb("outcomes").$type<Array<{ id: string; label: string }>>().notNull(),
  settlementStatus: varchar("settlement_status").default("pending"),
  settlementResult: varchar("settlement_result"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Quotes (Odds Snapshots)
export const quotes = pgTable("quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id").notNull().references(() => markets.id),
  sportsbookId: varchar("sportsbook_id").notNull().references(() => sportsbooks.id),
  outcomeId: varchar("outcome_id").notNull(),
  priceFormat: varchar("price_format").notNull(), // decimal, american, fractional
  priceValue: decimal("price_value", { precision: 10, scale: 4 }).notNull(),
  isLive: boolean("is_live").default(false),
  stateAvailability: text("state_availability").array(),
  sourceLatencyMs: integer("source_latency_ms"),
  timestamp: timestamp("timestamp").defaultNow(),
});

// Arbitrage Opportunities
export const arbitrageOpportunities = pgTable("arbitrage_opportunities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id").notNull().references(() => events.id),
  marketId: varchar("market_id").notNull().references(() => markets.id),
  legs: jsonb("legs").$type<Array<{
    sportsbookId: string;
    outcomeId: string;
    priceValue: number;
    stakeFraction: number;
  }>>().notNull(),
  expectedProfitPct: decimal("expected_profit_pct", { precision: 5, scale: 2 }).notNull(),
  notionalBankroll: decimal("notional_bankroll", { precision: 12, scale: 2 }).notNull(),
  recommendedStakes: jsonb("recommended_stakes").$type<Record<string, number>>().notNull(),
  validityWindow: integer("validity_window"), // seconds
  confidenceScore: decimal("confidence_score", { precision: 3, scale: 2 }),
  constraintsApplied: text("constraints_applied").array(),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

// User Bets (Manual Input)
export const userBets = pgTable("user_bets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  sport: varchar("sport").notNull(),
  league: varchar("league"),
  eventId: varchar("event_id").references(() => events.id),
  homeTeam: varchar("home_team"),
  awayTeam: varchar("away_team"),
  marketType: varchar("market_type").notNull(),
  selection: varchar("selection").notNull(),
  sportsbook: varchar("sportsbook").notNull(),
  oddsAmerican: integer("odds_american").notNull(),
  stake: decimal("stake", { precision: 12, scale: 2 }).notNull(),
  status: varchar("status").notNull().default("open"), // open|won|lost|void|settled
  notes: text("notes"),
  // Legacy fields retained for compatibility with earlier features
  marketId: varchar("market_id").references(() => markets.id),
  outcomeId: varchar("outcome_id"),
  sportsbookId: varchar("sportsbook_id").references(() => sportsbooks.id),
  priceAtBet: decimal("price_at_bet", { precision: 10, scale: 4 }),
  currentCashout: decimal("current_cashout", { precision: 12, scale: 2 }),
  returns: decimal("returns", { precision: 12, scale: 2 }),
  isTracked: boolean("is_tracked").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Hedge Suggestions
export const hedgeSuggestions = pgTable("hedge_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userBetId: varchar("user_bet_id").notNull().references(() => userBets.id),
  suggestedLegs: jsonb("suggested_legs").$type<Array<{
    sportsbookId: string;
    outcomeId: string;
    priceValue: number;
    stake: number;
  }>>().notNull(),
  lockedProfitLow: decimal("locked_profit_low", { precision: 12, scale: 2 }),
  lockedProfitHigh: decimal("locked_profit_high", { precision: 12, scale: 2 }),
  rationale: text("rationale"),
  confidence: decimal("confidence", { precision: 3, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

// Cost Records
export const costCategories = ["api", "compute", "storage", "misc"] as const;

export const costRecords = pgTable("cost_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: varchar("category").notNull(), // api, compute, storage, misc
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency").notNull().default("USD"),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").defaultNow(),
});

// PnL Records
export const pnlRecords = pgTable("pnl_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userBetId: varchar("user_bet_id").references(() => userBets.id),
  type: varchar("type").notNull(), // realized|unrealized|fee
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  tags: text("tags").array(),
  timestamp: timestamp("timestamp").defaultNow(),
});

// Job Runs
export const jobRuns = pgTable("job_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobName: varchar("job_name").notNull(),
  status: varchar("status").notNull(), // running|success|failed
  startedAt: timestamp("started_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
  errorSummary: text("error_summary"),
  metrics: jsonb("metrics"),
});

// Feature Flags
export const featureFlags = pgTable("feature_flags", {
  key: varchar("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  description: text("description"),
  scope: varchar("scope").notNull().default("global"), // global|user
  defaultValue: boolean("default_value").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Audit Logs
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actor: varchar("actor").notNull(), // system|user_id
  action: varchar("action").notNull(),
  targetType: varchar("target_type"),
  targetId: varchar("target_id"),
  payloadHash: varchar("payload_hash"),
  payloadPreview: text("payload_preview"),
  timestamp: timestamp("timestamp").defaultNow(),
});

// Relations
export const sportsRelations = relations(sports, ({ many }) => ({
  leagues: many(leagues),
}));

export const leaguesRelations = relations(leagues, ({ one, many }) => ({
  sport: one(sports, { fields: [leagues.sportId], references: [sports.id] }),
  teams: many(teams),
  events: many(events),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  league: one(leagues, { fields: [teams.leagueId], references: [leagues.id] }),
  homeEvents: many(events, { relationName: "homeTeam" }),
  awayEvents: many(events, { relationName: "awayTeam" }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  league: one(leagues, { fields: [events.leagueId], references: [leagues.id] }),
  homeTeam: one(teams, { fields: [events.homeTeamId], references: [teams.id], relationName: "homeTeam" }),
  awayTeam: one(teams, { fields: [events.awayTeamId], references: [teams.id], relationName: "awayTeam" }),
  markets: many(markets),
  arbitrageOpportunities: many(arbitrageOpportunities),
  userBets: many(userBets),
}));

export const marketsRelations = relations(markets, ({ one, many }) => ({
  event: one(events, { fields: [markets.eventId], references: [events.id] }),
  quotes: many(quotes),
  arbitrageOpportunities: many(arbitrageOpportunities),
  userBets: many(userBets),
}));

export const quotesRelations = relations(quotes, ({ one }) => ({
  market: one(markets, { fields: [quotes.marketId], references: [markets.id] }),
  sportsbook: one(sportsbooks, { fields: [quotes.sportsbookId], references: [sportsbooks.id] }),
}));

export const userBetsRelations = relations(userBets, ({ one, many }) => ({
  user: one(users, { fields: [userBets.userId], references: [users.id] }),
  event: one(events, { fields: [userBets.eventId], references: [events.id] }),
  market: one(markets, { fields: [userBets.marketId], references: [markets.id] }),
  sportsbook: one(sportsbooks, { fields: [userBets.sportsbookId], references: [sportsbooks.id] }),
  hedgeSuggestions: many(hedgeSuggestions),
}));

export const hedgeSuggestionsRelations = relations(hedgeSuggestions, ({ one }) => ({
  userBet: one(userBets, { fields: [hedgeSuggestions.userBetId], references: [userBets.id] }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSportSchema = createInsertSchema(sports).omit({
  id: true,
  createdAt: true,
});

export const insertLeagueSchema = createInsertSchema(leagues).omit({
  id: true,
  createdAt: true,
});

export const insertTeamSchema = createInsertSchema(teams).omit({
  id: true,
  createdAt: true,
});

export const insertSportsbookSchema = createInsertSchema(sportsbooks).omit({
  id: true,
  createdAt: true,
});

export const insertComputeLocationSchema = createInsertSchema(computeLocations).omit({
  id: true,
  createdAt: true,
});

export const insertEventSchema = createInsertSchema(events).omit({
  id: true,
  createdAt: true,
});

export const insertMarketSchema = createInsertSchema(markets).omit({
  id: true,
  createdAt: true,
});

export const insertQuoteSchema = createInsertSchema(quotes).omit({
  id: true,
  timestamp: true,
});

export const insertArbitrageOpportunitySchema = createInsertSchema(arbitrageOpportunities).omit({
  id: true,
  createdAt: true,
});

export const insertUserBetSchema = createInsertSchema(userBets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertHedgeSuggestionSchema = createInsertSchema(hedgeSuggestions).omit({
  id: true,
  createdAt: true,
});

const baseInsertCostRecordSchema = createInsertSchema(costRecords).omit({
  id: true,
  timestamp: true,
});

export const insertCostRecordSchema = baseInsertCostRecordSchema.extend({
  category: z.enum(costCategories).default("api"),
});

export const insertPnlRecordSchema = createInsertSchema(pnlRecords).omit({
  id: true,
  timestamp: true,
});

export const insertJobRunSchema = createInsertSchema(jobRuns).omit({
  id: true,
  startedAt: true,
});

export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  timestamp: true,
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type Sport = typeof sports.$inferSelect;
export type League = typeof leagues.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Sportsbook = typeof sportsbooks.$inferSelect;
export type ComputeLocation = typeof computeLocations.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Market = typeof markets.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type ArbitrageOpportunity = typeof arbitrageOpportunities.$inferSelect;
export type UserBet = typeof userBets.$inferSelect;
export type HedgeSuggestion = typeof hedgeSuggestions.$inferSelect;
export type CostRecord = typeof costRecords.$inferSelect;
export type PnlRecord = typeof pnlRecords.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

export type InsertSport = z.infer<typeof insertSportSchema>;
export type InsertLeague = z.infer<typeof insertLeagueSchema>;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type InsertSportsbook = z.infer<typeof insertSportsbookSchema>;
export type InsertComputeLocation = z.infer<typeof insertComputeLocationSchema>;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type InsertArbitrageOpportunity = z.infer<typeof insertArbitrageOpportunitySchema>;
export type InsertUserBet = z.infer<typeof insertUserBetSchema>;
export type InsertHedgeSuggestion = z.infer<typeof insertHedgeSuggestionSchema>;
export type InsertCostRecord = z.infer<typeof insertCostRecordSchema>;
export type InsertPnlRecord = z.infer<typeof insertPnlRecordSchema>;
export type InsertJobRun = z.infer<typeof insertJobRunSchema>;
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
