# Destructive migrations

`docker-entrypoint.sh` runs `npx prisma migrate deploy` automatically
against **real production** every time a new Cloud Run revision starts —
there is no separate manual-apply step in the normal deploy path. A
`DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/`DELETE FROM` in a committed migration
would run against prod the moment CI's `quality` job passes and `deploy`
ships the new revision. The CI check in `.github/workflows/ci-cd.yml`
("Reject destructive production migrations") exists to stop that from
happening silently.

## Why this happens more often than you'd expect

Editing `schema.prisma` (e.g. removing a model that's no longer used) and
then running `prisma migrate dev --name <something-unrelated>` makes Prisma
generate a migration that reconciles the schema with the database —
including dropping tables/columns for anything removed from the schema,
even if that removal happened in an earlier, unrelated commit and was never
migrated out at the time. The destructive statements can end up buried
inside a migration file whose name suggests it only *adds* something. Always
read the generated `migration.sql` before committing it — do not assume the
migration only does what its `--name` says.

## The procedure

1. **Read the actual generated SQL.** Confirm exactly which tables/columns
   would be dropped and why they're in the migration at all.
2. **Check prod's real data for those tables/columns** — read-only, before
   anything else:
   ```bash
   psql "$PROD_DATABASE_URL" -c "
     SELECT to_regclass('public.\"TableName\"');
   "
   # if it exists:
   psql "$PROD_DATABASE_URL" -c "SELECT COUNT(*) FROM \"TableName\";"
   ```
   Also grep the codebase to confirm nothing still reads/writes it:
   ```bash
   grep -rn "prisma\.tableName" src --include="*.ts"
   ```
3. **If there's real data that matters**, do not commit this migration —
   write one that preserves it instead (rename, archive to a new table,
   backfill a replacement column, etc.), or take an explicit backup first
   and document that the data loss is intentional and accepted.
4. **If it's confirmed empty/dead**, write `REVIEWED.md` in the same
   migration folder as `migration.sql`, containing:
   - What you checked (the exact commands/queries you ran)
   - What you found (row counts, whether the table existed at all)
   - Why it's safe to drop
   - Who you are and the date (git blame on the file already captures this,
     but state it in the file too — it should be readable on its own)

   Example:
   ```markdown
   # Reviewed: safe to drop

   Checked prod (2026-09-05, <name>): `Product`, `ProductImage`,
   `ProductListing`, `ProductVariant` — all four tables did not exist in
   prod (`to_regclass` returned NULL for all of them). Confirmed via
   `grep -rn "prisma\.(product|productImage|productListing|productVariant)"
   src` that no application code references these models. Safe to drop.
   ```
5. **Commit `REVIEWED.md` alongside the migration.** The CI gate checks for
   this file's presence in the same folder as the destructive SQL — its
   presence, committed under your name, is the audit trail. This does not
   bypass `prisma migrate deploy` at deploy time; the migration still runs
   through the normal automated path on the next deploy, exactly like any
   other migration. The review only clears the CI gate that would otherwise
   block the merge unconditionally.

## What this deliberately does NOT do

This is not a rubber stamp. `REVIEWED.md`'s job is to force a human to
actually look at prod before a drop reaches it — not to give a way past the
check without doing that. If you didn't actually run the checks in step 2,
don't create the file.
