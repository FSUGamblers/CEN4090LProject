-- Convert user_bets.id to UUID text values and realign foreign keys
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION
    WHEN others THEN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
            RAISE;
        END IF;
END $$;

-- Drop dependent foreign keys before reshaping the user_bets primary key
ALTER TABLE IF EXISTS hedge_suggestions DROP CONSTRAINT IF EXISTS hedge_suggestions_user_bet_id_fkey;
ALTER TABLE IF EXISTS pnl_records DROP CONSTRAINT IF EXISTS pnl_records_user_bet_id_fkey;

-- Prepare a new UUID-based identifier on user_bets
ALTER TABLE user_bets ADD COLUMN IF NOT EXISTS new_id varchar;
UPDATE user_bets SET new_id = gen_random_uuid() WHERE new_id IS NULL;

-- Stage UUID copies for referencing tables
ALTER TABLE hedge_suggestions ADD COLUMN IF NOT EXISTS user_bet_id_new varchar;
UPDATE hedge_suggestions hs
SET user_bet_id_new = ub.new_id
FROM user_bets ub
WHERE hs.user_bet_id::text = ub.id::text;

ALTER TABLE pnl_records ADD COLUMN IF NOT EXISTS user_bet_id_new varchar;
UPDATE pnl_records pr
SET user_bet_id_new = ub.new_id
FROM user_bets ub
WHERE pr.user_bet_id::text = ub.id::text;

-- Swap the primary key to the UUID text column
ALTER TABLE user_bets DROP CONSTRAINT IF EXISTS user_bets_pkey;
ALTER TABLE user_bets DROP COLUMN id;
ALTER TABLE user_bets RENAME COLUMN new_id TO id;
ALTER TABLE user_bets ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE user_bets ALTER COLUMN id SET NOT NULL;
ALTER TABLE user_bets ADD PRIMARY KEY (id);
DROP SEQUENCE IF EXISTS user_bets_id_seq;

-- Replace foreign key columns with the UUID text values
ALTER TABLE hedge_suggestions DROP COLUMN user_bet_id;
ALTER TABLE hedge_suggestions RENAME COLUMN user_bet_id_new TO user_bet_id;
ALTER TABLE hedge_suggestions ALTER COLUMN user_bet_id SET NOT NULL;

ALTER TABLE pnl_records DROP COLUMN user_bet_id;
ALTER TABLE pnl_records RENAME COLUMN user_bet_id_new TO user_bet_id;

-- Recreate foreign keys to the new primary key
ALTER TABLE hedge_suggestions
    ADD CONSTRAINT hedge_suggestions_user_bet_id_fkey FOREIGN KEY (user_bet_id) REFERENCES user_bets(id);
ALTER TABLE pnl_records
    ADD CONSTRAINT pnl_records_user_bet_id_fkey FOREIGN KEY (user_bet_id) REFERENCES user_bets(id);
