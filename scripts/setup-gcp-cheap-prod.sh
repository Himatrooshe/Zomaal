#!/usr/bin/env bash
# Cheap Zomaal production bootstrap on a fresh GCP project.
#
# Creates:
#   - APIs enabled
#   - Cloud SQL Postgres db-f1-micro + 10GB SSD (no HA)
#   - Cloud Run service with min-instances=0 (scale to zero)
#   - Skips Memorystore Redis (REDIS_REQUIRED=false)
#   - GitHub Actions Workload Identity Federation (optional, if GH repo set)
#
# Usage:
#   export DEPLOY_PROJECT_ID=your-new-project-id
#   export DEPLOY_GITHUB_REPOSITORY=Himatrooshe/Zomaal   # optional, for CI/CD
#   export DB_PASSWORD='strong-random-password'           # or script generates one
#   ./scripts/setup-gcp-cheap-prod.sh
#
# Estimated idle cost: ~$10–15/month (mostly Cloud SQL). Not $15/day.
set -euo pipefail

DEPLOY_PROJECT_ID="${DEPLOY_PROJECT_ID:?Set DEPLOY_PROJECT_ID to your new GCP project id}"
DEPLOY_REGION="${DEPLOY_REGION:-us-central1}"
DEPLOY_SQL_INSTANCE="${DEPLOY_SQL_INSTANCE:-zomaal-db}"
DEPLOY_SQL_DB="${DEPLOY_SQL_DB:-zomaal}"
DEPLOY_SQL_USER="${DEPLOY_SQL_USER:-zomaal}"
DEPLOY_CLOUD_RUN_SERVICE="${DEPLOY_CLOUD_RUN_SERVICE:-zomaal-backend}"
DEPLOY_GITHUB_REPOSITORY="${DEPLOY_GITHUB_REPOSITORY:-}"
DEPLOY_POOL_ID="${DEPLOY_POOL_ID:-github-actions}"
DEPLOY_PROVIDER_ID="${DEPLOY_PROVIDER_ID:-zomaal-main}"
DEPLOY_SERVICE_ACCOUNT_NAME="${DEPLOY_SERVICE_ACCOUNT_NAME:-zomaal-github-deployer}"

if [ -z "${DB_PASSWORD:-}" ]; then
  DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  echo "Generated DB_PASSWORD (save this): ${DB_PASSWORD}"
fi

PROJECT_NUMBER="$(
  gcloud projects describe "$DEPLOY_PROJECT_ID" --format='value(projectNumber)'
)"
DEPLOY_SERVICE_ACCOUNT="${DEPLOY_SERVICE_ACCOUNT_NAME}@${DEPLOY_PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_RUNTIME_SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
DEPLOY_BUILD_SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "==> Using project ${DEPLOY_PROJECT_ID} (${PROJECT_NUMBER}) in ${DEPLOY_REGION}"
gcloud config set project "$DEPLOY_PROJECT_ID"

BILLING_ENABLED="$(
  gcloud billing projects describe "$DEPLOY_PROJECT_ID" \
    --format='value(billingEnabled)' 2>/dev/null || echo false
)"
if [ "$BILLING_ENABLED" != "True" ] && [ "$BILLING_ENABLED" != "true" ]; then
  echo "ERROR: Billing is not enabled on ${DEPLOY_PROJECT_ID}." >&2
  echo "Enable billing in Console, then re-run this script." >&2
  exit 1
fi

echo "==> Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  sql-component.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  serviceusage.googleapis.com \
  --project="$DEPLOY_PROJECT_ID"

echo "==> Creating Cloud SQL (db-f1-micro, 10GB SSD, zonal) if missing"
# Public IP + Cloud Run Cloud SQL connector (unix socket). No VPC connector,
# so no Memorystore/VPC always-on cost. Cloud Run does not need to dial the
# public IP — --add-cloudsql-instances uses the secure connector.
if gcloud sql instances describe "$DEPLOY_SQL_INSTANCE" \
  --project="$DEPLOY_PROJECT_ID" >/dev/null 2>&1; then
  echo "Cloud SQL instance ${DEPLOY_SQL_INSTANCE} already exists"
else
  gcloud sql instances create "$DEPLOY_SQL_INSTANCE" \
    --project="$DEPLOY_PROJECT_ID" \
    --database-version=POSTGRES_16 \
    --tier=db-f1-micro \
    --edition=ENTERPRISE \
    --region="$DEPLOY_REGION" \
    --storage-type=SSD \
    --storage-size=10GB \
    --storage-auto-increase \
    --availability-type=ZONAL \
    --assign-ip \
    --quiet
fi

