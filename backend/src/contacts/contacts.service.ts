import { Injectable } from '@nestjs/common';
import { FriendRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { AutoConnectOutcome, FriendshipRepository } from '../friends/friendship.repository';
import { AppError } from '../common/errors';
import { moduleLogger } from '../common/logger';
import { now } from '../common/clock';
import { opaqueToken } from '../common/ids';
import { MetricsService } from '../metrics/metrics.service';
import { RealtimeService } from '../realtime/realtime.service';
import { S2C } from '../realtime/events';
import { E164, PhoneDirectoryService } from './phone-directory.service';
import type {
  AvatarId,
  ContactMatch,
  FriendInviteToken,
  FriendRelation,
  MatchPhoneContactsResult,
} from '../domain/model/types';

const log = moduleLogger('contacts');

/** Lote máximo por chamada. O app fatia a agenda antes de enviar. */
export const MATCH_BATCH_LIMIT = 200;
/** Cota diária por usuário — trava enumeração em massa. */
export const MATCH_DAILY_NUMBERS = 3_000;
export const MATCH_DAILY_CALLS = 40;
/** Teto de amizades criadas pela agenda por dia. */
export const AUTO_CONNECT_DAILY_LIMIT = 150;
const AUTH_LOOKUP_LIMIT = 100;
const CONNECT_CONCURRENCY = 10;
const DAY_MS = 86_400_000;
const INVITE_TTL = 30 * DAY_MS;
const INVITE_LINK = (token: string) => `trucomineiro://add-friend?token=${token}`;

/**
 * Sincronização da agenda com conexão automática.
 *
 * Entrada: só números E.164 (nome e qualquer outro dado da agenda ficam no aparelho).
 * Saída: o índice do número na lista enviada (nunca o número) + o perfil público do jogador.
 * Para cada conta encontrada (telefone confirmado no Firebase Auth), em ordem de prioridade:
 *   bloqueio → omitido; já amigos → `friend`; supressão → relação atual; senão → amizade criada.
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phones: PhoneDirectoryService,
    private readonly firebase: FirebaseAdminService,
    private readonly friendships: FriendshipRepository,
    private readonly metrics: MetricsService,
    private readonly realtime: RealtimeService,
  ) {}

  validatePhones(phones: unknown): string[] {
    if (!Array.isArray(phones)) throw new AppError('VALIDATION_FAILED', 'phones inválido.');
    if (phones.length > MATCH_BATCH_LIMIT)
      throw new AppError('VALIDATION_FAILED', `phones aceita no máximo ${MATCH_BATCH_LIMIT} itens.`);
    return phones.map((p, i) => {
      if (typeof p !== 'string' || p.length < 8 || p.length > 16 || !E164.test(p))
        throw new AppError('VALIDATION_FAILED', `phones[${i}] inválido.`);
      return p;
    });
  }

  /** Consome a cota diária (UPSERT atômico). */
  private async consumeQuota(userId: string, numbers: number) {
    const t = new Date(now());
    const cutoff = new Date(now() - DAY_MS);
    const rows = await this.prisma.$queryRaw<{ calls: number; numbers: number; connected: number }[]>`
      INSERT INTO "ContactSyncQuota" ("userId", "windowStart", "calls", "numbers", "connected", "updatedAt")
      VALUES (${userId}::uuid, ${t}, 1, ${numbers}, 0, ${t})
      ON CONFLICT ("userId") DO UPDATE SET
        "calls" = CASE WHEN "ContactSyncQuota"."windowStart" < ${cutoff} THEN 1 ELSE "ContactSyncQuota"."calls" + 1 END,
        "numbers" = CASE WHEN "ContactSyncQuota"."windowStart" < ${cutoff} THEN ${numbers} ELSE "ContactSyncQuota"."numbers" + ${numbers} END,
        "connected" = CASE WHEN "ContactSyncQuota"."windowStart" < ${cutoff} THEN 0 ELSE "ContactSyncQuota"."connected" END,
        "windowStart" = CASE WHEN "ContactSyncQuota"."windowStart" < ${cutoff} THEN ${t} ELSE "ContactSyncQuota"."windowStart" END,
        "updatedAt" = ${t}
      RETURNING "calls", "numbers", "connected"`;
    const q = rows[0]!;
    if (q.calls > MATCH_DAILY_CALLS || q.numbers > MATCH_DAILY_NUMBERS)
      throw new AppError('CONTACTS_QUOTA_EXCEEDED', 'Você já sincronizou muitos contatos hoje. Tente de novo amanhã.');
    return {
      remainingNumbers: MATCH_DAILY_NUMBERS - q.numbers,
      connectBudget: Math.max(0, AUTO_CONNECT_DAILY_LIMIT - q.connected),
    };
  }

  /**
   * Confirma no Firebase Auth que cada dono do índice ainda tem aquele telefone verificado.
   * O índice é só um atalho: a fonte de verdade é o telefone verificado por OTP.
   */
  private async verifiedOwners(pairs: { userId: string; hash: string }[]): Promise<Set<string>> {
    const uidRows = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(pairs.map((p) => p.userId))] } },
      select: { id: true, firebaseUid: true },
    });
    const idByUid = new Map(uidRows.map((r) => [r.firebaseUid, r.id]));
    const uids = [...idByUid.keys()];
    const hashById = new Map<string, string>();
    const disabled = new Set<string>();
    for (let i = 0; i < uids.length; i += AUTH_LOOKUP_LIMIT) {
      const res = await this.firebase.getUsers(uids.slice(i, i + AUTH_LOOKUP_LIMIT));
      for (const u of res.users) {
        const id = idByUid.get(u.uid)!;
        if (u.disabled) disabled.add(id);
        if (u.disabled || !u.phoneNumber || !E164.test(u.phoneNumber)) continue;
        hashById.set(id, this.phones.hash(u.phoneNumber));
      }
    }
    const ok = new Set<string>();
    for (const pair of pairs) {
      if (hashById.get(pair.userId) === pair.hash) ok.add(`${pair.userId}:${pair.hash}`);
      else if (!disabled.has(pair.userId)) {
        // Índice apontando para conta apagada ou que trocou de número: sai do diretório.
        log.warn('phone_index_stale', { userId: pair.userId });
        await this.phones.drop(pair.userId, pair.hash).catch(() => undefined);
      }
    }
    return ok;
  }

  async sync(userId: string, identityPhone: string | null, phones: string[]): Promise<MatchPhoneContactsResult> {
    if (phones.length === 0) return { matches: [], remainingQuota: MATCH_DAILY_NUMBERS, connected: 0 };
    const quota = await this.consumeQuota(userId, phones.length);
    const remainingQuota = quota.remainingNumbers;
    this.metrics.inc('contacts_sync_total');

    // Um número pode aparecer duas vezes no lote: hasheia uma vez e guarda todas as posições.
    const indexesByHash = new Map<string, number[]>();
    phones.forEach((phone, i) => {
      const hash = this.phones.hash(phone);
      const list = indexesByHash.get(hash);
      if (list) list.push(i);
      else indexesByHash.set(hash, [i]);
    });
    const owners = await this.phones.owners([...indexesByHash.keys()]);
    const indexed = [...owners.entries()].map(([hash, id]) => ({ hash, userId: id }));
    if (indexed.length === 0) return { matches: [], remainingQuota, connected: 0 };

    const confirmed = await this.verifiedOwners(indexed);
    const found = indexed.filter((f) => confirmed.has(`${f.userId}:${f.hash}`));
    if (found.length === 0) return { matches: [], remainingQuota, connected: 0 };

    const ids = [...new Set(found.map((f) => f.userId))];
    const [users, friendIds, pending, blocked, suppressions] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, firebaseUid: true, profile: { select: { nickname: true, avatarId: true, level: true } } },
      }),
      this.friendships.friendIds(userId),
      this.prisma.friendRequest.findMany({
        where: {
          status: FriendRequestStatus.PENDING,
          OR: [
            { fromUserId: userId, toUserId: { in: ids } },
            { toUserId: userId, fromUserId: { in: ids } },
          ],
        },
        select: { fromUserId: true, toUserId: true },
      }),
      this.friendships.blockedSet(userId),
      this.prisma.friendshipSuppression.findMany({
        where: {
          OR: [
            { userId, otherUserId: { in: ids } },
            { otherUserId: userId, userId: { in: ids } },
          ],
        },
        select: { userId: true, otherUserId: true },
      }),
    ]);
    // Só quem tem telefone verificado conecta automaticamente.
    const canConnect = Boolean(identityPhone);
    const userById = new Map(users.map((u) => [u.id, u]));
    const friends = new Set(friendIds);
    const sentTo = new Set(pending.filter((p) => p.fromUserId === userId).map((p) => p.toUserId));
    const receivedFrom = new Set(pending.filter((p) => p.toUserId === userId).map((p) => p.fromUserId));
    const suppressed = new Set(suppressions.map((s) => (s.userId === userId ? s.otherUserId : s.userId)));
    const relationOf = (other: string): FriendRelation =>
      other === userId
        ? 'self'
        : friends.has(other)
          ? 'friend'
          : sentTo.has(other)
            ? 'request_sent'
            : receivedFrom.has(other)
              ? 'request_received'
              : 'none';

    const eligible = ids.filter(
      (id) =>
        id !== userId &&
        !blocked.has(id) &&
        Boolean(userById.get(id)?.profile?.nickname) &&
        !friends.has(id) &&
        !suppressed.has(id),
    );
    const toConnect = canConnect ? eligible.slice(0, quota.connectBudget) : [];
    if (canConnect && toConnect.length < eligible.length) log.warn('auto_connect_daily_limit', { userId });
    const outcomes = new Map<string, AutoConnectOutcome>();
    for (let i = 0; i < toConnect.length; i += CONNECT_CONCURRENCY) {
      const group = toConnect.slice(i, i + CONNECT_CONCURRENCY);
      const results = await Promise.all(
        group.map((other) =>
          this.friendships.autoConnect(userId, other).catch((e: unknown): null => {
            log.error('auto_connect_failed', { userId, other, error: String(e) });
            return null;
          }),
        ),
      );
      group.forEach((other, j) => {
        const outcome = results[j];
        if (outcome) outcomes.set(other, outcome);
      });
    }
    const connectedIds = [...outcomes.entries()].filter(([, o]) => o === 'connected').map(([id]) => id);
    const suppressedCount = ids.filter(
      (id) =>
        id !== userId &&
        !blocked.has(id) &&
        !friends.has(id) &&
        (suppressed.has(id) || outcomes.get(id) === 'suppressed'),
    ).length;
    if (connectedIds.length > 0) {
      await this.prisma.contactSyncQuota.update({
        where: { userId },
        data: { connected: { increment: connectedIds.length } },
      });
      this.metrics.inc('contacts_auto_connected_total', {}, connectedIds.length);
      // Os dois lados veem o amigo novo na hora.
      this.realtime.toUsers([userId, ...connectedIds], S2C.friendsChanged, { reason: 'phone_contact' });
    }

    const matches: ContactMatch[] = [];
    for (const { hash, userId: other } of found) {
      const outcome = outcomes.get(other);
      if (blocked.has(other) || outcome === 'blocked') continue;
      const u = userById.get(other);
      // Sem apelido o cadastro não terminou: mostrar seria expor um perfil que não existe.
      if (!u?.profile?.nickname) continue;
      const autoConnected = outcome === 'connected';
      const relation: FriendRelation =
        autoConnected || outcome === 'already_friends' ? 'friend' : relationOf(other);
      for (const index of indexesByHash.get(hash) ?? []) {
        matches.push({
          index,
          uid: u.firebaseUid,
          nickname: u.profile.nickname,
          avatarId: u.profile.avatarId as AvatarId,
          level: u.profile.level,
          relation,
          ...(autoConnected ? { autoConnected: true } : {}),
        });
      }
    }
    return { matches, remainingQuota, connected: connectedIds.length, suppressed: suppressedCount };
  }

  // --- Convite por QR Code -----------------------------------------------------------------

  /** Token opaco (sem telefone, sem uid). Reaproveitado enquanto válido: o QR não muda à toa. */
  async createInviteToken(userId: string): Promise<FriendInviteToken> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { inviteToken: true, inviteTokenExpiresAt: true },
    });
    if (user.inviteToken && (user.inviteTokenExpiresAt?.getTime() ?? 0) > now() + DAY_MS) {
      return {
        token: user.inviteToken,
        link: INVITE_LINK(user.inviteToken),
        expiresAt: user.inviteTokenExpiresAt!.getTime(),
      };
    }
    const token = opaqueToken(16);
    const expiresAt = now() + INVITE_TTL;
    await this.prisma.user.update({
      where: { id: userId },
      data: { inviteToken: token, inviteTokenExpiresAt: new Date(expiresAt) },
    });
    return { token, link: INVITE_LINK(token), expiresAt };
  }

  /** Token do QR → uid do dono. A solicitação em si passa por `POST /friends/requests`. */
  async resolveInviteToken(token: string): Promise<{ uid: string }> {
    const user = await this.prisma.user.findUnique({
      where: { inviteToken: token },
      select: { firebaseUid: true, inviteTokenExpiresAt: true },
    });
    if (!user || (user.inviteTokenExpiresAt?.getTime() ?? 0) < now())
      throw new AppError('INVITE_TOKEN_INVALID', 'Convite inválido ou expirado.');
    return { uid: user.firebaseUid };
  }
}
