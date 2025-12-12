-- Allow user_bets.event_id to be optional for manual entries
ALTER TABLE "user_bets" ALTER COLUMN "event_id" DROP NOT NULL;
