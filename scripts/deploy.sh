#!/usr/bin/env bash
# Deploy MANUAL do backend no Cloud Run (o caminho normal é o build contínuo: push na `main` que
# toque em `backend/` dispara o gatilho do Cloud Build com `cloudbuild.yaml`).
#
#   ./scripts/deploy.sh                 # verificações + build + migrations + deploy + smoke
#   SKIP_MIGRATIONS=1 ./scripts/deploy.sh
#
# Produção (ver docs/deployment.md):
#   projeto wjf-games · região us-east1 · serviço api-truco-mineiro
#   banco PostgreSQL FORA do GCP (VPS), alcançado pela internet — sem Cloud SQL, sem VPC, sem Redis
#   segredos no Secret Manager: truco-prod-database-url, truco-prod-contacts-pepper, truco-prod-admin-secret
# Nada aqui apaga dados.
set -euo pipefail

PROJECT="${GCP_PROJECT:-wjf-games}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-api-truco-mineiro}"
REPO="$REGION-docker.pkg.dev/$PROJECT/truco"
RUNTIME_SA="${RUNTIME_SA:-truco-backend@$PROJECT.iam.gserviceaccount.com}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="$(git rev-parse --short HEAD)"
git diff --quiet -- backend || { TAG="$TAG-dirty"; echo "Aviso: backend/ tem mudanças não commitadas — a imagem sai marcada como -dirty." >&2; }

echo "==> Verificações do backend (lint, tipos, unitários, build)"
npm --prefix backend run check

echo "==> Build no Cloud Build: $REPO/backend:$TAG"
gcloud builds submit backend --project "$PROJECT" --region "$REGION" --tag "$REPO/backend:$TAG"

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo "==> Migrations + seed estrutural (segredo lido do Secret Manager, nunca gravado em disco)"
  DB="$(gcloud secrets versions access latest --secret=truco-prod-database-url --project "$PROJECT")"
  DATABASE_URL="$DB" npm --prefix backend run prisma:migrate
  DATABASE_URL="$DB" npm --prefix backend run seed
  unset DB
fi

echo "==> Deploy da revisão (mantém env e segredos já configurados no serviço)"
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --image "$REPO/backend:$TAG" --service-account "$RUNTIME_SA" --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo "==> Smoke test em $URL"
SMOKE_ADMIN_SECRET="$(gcloud secrets versions access latest --secret=truco-prod-admin-secret --project "$PROJECT")" \
  npm --prefix backend run smoke -- --url "$URL"

cat <<EOF

==> Pronto: $SERVICE → $URL
Remote Config do Firebase (projeto truco-mineiro-wjf, outra conta Google):
  firebase deploy --project truco-mineiro-wjf --only remoteconfig
Bloqueio das regras antigas na virada (só depois da migração validada):
  firebase deploy --project truco-mineiro-wjf --only firestore:rules,database
EOF
