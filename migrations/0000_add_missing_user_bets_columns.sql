-- Add missing bet detail columns to user_bets
DO $$
BEGIN
    ALTER TABLE "user_bets" ADD COLUMN IF NOT EXISTS "sport" varchar;
    ALTER TABLE "user_bets" ADD COLUMN IF NOT EXISTS "league" varchar;
    ALTER TABLE "user_bets" ADD COLUMN IF NOT EXISTS "home_team" varchar;
    ALTER TABLE "user_bets" ADD COLUMN IF NOT EXISTS "away_team" varchar;
    ALTER TABLE "user_bets" ADD COLUMN IF NOT EXISTS "market_type" varchar;
    ALTER TABLE "user_bets" ADD COLUMN IF NOT EXISTS "selection" varchar;
    ALTER TABLE "user_bets" ADD COLUMN IF NOT EXISTS "sportsbook" varchar;
    ALTER TABLE "user_bets" ADD COLUMN IF NOT EXISTS "odds_american" integer;
    ALTER TABLE "user_bets" ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'open';
    ALTER TABLE "user_bets" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();
END $$;

-- Backfill any existing rows to satisfy not-null requirements without data loss
UPDATE "user_bets"
SET
    "sport" = COALESCE("sport", 'unknown'),
    "market_type" = COALESCE("market_type", 'unknown'),
    "selection" = COALESCE("selection", 'unknown'),
    "sportsbook" = COALESCE("sportsbook", 'unknown'),
    "odds_american" = COALESCE("odds_american", 0),
    "status" = COALESCE("status", 'open'),
    "updated_at" = COALESCE("updated_at", now());

-- Enforce schema constraints that should be non-null
ALTER TABLE "user_bets"
    ALTER COLUMN "sport" SET NOT NULL,
    ALTER COLUMN "market_type" SET NOT NULL,
    ALTER COLUMN "selection" SET NOT NULL,
    ALTER COLUMN "sportsbook" SET NOT NULL,
    ALTER COLUMN "odds_american" SET NOT NULL,
    ALTER COLUMN "status" SET NOT NULL,
    ALTER COLUMN "status" SET DEFAULT 'open',
    ALTER COLUMN "updated_at" SET DEFAULT now();
