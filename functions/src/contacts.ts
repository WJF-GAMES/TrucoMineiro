import { createHmac, randomBytes } from 'crypto';
import { authedCallable, arr, HttpsError, obj, str } from './lib/callable';
import { auth, db, IS_EMULATOR, now } from './lib/admin';
import type {
  ContactMatch,
  FriendInviteToken,
  FriendRelation,
  MatchPhoneContactsResult,
  Profile,
} from './domain/model/types';

/**
 * Diretório de telefones.
 *
 * O app NUNCA vê o segredo usado no hash: o cliente manda os números em E.164 (só dígitos,
 * sem nome nenhum da agenda) e o servidor calcula `HMAC-SHA256(CONTACTS_PEPPER, e164)`.
 * Assim o Firestore guarda apenas hashes — um vazamento do banco não devolve telefones —
 * e não existe salt embutido no APK que permita montar um dicionário offline.
 *
 * Definir `CONTACTS_PEPPER` em `functions/.env`. Trocar o valor invalida o diretório inteiro
 * (os índices são regravados no próximo `bootstrapUser` de cada usuário).
 */
const PEPPER = process.env.CONTACTS_PEPPER ?? '';

function pepper(): string {
  if (PEPPER) return PEPPER;
  if (IS_EMULATOR) return 'emulator-only-pepper';
  throw new HttpsError('failed-precondition', 'Busca por contatos indisponível.');
}

export function phoneHash(e164: string): string {
  return createHmac('sha256', pepper()).update(e164).digest('hex');
}

const E164 = /^\+[1-9]\d{6,14}$/;

/** Lote máximo por chamada. O app fatia a agenda antes de enviar. */
export const MATCH_BATCH_LIMIT = 200;
/** Cota diária por usuário — trava enumeração em massa mesmo com App Check válido. */
export const MATCH_DAILY_NUMBERS = 3_000;
export const MATCH_DAILY_CALLS = 40;
const DAY_MS = 86_400_000;

/**
 * Grava (ou remove) o índice do telefone do próprio usuário.
 * O número vem do registro do Firebase Auth, nunca de um payload do cliente — é por isso que
 * ninguém consegue se cadastrar no diretório com o telefone de outra pessoa.
 */
export async function indexUserPhone(uid: string): Promise<void> {
  const user = await auth.getUser(uid).catch(() => null);
  const phone = user?.phoneNumber;
  const userRef = db.doc(`users/${uid}`);
  const previous = (await userRef.get()).data() as { phoneHash?: string } | undefined;
  if (!phone || !E164.test(phone)) return;
  const hash = phoneHash(phone);
  if (previous?.phoneHash === hash) return;
  const batch = db.batch();
  if (previous?.phoneHash) batch.delete(db.doc(`phoneIndex/${previous.phoneHash}`));
  batch.set(db.doc(`phoneIndex/${hash}`), { uid, updatedAt: now() });
  batch.set(userRef, { phoneHash: hash }, { merge: true });
  await batch.commit();
}

/** Remove o usuário do diretório (exclusão de conta). */
export async function removePhoneIndex(uid: string): Promise<void> {
  const user = (await db.doc(`users/${uid}`).get()).data() as { phoneHash?: string } | undefined;
  if (user?.phoneHash)
    await db
      .doc(`phoneIndex/${user.phoneHash}`)
      .delete()
      .catch(() => undefined);
}

