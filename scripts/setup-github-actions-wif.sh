#!/usr/bin/env bash
set -euo pipefail

DEPLOY_PROJECT_ID="${DEPLOY_PROJECT_ID:-zomaal}"
DEPLOY_PROJECT_NUMBER="${DEPLOY_PROJECT_NUMBER:-828793303867}"
DEPLOY_GITHUB_REPOSITORY="${DEPLOY_GITHUB_REPOSITORY:-Himatrooshe/Zomaal}"
DEPLOY_POOL_ID="${DEPLOY_POOL_ID:-github-actions}"
DEPLOY_PROVIDER_ID="${DEPLOY_PROVIDER_ID:-zomaal-main}"
DEPLOY_SERVICE_ACCOUNT_NAME="${DEPLOY_SERVICE_ACCOUNT_NAME:-zomaal-github-deployer}"
DEPLOY_RUNTIME_SERVICE_ACCOUNT="${DEPLOY_RUNTIME_SERVICE_ACCOUNT:-828793303867-compute@developer.gserviceaccount.com}"
DEPLOY_SERVICE_ACCOUNT="${DEPLOY_SERVICE_ACCOUNT_NAME}@${DEPLOY_PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_BUILD_SERVICE_ACCOUNT="${DEPLOY_PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

retry_google_iam() {
  DEPLOY_ATTEMPT=1
  DEPLOY_MAX_ATTEMPTS=8

  until "$@"; do
    if [ "$DEPLOY_ATTEMPT" -ge "$DEPLOY_MAX_ATTEMPTS" ]; then
      printf 'Command still failed after %s attempts.\n' "$DEPLOY_ATTEMPT" >&2
      return 1
    fi

    printf 'Google IAM has not propagated yet; retrying in 5 seconds (%s/%s).\n' \
      "$DEPLOY_ATTEMPT" \
      "$DEPLOY_MAX_ATTEMPTS" >&2
    sleep 5
    DEPLOY_ATTEMPT=$((DEPLOY_ATTEMPT + 1))
  done
}

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  serviceusage.googleapis.com \
  --project="$DEPLOY_PROJECT_ID"

if ! gcloud iam service-accounts describe "$DEPLOY_SERVICE_ACCOUNT" \
  --project="$DEPLOY_PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$DEPLOY_SERVICE_ACCOUNT_NAME" \
    --project="$DEPLOY_PROJECT_ID" \
    --display-name="Zomaal GitHub production deployer"
fi

retry_google_iam \
  gcloud iam service-accounts describe "$DEPLOY_SERVICE_ACCOUNT" \
    --project="$DEPLOY_PROJECT_ID" \
    --format="value(email)"

for DEPLOY_ROLE in \
  roles/run.sourceDeveloper \
  roles/serviceusage.serviceUsageConsumer
do
  retry_google_iam \
    gcloud projects add-iam-policy-binding "$DEPLOY_PROJECT_ID" \
      --member="serviceAccount:${DEPLOY_SERVICE_ACCOUNT}" \
      --role="$DEPLOY_ROLE" \
      --condition=None
done

retry_google_iam \
  gcloud iam service-accounts add-iam-policy-binding \
    "$DEPLOY_RUNTIME_SERVICE_ACCOUNT" \
    --project="$DEPLOY_PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_SERVICE_ACCOUNT}" \
    --role="roles/iam.serviceAccountUser"

retry_google_iam \
  gcloud projects add-iam-policy-binding "$DEPLOY_PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_BUILD_SERVICE_ACCOUNT}" \
    --role="roles/run.builder" \
    --condition=None

if ! gcloud iam workload-identity-pools describe "$DEPLOY_POOL_ID" \
  --project="$DEPLOY_PROJECT_ID" \
  --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$DEPLOY_POOL_ID" \
    --project="$DEPLOY_PROJECT_ID" \
    --location=global \
    --display-name="GitHub Actions"
fi

DEPLOY_ATTRIBUTE_MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref"
DEPLOY_ATTRIBUTE_CONDITION="assertion.repository == '${DEPLOY_GITHUB_REPOSITORY}' && assertion.ref == 'refs/heads/main'"

if gcloud iam workload-identity-pools providers describe \
  "$DEPLOY_PROVIDER_ID" \
  --project="$DEPLOY_PROJECT_ID" \
  --location=global \
  --workload-identity-pool="$DEPLOY_POOL_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc \
    "$DEPLOY_PROVIDER_ID" \
    --project="$DEPLOY_PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$DEPLOY_POOL_ID" \
    --attribute-mapping="$DEPLOY_ATTRIBUTE_MAPPING" \
    --attribute-condition="$DEPLOY_ATTRIBUTE_CONDITION"
else
  gcloud iam workload-identity-pools providers create-oidc \
    "$DEPLOY_PROVIDER_ID" \
    --project="$DEPLOY_PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$DEPLOY_POOL_ID" \
    --display-name="Zomaal main branch" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$DEPLOY_ATTRIBUTE_MAPPING" \
    --attribute-condition="$DEPLOY_ATTRIBUTE_CONDITION"
fi

DEPLOY_POOL_NAME="$(
  gcloud iam workload-identity-pools describe "$DEPLOY_POOL_ID" \
    --project="$DEPLOY_PROJECT_ID" \
    --location=global \
    --format="value(name)"
)"

retry_google_iam \
  gcloud iam service-accounts add-iam-policy-binding \
    "$DEPLOY_SERVICE_ACCOUNT" \
    --project="$DEPLOY_PROJECT_ID" \
    --member="principalSet://iam.googleapis.com/${DEPLOY_POOL_NAME}/attribute.repository/${DEPLOY_GITHUB_REPOSITORY}" \
    --role="roles/iam.workloadIdentityUser"

DEPLOY_PROVIDER_NAME="$(
  gcloud iam workload-identity-pools providers describe \
    "$DEPLOY_PROVIDER_ID" \
    --project="$DEPLOY_PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$DEPLOY_POOL_ID" \
    --format="value(name)"
)"

printf '\nGoogle Cloud setup is complete.\n\n'
printf 'Create these GitHub repository Actions variables:\n'
printf 'GCP_PROJECT_ID=%s\n' "$DEPLOY_PROJECT_ID"
printf 'GCP_REGION=us-central1\n'
printf 'GCP_CLOUD_RUN_SERVICE=zomaal-backend\n'
printf 'GCP_WORKLOAD_IDENTITY_PROVIDER=%s\n' "$DEPLOY_PROVIDER_NAME"
printf 'GCP_DEPLOY_SERVICE_ACCOUNT=%s\n' "$DEPLOY_SERVICE_ACCOUNT"
