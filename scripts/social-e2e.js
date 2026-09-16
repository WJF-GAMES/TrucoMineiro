/**
 * Fumaça de Amigos + Perfil contra o Emulator Suite: transação, batch e query de verdade
 * (o Firestore falso de `functions/test` não prova concorrência nem limite de lote).
 *
 *   npm run emulators           # em outro terminal
 *   npm --prefix functions run build
 *   node scripts/social-e2e.js
 *
 * As callables v2 expõem `.run()` justamente para isto: exercita o handler real, com o Firestore
 * real do emulador, sem precisar do emulador de Functions nem de token de Auth.
 *
 * ATENÇÃO: APAGA `profiles`, `friendships`, `friendRequests`, `blocks`, `blockedBy`, `users`,
 * `playerStats` e `contactSync` do EMULADOR antes de rodar. Nunca aponte para produção — o guard
 * abaixo impede, mas não custa lembrar.
 */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
if (!/^(127\.0\.0\.1|localhost|0\.0\.0\.0):/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('Recusando: FIRESTORE_EMULATOR_HOST precisa apontar para o emulador local.');
  process.exit(1);
}
process.env.GCLOUD_PROJECT = 'truco-mineiro-wjf';
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.CONTACTS_PEPPER = process.env.CONTACTS_PEPPER || 'e2e-pepper';
// `deleteAccount` também limpa presença/fila/sessões no Realtime Database.
process.env.FIREBASE_DATABASE_EMULATOR_HOST =
  process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';

const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore');

const social = require('../functions/lib/social.js');
const users = require('../functions/lib/users.js');

const db = getFirestore();

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  OK   ${name}`);
  else {
    failures++;
    console.log(`  FALHA ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

/** Chama a callable como o cliente chamaria, já autenticado. */
const call = (fn, uid, payload = {}) => fn.run({ auth: { uid }, data: payload });

/** Erro esperado: devolve o `code` do HttpsError, ou null se não levantou. */
async function codeOf(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e.code || e.message;
  }
}

