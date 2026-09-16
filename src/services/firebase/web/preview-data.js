/**
 * Respostas de mentira das Cloud Functions, exclusivas da build web de inspeção.
 *
 * O `rnfirebase-stub` devolve `{}` para toda callable, e a maioria das telas aguenta isso
 * (caem no estado vazio). A aba "Minha Liga" não: ela só existe a partir de um snapshot
 * completo, então na web ela era a única tela do app impossível de olhar — caía direto no
 * estado de erro e nenhuma régua de layout podia ser conferida ali.
 *
 * Nada aqui vai para Android/iOS: o Metro só resolve este caminho quando `platform === 'web'`
 * (ver metro.config.js). Continua valendo a regra do projeto — no app de verdade todo dado
 * vem de Firestore/RTDB/Functions, e nenhuma destas linhas é importada por eles.
 */

const LADDER = [
  ['bronze', 'Bronze'],
  ['silver', 'Prata'],
  ['gold', 'Ouro'],
  ['platinum', 'Platina'],
  ['quartz', 'Quartzo'],
  ['topaz', 'Topázio'],
  ['amethyst', 'Ametista'],
  ['aquamarine', 'Água-marinha'],
  ['tourmaline', 'Turmalina'],
  ['emerald', 'Esmeralda'],
  ['sapphire', 'Safira'],
  ['ruby', 'Rubi'],
  ['opal', 'Opala'],
  ['onyx', 'Ônix'],
  ['obsidian', 'Obsidiana'],
  ['diamond', 'Diamante'],
  ['black_diamond', 'Diamante Negro'],
  ['imperial', 'Imperial'],
  ['legendary', 'Lendária'],
  ['legend_of_minas', 'Lenda de Minas'],
];

function definition(index) {
  const entry = LADDER[index];
  if (!entry) return null;
  return {
    id: entry[0],
    order: index + 1,
    displayName: entry[1],
    assetKey: `shield_${entry[0]}`,
    previousLeagueId: index === 0 ? null : LADDER[index - 1][0],
    nextLeagueId: index === LADDER.length - 1 ? null : LADDER[index + 1][0],
    isFirst: index === 0,
    isLast: index === LADDER.length - 1,
    active: true,
  };
}

/** Nomes com acento, sobrenome e apelido curto: o layout precisa apanhar dos dois extremos. */
const NAMES = [
  ['Zé da Mineira', 'joao'],
  ['Dona Conceição', 'maria'],
  ['Tião Carreiro Jr.', 'tiao'],
  ['Bituca', 'ze'],
  ['Seu Antônio do Armazém', 'antonio'],
  ['Galo', 'galo'],
  ['Caramelo', 'caramelo'],
  ['Juscelino', 'joao'],
  ['Maria Bethânia', 'maria'],
  ['Tonhão', 'tiao'],
  ['Chico', 'ze'],
  ['Vô Nestor', 'antonio'],
  ['Pingo', 'galo'],
  ['Bolinha', 'caramelo'],
  ['Sebastiana', 'maria'],
];

const COUNTRIES = ['BR', 'BR', 'BR', 'PT', 'BR', 'BR', 'AR', 'BR', 'BR', 'BR', 'UY', 'BR', 'BR', 'BR', 'BR'];

/** Índice do jogador na lista — fora do pódio e fora das zonas, para a linha "sou eu" aparecer. */
const ME_INDEX = 7;

function members() {
  return NAMES.map((entry, i) => ({
    uid: i === ME_INDEX ? 'web-preview-user' : `preview-${i}`,
    nickname: entry[0],
    avatarId: entry[1],
    countryCode: COUNTRIES[i] ?? 'BR',
    weeklyPoints: Math.max(0, 480 - i * 31 - (i % 3) * 7),
    wins: Math.max(0, 24 - i),
    rank: i + 1,
    tiebreakScore: 1000 - i,
    joinedAt: Date.now() - (i + 1) * 3_600_000,
    isMe: i === ME_INDEX,
  }));
}

