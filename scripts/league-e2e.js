/**
 * Fumaça do sistema de ligas contra o Emulator Suite: semântica real de transação, query e batch
 * (o Firestore falso de `functions/test` não prova isso).
 *
 *   npm run emulators           # em outro terminal
 *   npm --prefix functions run build
 *   node scripts/league-e2e.js
 *
 * ATENÇÃO: APAGA as coleções de liga, `profiles` e `playerProgress` do EMULADOR antes de rodar.
 * Nunca aponte para produção — o guard abaixo impede, mas não custa lembrar.
 */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
if (!/^(127\.0\.0\.1|localhost|0\.0\.0\.0):/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('Recusando: FIRESTORE_EMULATOR_HOST precisa apontar para o emulador local.');
  process.exit(1);
}
process.env.GCLOUD_PROJECT = 'truco-mineiro-wjf';
process.env.FUNCTIONS_EMULATOR = 'true';

const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore');

const L = require('../functions/lib/leagues.js');
const { planGroupSizes } = require('../functions/lib/domain/model/leagueGroups.js');
const { weekKeyFor } = require('../functions/lib/domain/model/leagueWeek.js');

const db = getFirestore();
const WEEK = weekKeyFor(Date.now());

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  OK   ${name}`);
  else {
    failures++;
    console.log(`  FALHA ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function wipe() {
  for (const col of [
    'weeklyLeagueGroups', 'playerProgress', 'processedLeagueEvents',
    'leagueProcessingLocks', 'leagueDefinitions', 'profiles', 'leagueHistory',
  ]) {
    await db.recursiveDelete(db.collection(col));
  }
}

async function groupsOf(leagueId, weekKey = WEEK) {
  const snap = await db.collection('weeklyLeagueGroups')
    .where('leagueId', '==', leagueId).where('weekKey', '==', weekKey).get();
  const out = [];
  for (const d of snap.docs) {
    const members = await d.ref.collection('members').get();
    out.push({ id: d.id, data: d.data(), members: members.docs.map((m) => m.id).sort() });
  }
  return out.sort((a, b) => a.data.division - b.data.division);
}