/** Consome a cota diária do usuário. Devolve quantos números ainda restam. */
async function consumeQuota(uid: string, numbers: number): Promise<number> {
  const ref = db.doc(`contactSync/${uid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as
      { windowStart?: number; calls?: number; numbers?: number } | undefined;
    const fresh = !data?.windowStart || now() - data.windowStart > DAY_MS;
    const windowStart = fresh ? now() : data!.windowStart!;
    const calls = (fresh ? 0 : (data?.calls ?? 0)) + 1;
    const used = (fresh ? 0 : (data?.numbers ?? 0)) + numbers;
    if (calls > MATCH_DAILY_CALLS || used > MATCH_DAILY_NUMBERS)
      throw new HttpsError(
        'resource-exhausted',
        'Você já sincronizou muitos contatos hoje. Tente de novo amanhã.',
      );
    tx.set(ref, { windowStart, calls, numbers: used, updatedAt: now() }, { merge: true });
    return MATCH_DAILY_NUMBERS - used;
  });
}

/** Quem o usuário bloqueou e quem o bloqueou — nos dois casos o match é omitido. */
async function blockedUids(uid: string): Promise<Set<string>> {
  const [blocked, blockedBy] = await Promise.all([
    db.collection(`blocks/${uid}/blocked`).get(),
    db.collection(`blockedBy/${uid}/users`).get(),
  ]);
  return new Set([...blocked.docs, ...blockedBy.docs].map((d) => d.id));
}

/**
 * Encontra quais telefones da agenda já têm conta.
 *
 * Entrada: só números em E.164. Nome, e-mail e qualquer outro dado da agenda ficam no aparelho.
 * Saída: o índice do número na lista enviada (nunca o número) mais o perfil público do jogador.
 */
export const matchPhoneContacts = authedCallable<{ phones: string[] }, MatchPhoneContactsResult>(
  async ({ uid, data }) => {
    const phones = data.phones;
    if (phones.length === 0) return { matches: [], remainingQuota: MATCH_DAILY_NUMBERS };
    const remainingQuota = await consumeQuota(uid, phones.length);

    // Um número pode aparecer duas vezes no lote (dois contatos, mesmo telefone):
    // hasheia uma vez só e guarda todas as posições de origem.
    const indexesByHash = new Map<string, number[]>();
    phones.forEach((phone, i) => {
      const hash = phoneHash(phone);
      const list = indexesByHash.get(hash);
      if (list) list.push(i);
      else indexesByHash.set(hash, [i]);
    });

    const hashes = [...indexesByHash.keys()];
    const indexSnaps = await db.getAll(...hashes.map((h) => db.doc(`phoneIndex/${h}`)));
    const found = indexSnaps
      .map((snap, i) => ({ hash: hashes[i]!, uid: (snap.data() as { uid?: string })?.uid }))
      .filter((r): r is { hash: string; uid: string } => Boolean(r.uid));
    if (found.length === 0) return { matches: [], remainingQuota };

    const uids = [...new Set(found.map((f) => f.uid))];
    const [profiles, friendships, sent, received, blocks] = await Promise.all([
      db.getAll(...uids.map((u) => db.doc(`profiles/${u}`))),
      db.getAll(...uids.map((u) => db.doc(`friendships/${uid}/friends/${u}`))),
      db
        .collection('friendRequests')
        .where('from', '==', uid)
        .where('status', '==', 'pending')
        .get(),
      db.collection('friendRequests').where('to', '==', uid).where('status', '==', 'pending').get(),
      blockedUids(uid),
    ]);

    const profileByUid = new Map(
      profiles.map((p, i) => [uids[i]!, p.exists ? (p.data() as Profile) : null]),
    );
    const friendUids = new Set<string>();
    friendships.forEach((f, i) => {
      if (f.exists) friendUids.add(uids[i]!);
    });
    const sentTo = new Set(sent.docs.map((d) => (d.data() as { to: string }).to));
    const receivedFrom = new Set(received.docs.map((d) => (d.data() as { from: string }).from));

    const matches: ContactMatch[] = [];
    for (const { hash, uid: otherUid } of found) {
      if (blocks.has(otherUid)) continue;
      const profile = profileByUid.get(otherUid);
      // Sem apelido o cadastro não terminou: mostrar seria expor um perfil que não existe.
      if (!profile?.nickname) continue;
      const relation: FriendRelation =
        otherUid === uid
          ? 'self'
          : friendUids.has(otherUid)
            ? 'friend'
            : sentTo.has(otherUid)
              ? 'request_sent'
              : receivedFrom.has(otherUid)
                ? 'request_received'
                : 'none';
      for (const index of indexesByHash.get(hash) ?? []) {
        matches.push({
          index,
          uid: otherUid,
          nickname: profile.nickname,
          avatarId: profile.avatarId,
          level: profile.level,
          relation,
        });
      }
    }
    return { matches, remainingQuota };
  },
  (d) => validateMatchPayload(d),
);

/**
 * Validação do payload de `matchPhoneContacts`. Exportada para os testes porque é ela que
 * segura o tamanho do lote e garante que só E.164 chega ao diretório — a primeira barreira
 * contra enumeração, antes mesmo da cota diária.
 */
export function validateMatchPayload(data: unknown): { phones: string[] } {
  return {
    phones: arr(obj(data, 'payload').phones, 'phones', MATCH_BATCH_LIMIT, (p, i) => {
      const value = str(p, `phones[${i}]`, 8, 16);
      if (!E164.test(value)) throw new Error(`phones[${i}] inválido.`);
      return value;
    }),
  };
}

// --- Convite por QR Code -----------------------------------------------------

const INVITE_TTL = 30 * DAY_MS;
const INVITE_LINK = (token: string) => `trucomineiro://add-friend?token=${token}`;

/**
 * Token opaco de convite. Não carrega telefone nem o uid: quem lê o QR só consegue
 * transformá-lo em solicitação de amizade chamando `redeemFriendInviteToken`.
 */
export const createFriendInviteToken = authedCallable<Record<string, never>, FriendInviteToken>(
  async ({ uid }) => {
    const userRef = db.doc(`users/${uid}`);
    const current = (await userRef.get()).data() as
      { inviteToken?: string; inviteTokenExpiresAt?: number } | undefined;
    // Reaproveita o token válido para o QR do usuário não mudar a cada abertura da tela.
    if (current?.inviteToken && (current.inviteTokenExpiresAt ?? 0) > now() + DAY_MS) {
      return {
        token: current.inviteToken,
        link: INVITE_LINK(current.inviteToken),
        expiresAt: current.inviteTokenExpiresAt!,
      };
    }
    const token = randomBytes(16).toString('base64url');
    const expiresAt = now() + INVITE_TTL;
    const batch = db.batch();
    if (current?.inviteToken) batch.delete(db.doc(`friendInviteTokens/${current.inviteToken}`));
    batch.set(db.doc(`friendInviteTokens/${token}`), { uid, createdAt: now(), expiresAt });
    batch.set(userRef, { inviteToken: token, inviteTokenExpiresAt: expiresAt }, { merge: true });
    await batch.commit();
    return { token, link: INVITE_LINK(token), expiresAt };
  },
);

/** Resolve um token de QR no uid do dono. A solicitação em si passa por `sendFriendRequest`. */
export const resolveFriendInviteToken = authedCallable<{ token: string }, { uid: string }>(
  async ({ data }) => {
    const snap = await db.doc(`friendInviteTokens/${data.token}`).get();
    const doc = snap.data() as { uid?: string; expiresAt?: number } | undefined;
    if (!snap.exists || !doc?.uid || (doc.expiresAt ?? 0) < now())
      throw new HttpsError('not-found', 'Convite inválido ou expirado.');
    return { uid: doc.uid };
  },
  (d) => ({ token: str(obj(d, 'payload').token, 'token', 16, 64) }),
);