# Wait until RUNNABLE
printf '%s\n' '==> Waiting for Cloud SQL to become RUNNABLE'
for _ in $(seq 1 60); do
  STATE="$(
    gcloud sql instances describe "$DEPLOY_SQL_INSTANCE" \
      --project="$DEPLOY_PROJECT_ID" \
      --format='value(state)'
  )"
  if [ "$STATE" = "RUNNABLE" ]; then
    break
  fi
  printf '%s\n' "  state=${STATE}; sleeping 10s"
  sleep 10
done

printf '%s\n' '==> Creating database + user'
gcloud sql databases create "$DEPLOY_SQL_DB" \
  --instance="$DEPLOY_SQL_INSTANCE" \
  --project="$DEPLOY_PROJECT_ID" 2>/dev/null || true

gcloud sql users create "$DEPLOY_SQL_USER" \
  --instance="$DEPLOY_SQL_INSTANCE" \
  --project="$DEPLOY_PROJECT_ID" \
  --password="$DB_PASSWORD" 2>/dev/null \
  || gcloud sql users set-password "$DEPLOY_SQL_USER" \
    --instance="$DEPLOY_SQL_INSTANCE" \
    --project="$DEPLOY_PROJECT_ID" \
    --password="$DB_PASSWORD"

CONNECTION_NAME="$(
  gcloud sql instances describe "$DEPLOY_SQL_INSTANCE" \
    --project="$DEPLOY_PROJECT_ID" \
    --format='value(connectionName)'
)"

# Cloud Run + Cloud SQL Auth Proxy style URL (unix socket)
DATABASE_URL="postgresql://${DEPLOY_SQL_USER}:${DB_PASSWORD}@localhost/${DEPLOY_SQL_DB}?host=/cloudsql/${CONNECTION_NAME}"

echo "==> Storing DATABASE_URL in Secret Manager"
echo -n "$DATABASE_URL" | gcloud secrets create zomaal-database-url \
  --project="$DEPLOY_PROJECT_ID" \
  --data-file=- 2>/dev/null \
  || echo -n "$DATABASE_URL" | gcloud secrets versions add zomaal-database-url \
    --project="$DEPLOY_PROJECT_ID" \
    --data-file=-

# Allow Cloud Run runtime SA to use the secret + connect to Cloud SQL
gcloud secrets add-iam-policy-binding zomaal-database-url \
  --project="$DEPLOY_PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_RUNTIME_SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

gcloud projects add-iam-policy-binding "$DEPLOY_PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_RUNTIME_SERVICE_ACCOUNT}" \
  --role="roles/cloudsql.client" \
  --condition=None \
  --quiet >/dev/null

echo "==> Skipping Memorystore Redis (use REDIS_REQUIRED=false). Saves ~\$36/mo."

echo "==> First Cloud Run deploy (cheap flags). This builds from source and can take several minutes."
# JWT_SECRET must exist for the app; generate if not provided
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

gcloud run deploy "$DEPLOY_CLOUD_RUN_SERVICE" \
  --project="$DEPLOY_PROJECT_ID" \
  --region="$DEPLOY_REGION" \
  --source=. \
  --allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=2 \
  --concurrency=80 \
  --timeout=60 \
  --cpu-boost \
  --add-cloudsql-instances="$CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=zomaal-database-url:latest" \
  --set-env-vars="NODE_ENV=production,REDIS_REQUIRED=false,JWT_SECRET=${JWT_SECRET},YOUCAN_SCOPES=*,LIGHTFUNNELS_SCOPES=orders\\,funnels\\,products\\,customers,SWAGGER_ENABLED=true" \
  --quiet

SERVICE_URL="$(
  gcloud run services describe "$DEPLOY_CLOUD_RUN_SERVICE" \
    --project="$DEPLOY_PROJECT_ID" \
    --region="$DEPLOY_REGION" \
    --format='value(status.url)'
)"

echo "==> Smoke test ${SERVICE_URL}/"
curl --fail --silent --show-error "${SERVICE_URL}/" || true
echo