async function wipe() {
  for (const col of [
    'profiles',
    'users',
    'playerStats',
    'friendRequests',
    'contactSync',
    'userAchievements',
    'playerProgress',
  ]) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  // Subcoleções por usuário.
  for (const uid of ['alice', 'bobby', 'carol', 'mallory', 'heavy']) {
    for (const sub of [
      `friendships/${uid}/friends`,
      `blocks/${uid}/blocked`,
      `blockedBy/${uid}/users`,
      `leagueHistory/${uid}/weeks`,
    ]) {
      const snap = await db.collection(sub).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
}

async function makePlayer(uid, nickname) {
  await db.doc(`profiles/${uid}`).set({
    id: uid,
    nickname,
    nicknameLower: nickname.toLowerCase(),
    avatarId: 'joao',
    countryCode: 'BR',
    level: 1,
    xp: 0,
    xpToNext: 300,
    leagueId: 'bronze',
    leaguePoints: 0,
    createdAt: Date.now(),
  });
  await db.doc(`users/${uid}`).set({ createdAt: Date.now(), fcmTokens: {} });
}

const friends = async (uid) => (await db.collection(`friendships/${uid}/friends`).get()).docs.map((d) => d.id);
const reqId = (from, to) => `${from}_${to}`;

async function main() {
  console.log('Amigos + Perfil contra o emulador\n');
  await wipe();
  await Promise.all([
    makePlayer('alice', 'Alice'),
    makePlayer('bobby', 'Bob'),
    makePlayer('carol', 'Carol'),
    makePlayer('mallory', 'Mallory'),
  ]);

  console.log('1) solicitação de amizade');
  await call(social.sendFriendRequest, 'alice', { toUid: 'bobby' });
  const req = await db.doc(`friendRequests/${reqId('alice', 'bobby')}`).get();
  check('cria a solicitação pendente', req.exists && req.data().status === 'pending');
  check(
    'não deixa adicionar a si mesmo',
    (await codeOf(call(social.sendFriendRequest, 'alice', { toUid: 'alice' }))) ===
      'invalid-argument',
  );
  check(
    'jogador inexistente dá not-found',
    (await codeOf(call(social.sendFriendRequest, 'alice', { toUid: 'ninguem' }))) === 'not-found',
  );
  check(
    'segunda solicitação para o mesmo alvo é recusada',
    (await codeOf(call(social.sendFriendRequest, 'alice', { toUid: 'bobby' }))) === 'already-exists',
  );

  console.log('\n2) solicitações simultâneas (id determinístico)');
  await Promise.all([
    call(social.sendFriendRequest, 'carol', { toUid: 'bobby' }).catch(() => undefined),
    call(social.sendFriendRequest, 'carol', { toUid: 'bobby' }).catch(() => undefined),
    call(social.sendFriendRequest, 'carol', { toUid: 'bobby' }).catch(() => undefined),
  ]);
  const carolReqs = await db.collection('friendRequests').where('from', '==', 'carol').get();
  check('três chamadas juntas geram uma solicitação só', carolReqs.size === 1, `size=${carolReqs.size}`);

  console.log('\n3) aceitar');
  await call(social.respondFriendRequest, 'bobby', { requestId: reqId('alice', 'bobby'), accept: true });
  check('amizade nos dois sentidos', (await friends('alice')).includes('bobby') && (await friends('bobby')).includes('alice'));
  check(
    'aceitar de novo não quebra nem duplica',
    (await codeOf(
      call(social.respondFriendRequest, 'bobby', { requestId: reqId('alice', 'bobby'), accept: true }),
    )) === null && (await friends('bobby')).length === 1,
  );
  check(
    'quem não é o destinatário não pode responder',
    (await codeOf(
      call(social.respondFriendRequest, 'mallory', {
        requestId: reqId('carol', 'bobby'),
        accept: true,
      }),
    )) === 'permission-denied',
  );

  console.log('\n4) pedido cruzado vira amizade direto');
  await call(social.sendFriendRequest, 'alice', { toUid: 'carol' });
  await call(social.sendFriendRequest, 'carol', { toUid: 'alice' });
  check('sem par duplicado A→B/B→A', (await friends('alice')).includes('carol'));
  const cross = await db.doc(`friendRequests/${reqId('carol', 'alice')}`).get();
  check('não cria a solicitação inversa', !cross.exists);

  console.log('\n5) bloqueio');
  await call(social.blockUser, 'alice', { targetUid: 'bobby' });
  check('desfaz a amizade dos dois lados', !(await friends('alice')).includes('bobby') && !(await friends('bobby')).includes('alice'));
  check('grava o espelho blockedBy', (await db.doc('blockedBy/bobby/users/alice').get()).exists);
  const blockedCode = await codeOf(call(social.sendFriendRequest, 'bobby', { toUid: 'alice' }));
  check('quem foi bloqueado não consegue mandar solicitação', blockedCode === 'permission-denied');
  const blockerCode = await codeOf(call(social.sendFriendRequest, 'alice', { toUid: 'bobby' }));
  check('e quem bloqueou também não', blockerCode === 'permission-denied');
  check('a mensagem é a mesma nos dois sentidos (não expõe o bloqueio)', blockedCode === blockerCode);

  await call(social.unblockUser, 'alice', { targetUid: 'bobby' });
  check('desbloquear limpa os dois lados', !(await db.doc('blockedBy/bobby/users/alice').get()).exists);
  check(
    'desbloquear NÃO restaura a amizade',
    !(await friends('alice')).includes('bobby'),
  );
  check(
    'depois de desbloquear dá para adicionar de novo',
    (await codeOf(call(social.sendFriendRequest, 'alice', { toUid: 'bobby' }))) === null,
  );

  console.log('\n6) remover amigo');
  await call(social.removeFriend, 'alice', { friendUid: 'carol' });
  check('some dos dois lados', !(await friends('alice')).includes('carol') && !(await friends('carol')).includes('alice'));
  check(
    'remover quem não é amigo não explode',
    (await codeOf(call(social.removeFriend, 'alice', { friendUid: 'mallory' }))) === null,
  );

  console.log('\n7) perfil');
  check(
    'apelido curto é recusado pelo servidor',
    (await codeOf(call(users.updateProfile, 'alice', { nickname: 'Zé', avatarId: 'joao' }))) ===
      'invalid-argument',
  );
  check(
    'apelido com caractere inválido é recusado',
    (await codeOf(call(users.updateProfile, 'alice', { nickname: 'a<b>c', avatarId: 'joao' }))) ===
      'invalid-argument',
  );
  check(
    'avatar inexistente é recusado',
    (await codeOf(call(users.updateProfile, 'alice', { nickname: 'Alice', avatarId: 'hacker' }))) ===
      'invalid-argument',
  );
  await call(users.updateProfile, 'alice', { nickname: '  Alice Silva  ', avatarId: 'maria' });
  const alice = (await db.doc('profiles/alice').get()).data();
  check('salva sem espaços nas pontas', alice.nickname === 'Alice Silva');
  check('mantém o nicknameLower para a busca', alice.nicknameLower === 'alice silva');
  check('troca o avatar', alice.avatarId === 'maria');
  check('preserva a liga e o XP', alice.leagueId === 'bronze' && alice.level === 1);

  // ATENÇÃO: o emulador NÃO aplica o limite de 500 operações por lote (medido: 870 escritas
  // passam aqui e falham em produção). Então este bloco prova que a cascata apaga tudo o que
  // deve — não que o fatiamento acontece. Quem prova o fatiamento é
  // `functions/test/batchWriter.test.ts`, contando os commits.
  console.log('\n8) apagar a conta com MUITOS vínculos (cascata completa)');
  await makePlayer('heavy', 'Heavy');
  // 400 amizades = 800 documentos, mais solicitações e histórico: passa dos 500 de um batch só.
  const bulk = db.batch();
  for (let i = 0; i < 400; i++) {
    bulk.set(db.doc(`friendships/heavy/friends/f${i}`), { since: Date.now() });
    bulk.set(db.doc(`friendships/f${i}/friends/heavy`), { since: Date.now() });
  }
  await bulk.commit();
  const bulk2 = db.batch();
  for (let i = 0; i < 60; i++) {
    bulk2.set(db.doc(`leagueHistory/heavy/weeks/2026-W${i}`), { placement: 1 });
  }
  await bulk2.commit();
  const deleteCode = await codeOf(call(users.deleteAccount, 'heavy', {}));
  check('a exclusão conclui sem estourar o lote', deleteCode === null, String(deleteCode));
  check('o perfil some', !(await db.doc('profiles/heavy').get()).exists);
  check('as amizades somem', (await friends('heavy')).length === 0);
  const mirror = await db.doc('friendships/f0/friends/heavy').get();
  check('o espelho do outro lado também some', !mirror.exists);
  const weeksLeft = await db.collection('leagueHistory/heavy/weeks').get();
  check('o histórico semanal some', weeksLeft.empty, `restaram ${weeksLeft.size}`);

  console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} FALHA(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
