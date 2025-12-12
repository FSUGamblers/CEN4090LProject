-- Ensure manual user bets can be stored without an associated event
ALTER TABLE "user_bets" ALTER COLUMN "event_id" DROP NOT NULL;
