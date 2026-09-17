#!/usr/bin/env bash
# Deploy do backend (NestJS) no Cloud Run + Remote Config do Firebase.
#
#   ENVIRONMENT=staging    ./scripts/deploy.sh
#   ENVIRONMENT=production ./scripts/deploy.sh --confirm-production
#   ENVIRONMENT=production ./scripts/deploy.sh --confirm-production --lockdown-firebase-rules   # só na virada
#
# Pré-requisitos (uma vez por ambiente; ver docs/deployment.md):
#   - gcloud autenticado, Artifact Registry, Cloud SQL (PostgreSQL 17), Memorystore (Redis) + conector VPC
#   - segredos no Secret Manager: <prefixo>-database-url, -contacts-pepper, -admin-secret, -webhook-secret
#   - service account do serviço com: Cloud SQL Client, Secret Accessor, Firebase Auth Admin, FCM
#   - firebase login (para Remote Config / regras)
# Nada aqui apaga dados. As Cloud Functions antigas só são removidas manualmente, depois da validação
# (docs/production-runbook.md).
set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-staging}"
CONFIRM_PROD=false
LOCKDOWN=false
for a in "$@"; do
  case "$a" in
    --confirm-production) CONFIRM_PROD=true ;;
    --lockdown-firebase-rules) LOCKDOWN=true ;;
    *) echo "argumento desconhecido: $a" >&2; exit 2 ;;
  esac
done

case "$ENVIRONMENT" in
  staging)
    GCP_PROJECT="${GCP_PROJECT:-truco-mineiro-staging}"
    # O app só tem um projeto Firebase: o backend de staging valida tokens desse projeto, mas o
    # deploy de staging NUNCA publica Remote Config nem regras (seriam as de produção).
    FIREBASE_PROJECT="${FIREBASE_PROJECT:-truco-mineiro-wjf}"
    MIN_INSTANCES="${MIN_INSTANCES:-0}"
    [ "$LOCKDOWN" = true ] && { echo "--lockdown-firebase-rules só existe em produção." >&2; exit 2; }
    ;;
  production)
    [ "$CONFIRM_PROD" = true ] || { echo "Produção exige --confirm-production." >&2; exit 2; }
    GCP_PROJECT="${GCP_PROJECT:-truco-mineiro-wjf}"
    FIREBASE_PROJECT="${FIREBASE_PROJECT:-truco-mineiro-wjf}"
    MIN_INSTANCES="${MIN_INSTANCES:-1}"
    ;;
  *) echo "ENVIRONMENT deve ser staging ou production." >&2; exit 2 ;;
esac

REGION="${REGION:-southamerica-east1}"
SERVICE="truco-backend-$ENVIRONMENT"
REPO="${ARTIFACT_REPO:-$REGION-docker.pkg.dev/$GCP_PROJECT/truco}"
TAG="$(git rev-parse --short HEAD)$(git diff --quiet || echo -dirty)"
IMAGE="$REPO/backend:$TAG"
MIGRATE_IMAGE="$REPO/backend-migrate:$TAG"
SQL_INSTANCE="${SQL_INSTANCE:?defina SQL_INSTANCE (projeto:região:instância do Cloud SQL)}"
VPC_CONNECTOR="${VPC_CONNECTOR:?defina VPC_CONNECTOR (acesso ao Redis)}"
REDIS_URL="${REDIS_URL:?defina REDIS_URL (Memorystore)}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-truco-backend@$GCP_PROJECT.iam.gserviceaccount.com}"
SECRET_PREFIX="truco-$ENVIRONMENT"
CORS_ORIGINS="${CORS_ORIGINS:-}"

echo "==> Ambiente: $ENVIRONMENT  projeto: $GCP_PROJECT  imagem: $IMAGE"
[ "$ENVIRONMENT" = production ] && [[ "$TAG" == *-dirty ]] && { echo "Produção não sai de árvore suja." >&2; exit 1; }

echo "==> Verificações do backend (lint, tipos, unitários, build)"
npm --prefix backend run check

echo "==> Imagens (runtime e job de migração)"
gcloud auth configure-docker "${REPO%%/*}" --quiet
docker build backend --target runtime -t "$IMAGE"
docker build backend --target migrate -t "$MIGRATE_IMAGE"
docker push "$IMAGE"
docker push "$MIGRATE_IMAGE"

SECRETS="DATABASE_URL=$SECRET_PREFIX-database-url:latest"
SECRETS+=",CONTACTS_PEPPER=$SECRET_PREFIX-contacts-pepper:latest"
SECRETS+=",ADMIN_SECRET=$SECRET_PREFIX-admin-secret:latest"
SECRETS+=",WEBHOOK_SCHEDULER_SECRET=$SECRET_PREFIX-webhook-secret:latest"

echo "==> Migrations (Cloud Run Job; prisma migrate deploy + seed estrutural)"
gcloud run jobs deploy "$SERVICE-migrate" --project "$GCP_PROJECT" --region "$REGION" \
  --image "$MIGRATE_IMAGE" --service-account "$SERVICE_ACCOUNT" \
  --set-cloudsql-instances "$SQL_INSTANCE" --set-secrets "DATABASE_URL=$SECRET_PREFIX-database-url:latest" \
  --max-retries 0 --task-timeout 600s --quiet
gcloud run jobs execute "$SERVICE-migrate" --project "$GCP_PROJECT" --region "$REGION" --wait

echo "==> Serviço"
# WebSocket: timeout de 3600 s e afinidade de sessão; várias instâncias falam pelo Redis.
gcloud run deploy "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" \
  --image "$IMAGE" --service-account "$SERVICE_ACCOUNT" \
  --add-cloudsql-instances "$SQL_INSTANCE" --vpc-connector "$VPC_CONNECTOR" \
  --set-secrets "$SECRETS" \
  --set-env-vars "NODE_ENV=$ENVIRONMENT,FIREBASE_PROJECT_ID=$FIREBASE_PROJECT,AUTH_MODE=firebase,JOBS_MODE=external,REDIS_URL=$REDIS_URL,ENFORCE_APP_CHECK=${ENFORCE_APP_CHECK:-true},PUSH_ENABLED=true,LOG_LEVEL=info,CORS_ORIGINS=$CORS_ORIGINS" \
  --port 8080 --timeout 3600 --session-affinity --concurrency 250 \
  --cpu 1 --memory 1Gi --min-instances "$MIN_INSTANCES" --max-instances "${MAX_INSTANCES:-10}" \
  --allow-unauthenticated --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" --format 'value(status.url)')"
echo "==> Smoke test em $URL"
SMOKE_URL="$URL" npm --prefix backend run smoke -- --url "$URL"

if [ "$ENVIRONMENT" = production ]; then
  echo "==> Remote Config"
  firebase deploy --project "$FIREBASE_PROJECT" --only remoteconfig
else
  echo "==> Remote Config: pulado em $ENVIRONMENT (o projeto Firebase é o de produção)"
fi

if [ "$LOCKDOWN" = true ]; then
  # Virada: o app antigo perde acesso direto a Firestore/RTDB. Só depois da migração validada.
  echo "==> Regras do Firebase: bloqueio total de Firestore e Realtime Database"
  firebase deploy --project "$FIREBASE_PROJECT" --only firestore:rules,database
fi

cat <<EOF

==> Pronto: $SERVICE → $URL
Jobs (Cloud Scheduler → POST $URL/webhooks/scheduler, OIDC): ver docs/webhooks.md.
App: EXPO_PUBLIC_API_URL=$URL no ambiente "$ENVIRONMENT" do EAS.
EOF