/** Liga Ouro, divisão II, com zonas de subida e descida visíveis nas duas pontas. */
function leagueScreenSnapshot() {
  const now = Date.now();
  const list = members();
  const me = list[ME_INDEX];
  return {
    weekKey: '2026-W38',
    startAt: now - 2 * 86_400_000,
    endAt: now + (2 * 86_400 + 14 * 3600 + 32 * 60) * 1000,
    serverTime: now,
    currentLeague: definition(2),
    previousLeague: definition(1),
    nextLeague: definition(3),
    division: 2,
    groupId: 'preview-group',
    groupSize: list.length,
    promotionCount: 3,
    relegationCount: 3,
    promotionStart: 1,
    promotionEnd: 3,
    relegationStart: list.length - 2,
    relegationEnd: list.length,
    userRank: me.rank,
    userWeeklyPoints: me.weeklyPoints,
    members: list,
    lastWeeklyResult: 'stayed',
    lastWeeklyRank: 6,
  };
}

function globalLeagueRanking() {
  return {
    entries: members().map((m, i) => ({
      uid: m.uid,
      nickname: m.nickname,
      avatarId: m.avatarId,
      countryCode: m.countryCode,
      leagueId: definition(Math.max(0, 6 - Math.floor(i / 3))).id,
      seasonPoints: 4200 - i * 217,
      rank: i + 1,
      isMe: m.isMe,
    })),
  };
}

/** Callables que a inspeção de tela precisa ver preenchidas. O resto continua devolvendo `{}`. */
export const PREVIEW_CALLABLES = {
  getLeagueScreenSnapshot: leagueScreenSnapshot,
  getGlobalLeagueRanking: globalLeagueRanking,
  searchPlayers: searchPreviewPlayers,
  createFriendRoom: () => ({ code: PREVIEW_ROOM, inviteExpiresAt: Date.now() + 30_000 }),
};

/** Sala de amigos de inspeção: dono + uma amiga que entrou + um convite pendente + uma recusa. */
const PREVIEW_ROOM = 'PRV123';
let previewRoomStartedAt = 0;
function previewRoom() {
  if (!previewRoomStartedAt || Date.now() - previewRoomStartedAt > 30_000)
    previewRoomStartedAt = Date.now();
  const t = previewRoomStartedAt;
  const seat = (uid, nickname, avatarId, s, extra = {}) => ({
    uid,
    seat: s,
    nickname,
    avatarId,
    ready: true,
    bot: false,
    joinedAt: t,
    connected: true,
    ...extra,
  });
  const invite = (uid, nickname, avatarId, s, status) => ({
    uid,
    seat: s,
    nickname,
    avatarId,
    status,
    invitedAt: t,
  });
  return {
    code: PREVIEW_ROOM,
    hostUid: ME_UID,
    status: 'waiting',
    maxPlayers: 4,
    players: {
      [ME_UID]: seat(ME_UID, 'Trucador', 'joao', 0),
      'friend-1': seat('friend-1', 'Dona Conceição', 'maria', 1),
    },
    invites: {
      'friend-1': invite('friend-1', 'Dona Conceição', 'maria', 1, 'ACCEPTED'),
      'friend-3': invite('friend-3', 'Bituca', 'seu_ze', 2, 'PENDING'),
      'friend-4': invite('friend-4', 'Galo', 'galo', 3, 'DECLINED'),
    },
    sessionId: null,
    createdAt: t,
    updatedAt: t,
    source: 'private',
    fillWithAi: 'on_timeout',
    inviteExpiresAt: t + 30_000,
    lateJoinUntil: t + 600_000,
  };
}

// --- Amigos ------------------------------------------------------------------
// A aba "Meus Amigos" vive de assinaturas do Firestore/RTDB, não de callables. Sem estes
// documentos a tela só mostrava estados vazios: nenhuma linha de amigo, de solicitação ou de
// convite de sala podia ser conferida no navegador.

export const ME_UID = 'web-preview-user';

