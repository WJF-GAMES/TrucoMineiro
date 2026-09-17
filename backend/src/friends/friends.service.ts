import { Injectable } from '@nestjs/common';
import {
  FriendRequestStatus,
  FriendshipSource,
  NotificationType,
  Prisma,
  SuppressionReason,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { RealtimeService } from '../realtime/realtime.service';
import { S2C } from '../realtime/events';
import { PushService } from '../notifications/push.service';
import { PresenceService } from '../presence/presence.service';
import { UserLookupService, toProfile } from '../users/user-lookup.service';
import { FriendshipRepository, pairOf } from './friendship.repository';
import type { AvatarId, FriendRequest, Presence, Profile } from '../domain/model/types';

export interface FriendEntry {
  uid: string;
  since: number;
  source: 'manual' | 'phone_contact';
  profile: Profile;
  presence: Presence;
}

const sourceOf = (s: FriendshipSource) =>
  (s === FriendshipSource.PHONE_CONTACT ? 'phone_contact' : 'manual') as FriendEntry['source'];

/**
 * Amizades, solicitações e bloqueios. Toda escrita é transacional e avisa os dois lados pelo
 * WebSocket (lista ao vivo).
 */
@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: FriendshipRepository,
    private readonly users: UserLookupService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly presence: PresenceService,
  ) {}

  private changed(ids: string[], what: 'friends' | 'requests' | 'blocks') {
    const event =
      what === 'friends'
        ? S2C.friendsChanged
        : what === 'requests'
          ? S2C.friendRequestsChanged
          : S2C.blocksChanged;
    this.realtime.toUsers([...new Set(ids)], event, { at: Date.now() });
  }

  async list(userId: string): Promise<FriendEntry[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: {
        userAId: true,
        userBId: true,
        source: true,
        createdAt: true,
        userA: { select: { firebaseUid: true, countryCode: true, profile: true, presence: true } },
        userB: { select: { firebaseUid: true, countryCode: true, profile: true, presence: true } },
      },
    });
    const out: FriendEntry[] = [];
    for (const r of rows) {
      const other = r.userAId === userId ? r.userB : r.userA;
      if (!other.profile?.nickname) continue;
      const p = other.presence;
      const s = p?.state ?? 'OFFLINE';
      out.push({
        uid: other.firebaseUid,
        since: r.createdAt.getTime(),
        source: sourceOf(r.source),
        profile: toProfile(other.firebaseUid, other.profile, other.countryCode),
        presence: {
          state: s === 'OFFLINE' ? 'offline' : s === 'IN_MATCH' ? 'in_match' : 'online',
          lastChanged: p?.updatedAt.getTime() ?? 0,
          sessionId: p?.matchId ?? null,
        },
      });
    }
    return out;
  }

  async requests(
    userId: string,
  ): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
    const rows = await this.prisma.friendRequest.findMany({
      where: {
        status: FriendRequestStatus.PENDING,
        OR: [{ toUserId: userId }, { fromUserId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        from: {
          select: { firebaseUid: true, profile: { select: { nickname: true, avatarId: true } } },
        },
        to: {
          select: { firebaseUid: true, profile: { select: { nickname: true, avatarId: true } } },
        },
      },
    });
    const map = (r: (typeof rows)[number]): FriendRequest => ({
      id: r.id,
      from: r.from.firebaseUid,
      to: r.to.firebaseUid,
      fromNickname: r.from.profile?.nickname ?? '',
      fromAvatarId: (r.from.profile?.avatarId ?? 'joao') as AvatarId,
      toNickname: r.to.profile?.nickname ?? '',
      toAvatarId: (r.to.profile?.avatarId ?? 'joao') as AvatarId,
      status: 'pending',
      createdAt: r.createdAt.getTime(),
    });
    return {
      incoming: rows.filter((r) => r.toUserId === userId).map(map),
      outgoing: rows.filter((r) => r.fromUserId === userId).map(map),
    };
  }

  async sendRequest(userId: string, toUid: string): Promise<{ ok: true }> {
    const toId = await this.users.idOf(toUid);
    if (toId === userId) throw new AppError('FRIEND_SELF', 'Você não pode adicionar a si mesmo.');
    if (!toId) throw new AppError('PLAYER_NOT_FOUND', 'Jogador não encontrado.');
    const identities = await this.users.identities([userId, toId]);
    const me = identities.get(userId);
    const target = identities.get(toId);
    if (!target?.nickname) throw new AppError('PLAYER_NOT_FOUND', 'Jogador não encontrado.');
    if (!me?.nickname)
      throw new AppError('PROFILE_INCOMPLETE', 'Complete seu cadastro para continuar.');
    const pair = pairOf(userId, toId);

    const outcome = await this.prisma.tx(async (tx) => {
      await this.prisma.advisoryLock(tx, `friend:${pair.userAId}:${pair.userBId}`);
      if (await this.repo.areFriends(userId, toId, tx))
        throw new AppError('FRIEND_ALREADY', 'Vocês já são amigos.');
      // Mesma mensagem nos dois sentidos: quem bloqueou não fica exposto.
      if (await this.repo.blockedEitherWay(userId, toId, tx))
        throw new AppError('FRIEND_BLOCKED', 'Não é possível adicionar esse jogador.');
      const incoming = await tx.friendRequest.findUnique({
        where: { fromUserId_toUserId: { fromUserId: toId, toUserId: userId } },
      });
      // Uma solicitação já recebida vira amizade direto (em vez do par duplicado A→B/B→A).
      if (incoming?.status === FriendRequestStatus.PENDING) {
        await this.repo.writeFriendship(tx, userId, toId, FriendshipSource.MANUAL);
        return 'connected' as const;
      }
      const outgoing = await tx.friendRequest.findUnique({
        where: { fromUserId_toUserId: { fromUserId: userId, toUserId: toId } },
      });
      if (outgoing?.status === FriendRequestStatus.PENDING)
        throw new AppError('FRIEND_REQUEST_EXISTS', 'Solicitação já enviada.');
      await tx.friendRequest.upsert({
        where: { fromUserId_toUserId: { fromUserId: userId, toUserId: toId } },
        create: { fromUserId: userId, toUserId: toId },
        update: { status: FriendRequestStatus.PENDING, resolvedBy: null, createdAt: new Date() },
      });
      return 'requested' as const;
    });

    if (outcome === 'connected') {
      this.changed([userId, toId], 'friends');
      this.changed([userId, toId], 'requests');
      return { ok: true };
    }
    this.changed([userId, toId], 'requests');
    await this.push.notify(toId, {
      type: NotificationType.FRIEND_REQUEST,
      title: 'Nova solicitação de amizade',
      body: `${me.nickname} quer jogar truco com você.`,
      data: { type: 'friend_invite', from: me.uid },
      collapseKey: `friend_${me.uid}`,
    });
    return { ok: true };
  }

  async respond(userId: string, requestId: string, accept: boolean): Promise<{ ok: true }> {
    const affected = await this.prisma.tx(async (tx) => {
      const req = await tx.friendRequest.findUnique({ where: { id: requestId } });
      if (!req) throw new AppError('FRIEND_REQUEST_NOT_FOUND', 'Solicitação não encontrada.');
      if (req.toUserId !== userId)
        throw new AppError('FRIEND_REQUEST_NOT_YOURS', 'Essa solicitação não é sua.');
      if (req.status !== FriendRequestStatus.PENDING) return null;
      if (accept) {
        if (await this.repo.blockedEitherWay(req.fromUserId, userId, tx))
          throw new AppError('FRIEND_BLOCKED', 'Não é possível adicionar esse jogador.');
        // Aceitar à mão também reativa a conexão pela agenda (limpa a supressão do par).
        await this.repo.writeFriendship(tx, userId, req.fromUserId, FriendshipSource.MANUAL);
      } else {
        await tx.friendRequest.update({
          where: { id: requestId },
          data: { status: FriendRequestStatus.DECLINED },
        });
      }
      return req.fromUserId;
    });
    if (affected) {
      this.changed([userId, affected], 'requests');
      if (accept) this.changed([userId, affected], 'friends');
    }
    return { ok: true };
  }

  async cancelRequest(userId: string, toUid: string): Promise<{ ok: true }> {
    const toId = await this.users.idOf(toUid);
    if (!toId) return { ok: true };
    const res = await this.prisma.friendRequest.deleteMany({
      where: { fromUserId: userId, toUserId: toId, status: FriendRequestStatus.PENDING },
    });
    if (res.count > 0) this.changed([userId, toId], 'requests');
    return { ok: true };
  }

  /**
   * Desfaz a amizade. Se a pessoa continua na agenda de qualquer um dos dois, a próxima
   * sincronização NÃO reconecta: a supressão só sai quando voltam a ser amigos à mão.
   */
  async remove(userId: string, friendUid: string): Promise<{ ok: true }> {
    const friendId = await this.users.idOf(friendUid);
    if (friendId === userId) throw new AppError('FRIEND_SELF', 'Você não pode remover a si mesmo.');
    if (!friendId) return { ok: true };
    await this.prisma.tx(async (tx) => {
      await this.repo.removeFriendship(tx, userId, friendId);
      await this.repo.suppress(tx, userId, friendId, SuppressionReason.REMOVED);
    });
    this.changed([userId, friendId], 'friends');
    return { ok: true };
  }

  /**
   * Bloqueia: desfaz a amizade, apaga solicitações nos dois sentidos e suprime a conexão pela
   * agenda (desbloquear depois não reconecta sozinho).
   */
  async block(userId: string, targetUid: string): Promise<{ ok: true }> {
    const targetId = await this.users.idOf(targetUid);
    if (targetId === userId)
      throw new AppError('FRIEND_SELF', 'Você não pode bloquear a si mesmo.');
    if (!targetId) throw new AppError('PLAYER_NOT_FOUND', 'Jogador não encontrado.');
    await this.prisma.tx(async (tx) => {
      await tx.blockedUser.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
        create: { blockerId: userId, blockedId: targetId },
        update: {},
      });
      await this.repo.suppress(tx, userId, targetId, SuppressionReason.BLOCKED);
      await this.repo.removeFriendship(tx, userId, targetId);
      await tx.friendRequest.deleteMany({
        where: {
          OR: [
            { fromUserId: userId, toUserId: targetId },
            { fromUserId: targetId, toUserId: userId },
          ],
        },
      });
    });
    this.changed([userId, targetId], 'friends');
    this.changed([userId, targetId], 'requests');
    this.changed([userId], 'blocks');
    return { ok: true };
  }

  async unblock(userId: string, targetUid: string): Promise<{ ok: true }> {
    const targetId = await this.users.idOf(targetUid);
    if (!targetId) return { ok: true };
    await this.prisma.blockedUser.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
    this.changed([userId], 'blocks');
    return { ok: true };
  }

  /** Quem eu bloqueei (a tela "Bloqueados"). Quem me bloqueou nunca é exposto. */
  async blocked(
    userId: string,
  ): Promise<{ uid: string; since: number; profile: Profile | null }[]> {
    const rows = await this.prisma.blockedUser.findMany({
      where: { blockerId: userId },
      orderBy: { createdAt: 'desc' },
      include: { blocked: { select: { firebaseUid: true, countryCode: true, profile: true } } },
    });
    return rows.map((r) => ({
      uid: r.blocked.firebaseUid,
      since: r.createdAt.getTime(),
      profile: r.blocked.profile
        ? toProfile(r.blocked.firebaseUid, r.blocked.profile, r.blocked.countryCode)
        : null,
    }));
  }

  /** Presença de uma lista de jogadores (contatos da agenda que já jogam). */
  async presenceOf(viewerId: string, uids: string[]): Promise<Record<string, Presence>> {
    return (await this.presence.visibleFor(viewerId, uids)).presence;
  }

  static isUniqueViolation(e: unknown) {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }
}
