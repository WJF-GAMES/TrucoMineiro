#!/usr/bin/env bash
# Publishes everything the app depends on to the real Firebase project.
# Requires: firebase login (once) and Firestore created in the Console.
set -euo pipefail
PROJECT=truco-mineiro-wjf

echo "==> Build das Cloud Functions"
npm --prefix functions run build

echo "==> Deploy: Firestore rules + indexes, RTDB rules, Storage rules, Functions, Remote Config"
firebase deploy --project "$PROJECT" \
  --only firestore:rules,firestore:indexes,database,storage,functions,remoteconfig

echo "==> Seed do catálogo (ligas, conquistas, temporada)"
SEED_URL="https://southamerica-east1-$PROJECT.cloudfunctions.net/seedCatalog"
if [ -n "${SEED_SECRET:-}" ]; then
  curl -fsS -H "x-seed-secret: $SEED_SECRET" "$SEED_URL" && echo
else
  echo "SEED_SECRET não definido. Defina-o como variável da função e rode:"
  echo "  curl -H 'x-seed-secret: <segredo>' $SEED_URL"
fi

echo "==> Pronto."