const FRIENDS = [
  { uid: 'friend-1', nickname: 'Dona Conceição', avatarId: 'maria', level: 14, state: 'online' },
  { uid: 'friend-2', nickname: 'Seu Antônio do Armazém', avatarId: 'antonio', level: 9, state: 'in_match' },
  { uid: 'friend-3', nickname: 'Bituca', avatarId: 'ze', level: 22, state: 'offline' },
  { uid: 'friend-4', nickname: 'Galo', avatarId: 'galo', level: 5, state: 'online' },
];

const REQUESTS_IN = [
  { uid: 'req-in-1', nickname: 'Tião Carreiro Jr.', avatarId: 'tiao' },
  { uid: 'req-in-2', nickname: 'Sebastiana', avatarId: 'maria' },
];

const REQUESTS_OUT = [{ uid: 'req-out-1', nickname: 'Vô Nestor', avatarId: 'antonio' }];

function profileOf(uid, nickname, avatarId, level) {
  return {
    id: uid,
    nickname,
    nicknameLower: nickname.toLowerCase(),
    avatarId,
    countryCode: 'BR',
    level: level ?? 1,
    xp: 120,
    xpToNext: 300,
    leagueId: 'gold',
    leaguePoints: 240,
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now(),
  };
}

/** Perfis lidos um a um por `getProfile` (amigos, convites, busca). */
const PROFILES = {};
FRIENDS.forEach((f) => (PROFILES[f.uid] = profileOf(f.uid, f.nickname, f.avatarId, f.level)));
REQUESTS_IN.concat(REQUESTS_OUT).forEach(
  (r) => (PROFILES[r.uid] = profileOf(r.uid, r.nickname, r.avatarId, 7)),
);

/** Busca por apelido no navegador: prefixo sobre os perfis de inspeção, como o servidor faz. */
function searchPreviewPlayers(payload) {
  const term = String(payload?.term ?? '').trim().toLowerCase();
  const players = Object.values(PROFILES).filter((p) => term && p.nicknameLower.startsWith(term));
  return { players };
}

export function previewDoc(path) {
  const parts = String(path).split('/');
  if (parts[0] === 'profiles' && PROFILES[parts[1]]) return PROFILES[parts[1]];
  return null;
}

/**
 * Coleções assinadas por `onSnapshot`. A chave é o caminho; quando o mesmo caminho serve a
 * duas consultas (solicitações recebidas x enviadas), as cláusulas `where` desempatam.
 */
export function previewCollection(path, clauses) {
  if (path === `friendships/${ME_UID}/friends`) {
    return FRIENDS.map((f) => ({ id: f.uid, data: { since: Date.now() } }));
  }
  if (path === 'friendRequests') {
    const incoming = (clauses ?? []).some((c) => c.field === 'to' && c.value === ME_UID);
    const list = incoming ? REQUESTS_IN : REQUESTS_OUT;
    return list.map((r, i) => ({
      id: `${incoming ? 'in' : 'out'}-${r.uid}`,
      data: incoming
        ? {
            from: r.uid,
            to: ME_UID,
            fromNickname: r.nickname,
            fromAvatarId: r.avatarId,
            status: 'pending',
            createdAt: Date.now() - i * 60_000,
          }
        : {
            from: ME_UID,
            to: r.uid,
            fromNickname: 'Trucador',
            fromAvatarId: 'joao',
            toNickname: r.nickname,
            toAvatarId: r.avatarId,
            status: 'pending',
            createdAt: Date.now() - i * 60_000,
          },
    }));
  }
  return null;
}

/** Valores do Realtime Database: presença dos amigos e convites de sala recebidos. */
export function previewRtdbValue(path) {
  const presence = String(path).match(/^presence\/(.+)$/);
  if (presence) {
    const friend = FRIENDS.find((f) => f.uid === presence[1]);
    return friend ? { state: friend.state, sessionId: null, lastChanged: Date.now() } : null;
  }
  if (path === `invites/${ME_UID}`) {
    return {
      ABC123: {
        code: 'ABC123',
        from: 'friend-1',
        fromNickname: 'Dona Conceição',
        createdAt: Date.now() - 60_000,
      },
    };
  }
  if (path === 'stats/onlineCount') return 1284;
  if (path === `rooms/${PREVIEW_ROOM}`) return previewRoom();
  return null;
}
