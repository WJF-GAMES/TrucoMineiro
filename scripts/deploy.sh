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

BASE="https://southamerica-east1-$PROJECT.cloudfunctions.net"

echo "==> Seed do catálogo (20 ligas, conquistas, temporada)"
if [ -n "${SEED_SECRET:-}" ]; then
  curl -fsS -H "x-seed-secret: $SEED_SECRET" "$BASE/seedCatalog" && echo
  # Idempotente: garante `leagueDefinitions` mesmo se o seedCatalog mudar de escopo um dia.
  curl -fsS -H "x-seed-secret: $SEED_SECRET" "$BASE/leagueAdmin?op=seed" && echo
else
  echo "SEED_SECRET não definido. Defina-o como variável da função e rode:"
  echo "  curl -H 'x-seed-secret: <segredo>' $BASE/seedCatalog"
  echo "  curl -H 'x-seed-secret: <segredo>' '$BASE/leagueAdmin?op=seed'"
fi

echo
echo "==> Ligas: operações administrativas disponíveis (mesmo segredo)"
echo "  leagueAdmin?op=seed                          semeia as 20 ligas"
echo "  leagueAdmin?op=repair                        varre e conserta vínculos"
echo "  leagueAdmin?op=finalize&weekKey=2026-W37     fecha a semana (retomável)"
echo "  leagueAdmin?op=prepare&weekKey=2026-W37      monta a semana seguinte"
echo "  leagueAdmin?op=rebalance&leagueId=gold       redistribui os grupos da liga"
echo "A virada roda sozinha (finalizeWeeklyLeagues, segunda 00:05 America/Sao_Paulo)."

echo "==> Pronto."
