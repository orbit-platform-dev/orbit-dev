
set -euo pipefail

export PROJECT_ID="orbit-501314"
export REGION="asia-northeast1"               
export GH_REPO="orbit-platform-dev/orbit-dev" 
gcloud config set project "$PROJECT_ID"

# 1) Turn on the services Orbit needs
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com iamcredentials.googleapis.com

# 2) Docker image repo
gcloud artifacts repositories create orbit --repository-format=docker --location="$REGION" || true

printf '%s' 'YOUR_SUPABASE_POOLER_URL'                            | gcloud secrets create DATABASE_URL          --data-file=-
printf '%s' 'YOUR_GEMINI_API_KEY'                                 | gcloud secrets create LLM_API_KEY           --data-file=-
printf '%s' 'https://XXX.clerk.accounts.dev/.well-known/jwks.json'| gcloud secrets create CLERK_JWKS_URL        --data-file=-
printf '%s' 'https://XXX.clerk.accounts.dev'                      | gcloud secrets create CLERK_ISSUER          --data-file=-
printf '%s' "$(openssl rand -hex 32)"                             | gcloud secrets create HEARTBEAT_TOKEN       --data-file=-
printf '%s' 'YOUR_LINEAR_CLIENT_ID'                               | gcloud secrets create LINEAR_CLIENT_ID      --data-file=-
printf '%s' 'YOUR_LINEAR_CLIENT_SECRET'                           | gcloud secrets create LINEAR_CLIENT_SECRET  --data-file=-
printf '%s' 'YOUR_GITHUB_CLIENT_ID'                               | gcloud secrets create GITHUB_CLIENT_ID      --data-file=-
printf '%s' 'YOUR_GITHUB_CLIENT_SECRET'                           | gcloud secrets create GITHUB_CLIENT_SECRET  --data-file=-
printf '%s' 'YOUR_SLACK_CLIENT_ID'                                | gcloud secrets create SLACK_CLIENT_ID       --data-file=-
printf '%s' 'YOUR_SLACK_CLIENT_SECRET'                            | gcloud secrets create SLACK_CLIENT_SECRET   --data-file=-
printf '%s' 'YOUR_GOOGLE_CLIENT_ID'                               | gcloud secrets create GOOGLE_CLIENT_ID      --data-file=-
printf '%s' 'YOUR_GOOGLE_CLIENT_SECRET'                           | gcloud secrets create GOOGLE_CLIENT_SECRET  --data-file=-

# 4) Deployer service account + the Cloud Build service account
gcloud iam service-accounts create github-deployer --display-name="GitHub deployer" || true
export DEPLOYER="github-deployer@$PROJECT_ID.iam.gserviceaccount.com"
export NUM=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
export BUILDSA="$NUM-compute@developer.gserviceaccount.com"

# 5) Let the deployer SA submit builds
for R in roles/cloudbuild.builds.editor roles/storage.admin \
         roles/serviceusage.serviceUsageConsumer roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOYER" --role="$R" >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$BUILDSA" \
  --member="serviceAccount:$DEPLOYER" --role="roles/iam.serviceAccountUser" >/dev/null

# 6) Let Cloud Build deploy to Cloud Run + read secrets
for R in roles/run.admin roles/artifactregistry.writer roles/secretmanager.secretAccessor \
         roles/logging.logWriter roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$BUILDSA" --role="$R" >/dev/null
done

# 7) Keyless auth: Workload Identity Federation, locked to THIS GitHub repo only
gcloud iam workload-identity-pools create github-pool --location=global --display-name="GitHub pool" || true
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github-pool --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${GH_REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" || true

export POOL=$(gcloud iam workload-identity-pools describe github-pool --location=global --format='value(name)')
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL/attribute.repository/${GH_REPO}"

echo ""
echo "===== GitHub -> Settings -> Secrets and variables -> Actions -> Variables ====="
echo "GCP_PROJECT_ID   = $PROJECT_ID"
echo "GCP_DEPLOYER_SA  = $DEPLOYER"
echo -n "GCP_WIF_PROVIDER = "
gcloud iam workload-identity-pools providers describe github-provider \
  --location=global --workload-identity-pool=github-pool --format='value(name)'
echo ""
echo "Predicted Cloud Run URLs (new URL format) — use for API_URL / WEB_URL:"
echo "  API_URL = https://orbit-api-$NUM.$REGION.run.app"
echo "  WEB_URL = https://orbit-web-$NUM.$REGION.run.app"
