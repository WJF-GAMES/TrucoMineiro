/**
 * Fumaça de Sala + Partida online contra o Emulator Suite.
 *
 *   npm run emulators           # em outro terminal (precisa de firestore E database)
 *   npm --prefix functions run build
 *   node scripts/rooms-e2e.js
 *
 * O que interessa aqui é o que o Firestore/RTDB falso dos testes não prova: transação de sala
 * de verdade (dois jogadores entrando junto), assentos livres, começo de partida, e o caminho
 * autoritativo da jogada — inclusive a idempotência e a recusa de jogada fora de turno.
 *
 * ATENÇÃO: mexe em `rooms/`, `userRooms/`, `gameSessions/` e `presence/` do EMULADOR.
 */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_DATABASE_EMULATOR_HOST =
  process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
for (const host of [
  process.env.FIRESTORE_EMULATOR_HOST,
  process.env.FIREBASE_DATABASE_EMULATOR_HOST,
]) {
  if (!/^(127\.0\.0\.1|localhost|0\.0\.0\.0):/.test(host)) {
    console.error('Recusando: os emuladores precisam ser locais.');
    process.exit(1);
  }
}
process.env.GCLOUD_PROJECT = 'truco-mineiro-wjf';
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.CONTACTS_PEPPER = process.env.CONTACTS_PEPPER || 'e2e-pepper';

const admin = require('../functions/node_modules/firebase-admin/lib/index.js');
// Mesma URL que `functions/src/lib/admin.ts` usa; o emulador intercepta pelo env acima.
if (!admin.apps.length)
  admin.initializeApp({
    projectId: 'truco-mineiro-wjf',
    databaseURL: 'https://truco-mineiro-wjf-default-rtdb.firebaseio.com',
  });
const db = admin.firestore();
const rtdb = admin.database();

const rooms = require('../functions/lib/rooms.js');
const sessions = require('../functions/lib/sessions.js');

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  OK   ${name}`);
  else {
    failures++;
    console.log(`  FALHA ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const call = (fn, uid, payload = {}) => fn.run({ auth: { uid }, data: payload });

async function codeOf(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e.code || e.message;
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
}

const roomAt = async (code) => (await rtdb.ref(`rooms/${code}`).get()).val();
const stateOf = async (id) => (await rtdb.ref(`gameSessions/${id}/state`).get()).val();
const viewOf = async (id, seat) => (await rtdb.ref(`gameSessions/${id}/views/${seat}`).get()).val();

