// server/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
// IMPORTANT: pg is CommonJS. In ESM you must default-import then destructure.
import pg from "pg";

const { Pool } = pg;

// In constrained environments we may not have a DATABASE_URL. Instead of
// throwing during module import (which prevents the server from starting at
// all), export undefined handles and let the storage layer decide whether to
// fall back to in-memory persistence.
let pool: pg.Pool | undefined;

if (process.env.DATABASE_URL) {
  // Render Postgres usually needs TLS (even with the Internal URL).
  // rejectUnauthorized:false keeps it compatible across providers.
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

export const db = pool ? drizzle(pool) : undefined;
// Optional: export pool if you need raw queries in services
export { pool };
