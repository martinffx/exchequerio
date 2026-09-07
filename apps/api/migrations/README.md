# Migration Operations

Drizzle's PostgreSQL migrator applies pending migrations in a transaction. Migration SQL must be
reviewed for the locks it takes before it is applied to a populated environment.

## Organization foreign-key indexes

`20260806203446_blue_kid_colt/migration.sql` creates indexes on four existing Ledger tables with transactional
`CREATE INDEX`. PostgreSQL permits reads but blocks writes to each table while its index is built,
and the migration transaction retains its locks until all four indexes and the journal entry commit.

Before applying this migration to production:

1. Measure the migration on production-scale staging data and confirm sufficient disk headroom.
2. Check `pg_stat_activity` for long-running transactions touching the four tables and end or wait
   for them before proceeding.
3. Drain API write traffic and schedule a maintenance window longer than the measured build time.
4. Apply the migration with the normal `pnpm --filter=@exchequerio/api db:migrate` command. Its
   five-second `lock_timeout` makes lock acquisition fail instead of waiting indefinitely; on
   failure, allow the transaction to roll back, resolve the blocker, and rerun the migration.
5. Verify all four indexes in `pg_indexes` before restoring write traffic.

If a write maintenance window is not acceptable, do not run this migration through the standard
migrator. Use an operator-reviewed, non-transactional `CREATE INDEX CONCURRENTLY` procedure and a
separately approved process for reconciling migration state.

## UUID storage

`20260907204057_uuid-storage/migration.sql` stores resource IDs and their references as native
PostgreSQL UUIDs. The application keeps the existing TypeIDs and converts their embedded UUIDs
at persistence boundaries. ID generation and public IDs are unchanged.

Recreate the development and test databases before replaying migration history with the updated
application. This migration has no TypeID backfill: its UUID casts cannot convert populated
TypeID text columns. It temporarily removes and restores the existing foreign keys and
ID-comparison checks within the migration transaction.

Point `DATABASE_URL` at each recreated database and run the normal API `db:migrate` command.
Start the updated application only after migration replay succeeds.
