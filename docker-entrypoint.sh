#!/bin/sh
set -eu

# Apply committed migrations exactly once through Prisma's production workflow.
# Any failure stops the new revision instead of attempting an unrelated repair.
npx prisma migrate deploy

exec node dist/main
