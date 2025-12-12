-- Guarantee user_bets.event_id is nullable for manual bet creation
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_bets'
          AND column_name = 'event_id'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "user_bets" ALTER COLUMN "event_id" DROP NOT NULL;
    END IF;
END $$;