async function main() {
  console.log(`Semana: ${WEEK}\n`);
  await wipe();

  console.log('1) seed das 20 ligas');
  const n = await L.seedLeagueDefinitionsInternal();
  await L.seedLeagueDefinitionsInternal(); // idempotência
  const defs = await db.collection('leagueDefinitions').get();
  check('cria exatamente 20 ligas e não duplica', n === 20 && defs.size === 20, `size=${defs.size}`);
  check('gold aponta para platinum', (await db.doc('leagueDefinitions/gold').get()).get('nextLeagueId') === 'platinum');

  console.log('\n2) 45 jogadores entram (Firestore real, transações reais)');
  const uids = [];
  for (let i = 0; i < 45; i++) {
    const uid = `p${String(i).padStart(3, '0')}`;
    await db.doc(`profiles/${uid}`).set({ nickname: `Jogador ${i}`, avatarId: 'joao', countryCode: 'BR' });
    await L.ensureAssignment(uid);
    uids.push(uid);
  }
  let groups = await groupsOf('bronze');
  const sizes = groups.map((g) => g.members.length);
  check('distribuição segue o plano [23,22]', JSON.stringify(sizes) === JSON.stringify(planGroupSizes(45)), JSON.stringify(sizes));
  const placed = groups.flatMap((g) => g.members);
  check('ninguém fica de fora', placed.length === 45 && new Set(placed).size === 45, `placed=${placed.length}`);
  check('memberCount bate com a subcoleção', groups.every((g) => g.data.memberCount === g.members.length));
  check('zonas gravadas no grupo', groups.every((g) => g.data.promotionCount === 5 && g.data.relegationCount === 5));

  console.log('\n3) entradas concorrentes');
  const burst = Array.from({ length: 10 }, (_, i) => `burst${i}`);
  await Promise.all(burst.map((uid) => db.doc(`profiles/${uid}`).set({ nickname: uid, avatarId: 'joao', countryCode: 'BR' })));
  await Promise.all(burst.map((uid) => L.ensureAssignment(uid)));
  groups = await groupsOf('bronze');
  const all = groups.flatMap((g) => g.members);
  check('55 jogadores, nenhum duplicado', all.length === 55 && new Set(all).size === 55, `total=${all.length}/${new Set(all).size}`);
  check('nenhum jogador em dois grupos', new Set(all).size === all.length);

  console.log('\n4) pontuação idempotente');
  for (let i = 0; i < uids.length; i++) {
    await L.addWeeklyLeaguePoints({ uid: uids[i], matchId: `m${i}`, eventType: 'match_win', points: (45 - i) * 10, won: true });
  }
  const dup = await L.addWeeklyLeaguePoints({ uid: uids[0], matchId: 'm0', eventType: 'match_win', points: 450, won: true });
  const p0 = (await db.doc(`playerProgress/${uids[0]}`).get()).data();
  check('reprocessar a mesma partida não pontua de novo', dup.applied === false && p0.weeklyPoints === 450, `weeklyPoints=${p0.weeklyPoints}`);
  check('seasonPoints acompanha', p0.seasonPoints === 450, `season=${p0.seasonPoints}`);

  console.log('\n5) ranking gravado pelo servidor');
  const gid = groups[0].id;
  await L.recomputeWeeklyLeagueRanking(gid);
  const ranked = (await db.collection(`weeklyLeagueGroups/${gid}/members`).get()).docs
    .map((d) => ({ uid: d.id, pts: d.get('weeklyPoints'), rank: d.get('currentRank') }))
    .sort((a, b) => a.rank - b.rank);
  const monotonic = ranked.every((m, i) => i === 0 || ranked[i - 1].pts >= m.pts);
  check('posições em ordem decrescente de pontos', monotonic);
  check('posições de 1 a N sem buraco', ranked.every((m, i) => m.rank === i + 1));

  console.log('\n6) fechamento semanal + próxima semana');
  const report = await L.finalizeWeek(WEEK);
  check('todos os jogadores processados', report.players === 55, JSON.stringify(report));
  // Todos estavam em Bronze (o piso): ninguém pode ser rebaixado para fora da escada.
  check('promoveu quem pontuou', report.promoted > 0, JSON.stringify(report));
  check('Bronze não rebaixa ninguém', report.relegated === 0, JSON.stringify(report));
  const lastUid = uids[uids.length - 1];
  const lastHist = await db.doc(`leagueHistory/${lastUid}/weeks/${WEEK}`).get();
  check('último colocado do Bronze fica como bottom_league',
    lastHist.get('result') === 'bottom_league' && lastHist.get('nextLeagueId') === 'bronze',
    `${lastHist.get('result')}/${lastHist.get('nextLeagueId')}`);
  const again = await L.finalizeWeek(WEEK);
  check('rodar de novo não reprocessa ninguém', again.players === 0, JSON.stringify(again));

  const hist = await db.doc(`leagueHistory/${uids[0]}/weeks/${WEEK}`).get();
  check('histórico gravado com o resultado', hist.exists && hist.get('result') === 'promoted', hist.get('result'));
  const prog0 = (await db.doc(`playerProgress/${uids[0]}`).get()).data();
  check('líder subiu para silver e zerou os pontos', prog0.currentLeagueId === 'silver' && prog0.weeklyPoints === 0, `${prog0.currentLeagueId}/${prog0.weeklyPoints}`);
  check('perfil espelha a liga nova', (await db.doc(`profiles/${uids[0]}`).get()).get('leagueId') === 'silver');

  const next = await L.prepareNextWeekGroups(WEEK);
  const nextGroups = await db.collection('weeklyLeagueGroups').where('weekKey', '==', next.weekKey).get();
  let nextPlaced = [];
  for (const g of nextGroups.docs) {
    const ms = await g.ref.collection('members').get();
    nextPlaced.push(...ms.docs.map((m) => m.id));
    if (ms.size !== g.get('memberCount')) check(`memberCount do grupo ${g.id}`, false, `${ms.size} != ${g.get('memberCount')}`);
  }
  check('quem jogou está na semana seguinte', nextPlaced.length === 45, `placed=${nextPlaced.length}`);
  check('ninguém duplicado na semana seguinte', new Set(nextPlaced).size === nextPlaced.length);
  check('dormentes não são carregados', !nextPlaced.includes('burst0'));

  const backProgress = await db.doc('playerProgress/burst0').get();
  check('dormente mantém a liga guardada', !!backProgress.get('currentLeagueId'));

  console.log('\n7) repair');
  await db.doc(`weeklyLeagueGroups/${gid}`).set({ memberCount: 999 }, { merge: true });
  const rep = await L.repairLeagueSystem();
  check('conserta memberCount errado', rep.fixedCounts > 0, JSON.stringify(rep));

  console.log(`\n${failures === 0 ? 'TUDO OK' : `${failures} FALHA(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('ERRO:', e);
  process.exit(1);
});