# ---------------------------------------------------------------------------
# Optional: GitHub Actions WIF for CI/CD
# ---------------------------------------------------------------------------
if [ -n "$DEPLOY_GITHUB_REPOSITORY" ]; then
  echo "==> Setting up GitHub Actions Workload Identity Federation for ${DEPLOY_GITHUB_REPOSITORY}"

  if ! gcloud iam service-accounts describe "$DEPLOY_SERVICE_ACCOUNT" \
    --project="$DEPLOY_PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$DEPLOY_SERVICE_ACCOUNT_NAME" \
      --project="$DEPLOY_PROJECT_ID" \
      --display-name="Zomaal GitHub production deployer"
  fi

  for ROLE in roles/run.sourceDeveloper roles/serviceusage.serviceUsageConsumer; do
    gcloud projects add-iam-policy-binding "$DEPLOY_PROJECT_ID" \
      --member="serviceAccount:${DEPLOY_SERVICE_ACCOUNT}" \
      --role="$ROLE" \
      --condition=None \
      --quiet >/dev/null
  done

  gcloud iam service-accounts add-iam-policy-binding \
    "$DEPLOY_RUNTIME_SERVICE_ACCOUNT" \
    --project="$DEPLOY_PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_SERVICE_ACCOUNT}" \
    --role="roles/iam.serviceAccountUser" \
    --quiet >/dev/null

  gcloud projects add-iam-policy-binding "$DEPLOY_PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_BUILD_SERVICE_ACCOUNT}" \
    --role="roles/run.builder" \
    --condition=None \
    --quiet >/dev/null

  if ! gcloud iam workload-identity-pools describe "$DEPLOY_POOL_ID" \
    --project="$DEPLOY_PROJECT_ID" \
    --location=global >/dev/null 2>&1; then
    gcloud iam workload-identity-pools create "$DEPLOY_POOL_ID" \
      --project="$DEPLOY_PROJECT_ID" \
      --location=global \
      --display-name="GitHub Actions"
  fi

  ATTR_MAP="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref"
  ATTR_COND="assertion.repository == '${DEPLOY_GITHUB_REPOSITORY}' && assertion.ref == 'refs/heads/main'"

  if gcloud iam workload-identity-pools providers describe "$DEPLOY_PROVIDER_ID" \
    --project="$DEPLOY_PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$DEPLOY_POOL_ID" >/dev/null 2>&1; then
    gcloud iam workload-identity-pools providers update-oidc "$DEPLOY_PROVIDER_ID" \
      --project="$DEPLOY_PROJECT_ID" \
      --location=global \
      --workload-identity-pool="$DEPLOY_POOL_ID" \
      --attribute-mapping="$ATTR_MAP" \
      --attribute-condition="$ATTR_COND"
  else
    gcloud iam workload-identity-pools providers create-oidc "$DEPLOY_PROVIDER_ID" \
      --project="$DEPLOY_PROJECT_ID" \
      --location=global \
      --workload-identity-pool="$DEPLOY_POOL_ID" \
      --display-name="Zomaal main branch" \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --attribute-mapping="$ATTR_MAP" \
      --attribute-condition="$ATTR_COND"
  fi

  POOL_NAME="$(
    gcloud iam workload-identity-pools describe "$DEPLOY_POOL_ID" \
      --project="$DEPLOY_PROJECT_ID" \
      --location=global \
      --format='value(name)'
  )"

  gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SERVICE_ACCOUNT" \
    --project="$DEPLOY_PROJECT_ID" \
    --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository/${DEPLOY_GITHUB_REPOSITORY}" \
    --role="roles/iam.workloadIdentityUser" \
    --quiet >/dev/null

  PROVIDER_NAME="$(
    gcloud iam workload-identity-pools providers describe "$DEPLOY_PROVIDER_ID" \
      --project="$DEPLOY_PROJECT_ID" \
      --location=global \
      --workload-identity-pool="$DEPLOY_POOL_ID" \
      --format='value(name)'
  )"

  echo
  echo "Add these GitHub Actions repository variables (Settings → Secrets and variables → Actions → Variables):"
  echo "  GCP_PROJECT_ID=${DEPLOY_PROJECT_ID}"
  echo "  GCP_REGION=${DEPLOY_REGION}"
  echo "  GCP_CLOUD_RUN_SERVICE=${DEPLOY_CLOUD_RUN_SERVICE}"
  echo "  GCP_WORKLOAD_IDENTITY_PROVIDER=${PROVIDER_NAME}"
  echo "  GCP_DEPLOY_SERVICE_ACCOUNT=${DEPLOY_SERVICE_ACCOUNT}"
fi

echo
echo "=============================================="
echo "Done."
echo "  Cloud Run URL: ${SERVICE_URL}"
echo "  Cloud SQL:     ${CONNECTION_NAME}"
echo "  DB user:       ${DEPLOY_SQL_USER}"
echo
echo "Secrets (DB password, JWT, etc.) were written only to .gcp-local/"
echo "(gitignored). Do not paste them into chat, tickets, or commits."
echo "Set SUPERADMIN_*/LOGGER_* and OAuth secrets on the Cloud Run service"
echo "when you need those features."
echo "=============================================="
