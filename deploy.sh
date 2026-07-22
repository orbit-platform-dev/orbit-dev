#!/usr/bin/env bash
# Orbit → GCP free-tier deployment. Run from orbit-dev/:  ./deploy.sh
# Safe to re-run — every step is idempotent or an update.
set -euo pipefail

REGION="${REGION:-us-central1}"
say()  { printf "\n\033[1;35m▸ %s\033[0m\n" "$*"; }
fail() { printf "\n\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }

# ── 0 · Preflight ────────────────────────────────────────────────────────────
say "Checking prerequisites"
command -v gcloud >/dev/null || fail "gcloud CLI not found. Install: brew install google-cloud-sdk  → then: gcloud auth login"
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . || fail "Not logged in. Run: gcloud auth login"
[ -f backend/Dockerfile ] || fail "Run this from the orbit-dev/ folder."
ok "gcloud ready, correct folder"

PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  read -rp "GCP project id: " PROJECT
  gcloud config set project "$PROJECT"
fi
ok "Project: $PROJECT · Region: $REGION"

say "Enabling GCP services (one-time, ~1 min)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com --quiet
gcloud artifacts repositories describe orbit --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create orbit --repository-format=docker --location="$REGION" --quiet
ok "Services enabled, image repository ready"

# ── 1 · Backend settings ─────────────────────────────────────────────────────
ENVFILE="backend/env-api.yaml"
if [ ! -f "$ENVFILE" ]; then
  say "Creating $ENVFILE — two values needed"
  echo "  1) Neon connection string (neon.tech → your project → Connect)"
  echo "     paste it as-is; I'll convert it for the app"
  read -rp "  Neon connection string: " NEON_RAW
  DB_URL="$(printf '%s' "$NEON_RAW" \
      | sed -E 's#^postgres(ql)?://#postgresql+asyncpg://#' \
      | sed -E 's/[?&]sslmode=require//' )"
  case "$DB_URL" in *\?*) DB_URL="${DB_URL}&ssl=require";; *) DB_URL="${DB_URL}?ssl=require";; esac
  read -rp "  Gemini API key (aistudio.google.com): " GEMINI_KEY
  read -rp "  Seed demo data (Northwind) for investor demos? [Y/n]: " SEED
  SEED_VAL=true; [[ "${SEED:-Y}" =~ ^[Nn] ]] && SEED_VAL=false
  cat > "$ENVFILE" <<EOF
ENVIRONMENT: production
DATABASE_URL: ${DB_URL}
SEED_DEMO: "${SEED_VAL}"
CORS_ORIGINS: '["http://localhost:3000"]'
FRONTEND_URL: http://localhost:3000
ENABLE_AI: "true"
DEFAULT_MODEL: google-gla:gemini-2.0-flash
LLM_API_KEY: ${GEMINI_KEY}
HEARTBEAT_ENABLED: "false"
EOF
  ok "$ENVFILE written (kept local — do not commit it)"
else
  ok "$ENVFILE already exists — reusing it"
fi

# ── 2 · Backend → Cloud Run ──────────────────────────────────────────────────
API_IMG="$REGION-docker.pkg.dev/$PROJECT/orbit/api:latest"
say "Building backend image (Cloud Build, ~3 min)"
( cd backend && gcloud builds submit --tag "$API_IMG" --quiet )
say "Deploying orbit-api"
gcloud run deploy orbit-api --image "$API_IMG" --region "$REGION" \
  --allow-unauthenticated --memory 512Mi --cpu 1 --min-instances 0 --max-instances 1 \
  --concurrency 80 --timeout 300 --port 8000 \
  --env-vars-file "$ENVFILE" --quiet
API_URL="$(gcloud run services describe orbit-api --region "$REGION" --format='value(status.url)')"
ok "API live: $API_URL"

say "Health check"
sleep 3
curl -sf "$API_URL/health" >/dev/null && ok "API /health responds" || \
  echo "  (first boot can be slow — check $API_URL/health in a browser)"

# ── 3 · Frontend → Cloud Run ─────────────────────────────────────────────────
WEB_IMG="$REGION-docker.pkg.dev/$PROJECT/orbit/web:latest"
say "Building frontend image with API URL baked in (~4 min)"
( cd frontend && gcloud builds submit --config cloudbuild.yaml \
    --substitutions "_API_URL=${API_URL},_IMAGE=${WEB_IMG}" --quiet )
say "Deploying orbit-web"
gcloud run deploy orbit-web --image "$WEB_IMG" --region "$REGION" \
  --allow-unauthenticated --memory 512Mi --cpu 1 --min-instances 0 --max-instances 1 \
  --concurrency 80 --timeout 300 --quiet
WEB_URL="$(gcloud run services describe orbit-web --region "$REGION" --format='value(status.url)')"
ok "Web live: $WEB_URL"

# ── 4 · Wire API ↔ Web (CORS + frontend url) ────────────────────────────────
say "Pointing the API at the frontend (CORS)"
sed -i.bak -E "s#^CORS_ORIGINS:.*#CORS_ORIGINS: '[\"${WEB_URL}\"]'#; s#^FRONTEND_URL:.*#FRONTEND_URL: ${WEB_URL}#" "$ENVFILE" && rm -f "$ENVFILE.bak"
gcloud run services update orbit-api --region "$REGION" --env-vars-file "$ENVFILE" --quiet
ok "CORS + FRONTEND_URL set to $WEB_URL"

# ── 5 · Heartbeat via Cloud Scheduler ───────────────────────────────────────
say "Creating the 30-min sensor sweep (Cloud Scheduler)"
if gcloud scheduler jobs describe orbit-pulse --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http orbit-pulse --location "$REGION" \
    --schedule "*/30 * * * *" --uri "${API_URL}/artifacts/pull" --http-method POST --quiet
else
  gcloud scheduler jobs create http orbit-pulse --location "$REGION" \
    --schedule "*/30 * * * *" --uri "${API_URL}/artifacts/pull" --http-method POST --quiet
fi
ok "Scheduler job 'orbit-pulse' every 30 min"

# ── Done ─────────────────────────────────────────────────────────────────────
printf "\n\033[1;36m════════════════════════════════════════════════════\033[0m\n"
printf "\033[1m  Orbit is live\033[0m\n"
printf "  App:  %s\n" "$WEB_URL"
printf "  API:  %s/health\n" "$API_URL"
printf "\n  Next: open the app → Integrations → connect Linear (API key)\n"
printf "  and GitHub (PAT) → Pull now → watch the Feed populate.\n"
printf "  First load after idle ≈ 5–10s (cold start) — normal on free tier.\n"
printf "\033[1;36m════════════════════════════════════════════════════\033[0m\n"
