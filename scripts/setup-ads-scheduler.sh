#!/usr/bin/env bash
# Turns on scheduled ads sync (TikTok, Google, Meta) in production.
#
# Idempotent. Re-running keeps the existing secret and updates the jobs.
#   - Enables the Cloud Scheduler API
#   - Creates Secret Manager secret zomaal-ads-sync-scheduler-secret (random,
#     never printed) and lets the Cloud Run runtime account read it
#   - Sets ADS_SYNC_SCHEDULER_ENABLED=true and mounts the secret on Cloud Run
#   - Creates/updates one Cloud Scheduler job per platform, every 6 hours
#
# Usage:
#   export DEPLOY_PROJECT_ID=your-project-id
#   ./scripts/setup-ads-scheduler.sh
#
# Rotate the secret: add a new secret version (no trailing newline), then
# re-run this script so the jobs and the Cloud Run revision pick it up.
set -euo pipefail

DEPLOY_PROJECT_ID="${DEPLOY_PROJECT_ID:?Set DEPLOY_PROJECT_ID}"
DEPLOY_REGION="${DEPLOY_REGION:-us-central1}"
DEPLOY_CLOUD_RUN_SERVICE="${DEPLOY_CLOUD_RUN_SERVICE:-zomaal-backend}"
SECRET_NAME="${ADS_SCHEDULER_SECRET_NAME:-zomaal-ads-sync-scheduler-secret}"
TIME_ZONE="${ADS_SCHEDULER_TIME_ZONE:-Etc/UTC}"

gc() { gcloud --project "$DEPLOY_PROJECT_ID" --quiet "$@"; }

PROJECT_NUMBER="$(gc projects describe "$DEPLOY_PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Enabling Cloud Scheduler API"
gc services enable cloudscheduler.googleapis.com

if ! gc secrets describe "$SECRET_NAME" >/dev/null 2>&1; then
  echo "Creating secret ${SECRET_NAME}"
  gc secrets create "$SECRET_NAME" --replication-policy=automatic
  # No trailing newline: Cloud Run would keep it in the env var.
  openssl rand -base64 48 | tr -d '/+=\n' | head -c 48 |
    gc secrets versions add "$SECRET_NAME" --data-file=-
else
  echo "Secret ${SECRET_NAME} already exists, keeping it"
fi

gc secrets add-iam-policy-binding "$SECRET_NAME" \
  --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role=roles/secretmanager.secretAccessor >/dev/null

echo "Updating Cloud Run service ${DEPLOY_CLOUD_RUN_SERVICE}"
gc run services update "$DEPLOY_CLOUD_RUN_SERVICE" \
  --region "$DEPLOY_REGION" \
  --update-env-vars ADS_SYNC_SCHEDULER_ENABLED=true \
  --update-secrets "ADS_SYNC_SCHEDULER_SECRET=${SECRET_NAME}:latest" >/dev/null

SERVICE_URL="$(gc run services describe "$DEPLOY_CLOUD_RUN_SERVICE" \
  --region "$DEPLOY_REGION" --format='value(status.url)')"
SCHEDULER_SECRET="$(gc secrets versions access latest --secret "$SECRET_NAME")"

# Staggered so the four platforms never sync at the same minute.
for job in "tiktok:0" "google:10" "meta:20" "snapchat:30"; do
  platform="${job%%:*}"
  minute="${job##*:}"
  name="zomaal-ads-${platform}-sync"
  args=(
    --location "$DEPLOY_REGION"
    --schedule "${minute} */6 * * *"
    --time-zone "$TIME_ZONE"
    --uri "${SERVICE_URL}/internal/ads/${platform}/sync"
    --http-method POST
    --attempt-deadline 120s
    --max-retry-attempts 1
    --min-backoff 60s
  )
  if gc scheduler jobs describe "$name" --location "$DEPLOY_REGION" >/dev/null 2>&1; then
    echo "Updating job ${name}"
    gc scheduler jobs update http "$name" "${args[@]}" \
      --update-headers "x-zomaal-scheduler-secret=${SCHEDULER_SECRET}" >/dev/null
  else
    echo "Creating job ${name}"
    gc scheduler jobs create http "$name" "${args[@]}" \
      --headers "x-zomaal-scheduler-secret=${SCHEDULER_SECRET}" >/dev/null
  fi
done
unset SCHEDULER_SECRET

echo "Done. Trigger one now with:"
echo "  gcloud scheduler jobs run zomaal-ads-meta-sync --location ${DEPLOY_REGION} --project ${DEPLOY_PROJECT_ID}"
