#!/bin/sh
set -eu

# Normal path: apply pending migrations and start the API.
# Recovery path: older Render databases can contain the failed Sendit migration
# that predates the User/Store baseline. Repair that exact history once, then
# retry the normal migration deployment. Future starts stay on the normal path.
if ! npx prisma migrate deploy; then
  echo "Normal migration deployment failed; attempting the known Sendit migration recovery."
  npx prisma db execute --file prisma/recovery/20260717_repair_failed_sendit.sql
  npx prisma migrate resolve --applied 20260714000000_add_sendit_connection
  npx prisma migrate deploy
fi

exec node dist/main