async function main() {
  console.log('Sala + Partida online contra o emulador\n');
  await rtdb.ref('rooms').remove();
  await rtdb.ref('userRooms').remove();
  await rtdb.ref('gameSessions').remove();
  await Promise.all([
    makePlayer('hostplayer', 'Host'),
    makePlayer('guest0001', 'Guest'),
    makePlayer('guest0002', 'Guest2'),
    makePlayer('outsider1', 'Outsider'),
  ]);

  console.log('1) criar sala');
  const { code } = await call(rooms.createRoom, 'hostplayer');
  check('devolve um código de 6 caracteres', /^[A-Z0-9]{6}$/.test(code), code);
  let room = await roomAt(code);
  check('o host entra no assento 0', room.players.hostplayer.seat === 0);
  check('a sala começa aguardando', room.status === 'waiting');
  check('userRooms aponta para a sala', (await rtdb.ref('userRooms/hostplayer').get()).val() === code);

  console.log('\n2) entrar na sala');
  check(
    'código inexistente dá not-found',
    (await codeOf(call(rooms.joinRoom, 'guest0001', { code: 'ZZZZZZ' }))) === 'not-found',
  );
  await call(rooms.joinRoom, 'guest0001', { code });
  room = await roomAt(code);
  check('o convidado pega um assento livre', room.players.guest0001.seat === 1);
  await call(rooms.joinRoom, 'guest0001', { code });
  room = await roomAt(code);
  check('entrar de novo é idempotente (não duplica nem troca de assento)', Object.keys(room.players).length === 2 && room.players.guest0001.seat === 1);

  console.log('\n3) entradas simultâneas disputando assento');
  await Promise.all([
    call(rooms.joinRoom, 'guest0002', { code }).catch(() => undefined),
    call(rooms.joinRoom, 'outsider1', { code }).catch(() => undefined),
  ]);
  room = await roomAt(code);
  const seats = Object.values(room.players).map((p) => p.seat);
  check('ninguém divide assento', new Set(seats).size === seats.length, seats.join(','));
  check('a sala tem 4 jogadores', Object.keys(room.players).length === 4);

  console.log('\n4) sala cheia');
  await makePlayer('lateguy01', 'Late');
  check(
    'o quinto é recusado',
    (await codeOf(call(rooms.joinRoom, 'lateguy01', { code }))) === 'resource-exhausted',
  );

  console.log('\n5) pronto e início');
  check(
    'quem não está na sala não fica pronto',
    (await codeOf(call(rooms.setReady, 'lateguy01', { code, ready: true }))) === 'not-found',
  );
  for (const uid of ['hostplayer', 'guest0001', 'guest0002', 'outsider1'])
    await call(rooms.setReady, uid, { code, ready: true });
  check(
    'só o host começa a partida',
    (await codeOf(call(rooms.startMatch, 'guest0001', { code }))) === 'permission-denied',
  );
  const started = await call(rooms.startMatch, 'hostplayer', { code });
  const sessionId = started.sessionId;
  check('a partida começa e devolve a sessão', Boolean(sessionId), JSON.stringify(started));
  room = await roomAt(code);
  // `in_match` é o estado que o LobbyScreen observa para navegar até a mesa.
  check('a sala passa a "in_match" com a sessão', room.status === 'in_match' && room.sessionId === sessionId, room.status);

  console.log('\n6) estado autoritativo e views por assento');
  const state = await stateOf(sessionId);
  check('o estado privado existe', Boolean(state));
  const v0 = await viewOf(sessionId, 0);
  const v1 = await viewOf(sessionId, 1);
  check('cada assento tem a sua view', Boolean(v0) && Boolean(v1));
  check('a view não carrega o baralho', v0.deck === undefined);
  check('a view não carrega a mão dos outros', v0.hands === undefined);
  check(
    'cardCounts mostra quantas cartas cada um tem, sem dizer quais',
    Array.isArray(v0.cardCounts) || v0.cardCounts === undefined,
  );

  console.log('\n7) jogada: só quem é da vez, e só uma vez');
  const turnSeat = v0.turnSeat;
  const uidBySeat = Object.fromEntries(Object.values(room.players).map((p) => [p.seat, p.uid]));
  const turnUid = uidBySeat[turnSeat];
  const otherSeat = (turnSeat + 1) % 4;
  const otherUid = uidBySeat[otherSeat];

  check(
    'fora de turno é recusado',
    (await codeOf(
      call(sessions.submitGameAction, otherUid, {
        sessionId,
        action: { type: 'FINISH_SHUFFLE', seat: otherSeat },
        clientActionId: 'fora-de-turno',
      }),
    )) === 'failed-precondition',
  );

  const turnView = await viewOf(sessionId, turnSeat);
  const firstAction = turnView.availableActions.includes('SHUFFLE')
    ? { type: 'SHUFFLE', seat: turnSeat }
    : { type: 'FINISH_CUT', seat: turnSeat };
  const before = (await stateOf(sessionId)).version;
  await call(sessions.submitGameAction, turnUid, {
    sessionId,
    action: firstAction,
    clientActionId: 'acao-1',
  });
  const afterOne = (await stateOf(sessionId)).version;
  check('a ação avança a versão', afterOne > before, `${before} -> ${afterOne}`);

  await call(sessions.submitGameAction, turnUid, {
    sessionId,
    action: firstAction,
    clientActionId: 'acao-1',
  });
  const afterRetry = (await stateOf(sessionId)).version;
  check('reenviar o mesmo clientActionId não aplica de novo', afterRetry === afterOne, `${afterOne} -> ${afterRetry}`);

  console.log('\n8) as views acompanham o estado');
  const stateNow = await stateOf(sessionId);
  const viewNow = await viewOf(sessionId, turnSeat);
  check('a view publicada está na versão do estado', viewNow.version === stateNow.version, `view=${viewNow.version} state=${stateNow.version}`);

  console.log('\n9) a cerimônia inteira roda online (era aqui que travava)');
  // Toda mão começa em SHUFFLING. O validador do servidor não aceitava as ações de cerimônia,
  // então a partida online parava na primeira tela quando quem dava as cartas era humano.
  let guard = 0;
  let phase = (await viewOf(sessionId, 0)).phase;
  while (phase !== 'PLAY' && phase !== 'MAO_DE_ONZE' && guard++ < 30) {
    const st = await stateOf(sessionId);
    const seat = st.hand.turnSeat ?? 0;
    const v = await viewOf(sessionId, seat);
    const av = v.availableActions || [];
    let action = null;
    if (av.includes('SHUFFLE') && (st.hand.shuffleCount ?? 0) < 2)
      action = { type: 'SHUFFLE', seat };
    else if (av.includes('FINISH_SHUFFLE')) action = { type: 'FINISH_SHUFFLE', seat };
    else if (av.includes('CUT') && (st.hand.cutCount ?? 0) < 2)
      action = { type: 'CUT', seat, depth: 'high' };
    else if (av.includes('FINISH_CUT')) action = { type: 'FINISH_CUT', seat };
    if (!action) break;
    await call(sessions.submitGameAction, uidBySeat[seat], {
      sessionId,
      action,
      clientActionId: `cer-${guard}`,
    });
    phase = (await viewOf(sessionId, seat)).phase;
  }
  const dealt = await stateOf(sessionId);
  check(
    'a cerimônia termina e a mão é distribuída',
    dealt.hand.phase === 'PLAY' || dealt.hand.phase === 'MAO_DE_ONZE',
    dealt.hand.phase,
  );
  check(
    'o embaralhamento foi repetido de verdade',
    (dealt.hand.shuffleCount ?? 0) >= 2,
    `shuffleCount=${dealt.hand.shuffleCount}`,
  );
  check(
    'o corte foi repetido de verdade',
    (dealt.hand.cutCount ?? 0) >= 2,
    `cutCount=${dealt.hand.cutCount}`,
  );
  const hands = dealt.hand.hands || [];
  check(
    'cada assento recebeu 3 cartas',
    [0, 1, 2, 3].every((i) => (hands[i] || []).length === 3),
    JSON.stringify(hands.map((h) => (h || []).length)),
  );
  check(
    'a view do assento 0 mostra só as 3 cartas dele',
    ((await viewOf(sessionId, 0)).myCards || []).length === 3,
  );

  console.log('\n10) abandonar entrega a partida para a outra dupla');
  const abandonSeat = 0;
  await call(sessions.abandonMatch, uidBySeat[abandonSeat], { sessionId });
  const finished = await stateOf(sessionId);
  check('a partida termina', finished.status === 'FINISHED');
  check('quem venceu é a dupla adversária', finished.winner === 1, `winner=${finished.winner}`);

  console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} FALHA(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
