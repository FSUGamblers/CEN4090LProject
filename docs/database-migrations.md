# Database migration usage

The `db:push` script now runs `drizzle-kit migrate` instead of `drizzle-kit push`. Using migrations avoids Drizzle's automatic schema diffing from trying to drop or recreate primary key columns (which previously produced errors like `column "id" is in a primary key`).

To apply the current migration set:
1. Ensure `DATABASE_URL` is set in your environment.
2. Run `npm run db:push` to execute the SQL files in `migrations/` against the target database.

If the database still needs to be synchronized with new schema changes, generate an additional migration with `drizzle-kit` before re-running the script.
