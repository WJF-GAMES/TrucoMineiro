import { Injectable } from '@nestjs/common';
import { FriendRequestStatus, FriendshipSource, SuppressionReason } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';

/**
 * Regras de relacionamento compartilhadas entre a amizade manual, a conexão automática pela
 * agenda e os convites de sala.
 *
 * Modelo: UMA linha por par (`userAId < userBId`). Duas sincronizações simultâneas (A e B ao mesmo
 * tempo) tentam a mesma chave — nunca existe "A-B" e "B-A".
 * Prioridade na conexão automática: BLOQUEIO → JÁ AMIGOS → SUPRESSÃO → CONECTAR.
 */
export type AutoConnectOutcome = 'connected' | 'already_friends' | 'blocked' | 'suppressed';

export const pairOf = (a: string, b: string): { userAId: string; userBId: string } =>
  a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };

@Injectable()
export class FriendshipRepository {
  constructor(private readonly prisma: PrismaService) {}

  async areFriends(a: string, b: string, db: Tx | PrismaService = this.prisma): Promise<boolean> {
    const row = await db.friendship.findUnique({ where: { userAId_userBId: pairOf(a, b) } });
    return row !== null;
  }

  /** Bloqueio em qualquer sentido. */
  async blockedEitherWay(
    a: string,
    b: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<boolean> {
    const n = await db.blockedUser.count({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    });
    return n > 0;
  }

  /** Quem `userId` bloqueou e quem bloqueou `userId`. */
  async blockedSet(userId: string, db: Tx | PrismaService = this.prisma): Promise<Set<string>> {
    const rows = await db.blockedUser.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
  }

  async friendIds(userId: string, db: Tx | PrismaService = this.prisma): Promise<string[]> {
    const rows = await db.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { userAId: true, userBId: true },
    });
    return rows.map((r) => (r.userAId === userId ? r.userBId : r.userAId));
  }

  /** Grava a amizade, encerra solicitações pendentes do par e limpa as supressões. */
  async writeFriendship(tx: Tx, a: string, b: string, source: FriendshipSource): Promise<void> {
    const pair = pairOf(a, b);
    await tx.friendship.upsert({
      where: { userAId_userBId: pair },
      create: { ...pair, source },
      update: {},
    });
    // Pendente + conectado ao mesmo tempo não existe: a solicitação vira "aceita".
    await tx.friendRequest.updateMany({
      where: {
        status: FriendRequestStatus.PENDING,
        OR: [
          { fromUserId: a, toUserId: b },
          { fromUserId: b, toUserId: a },
        ],
      },
      data: { status: FriendRequestStatus.ACCEPTED, resolvedBy: source },
    });
    await tx.friendshipSuppression.deleteMany({
      where: {
        OR: [
          { userId: a, otherUserId: b },
          { userId: b, otherUserId: a },
        ],
      },
    });
  }

  async removeFriendship(tx: Tx, a: string, b: string): Promise<void> {
    await tx.friendship.deleteMany({ where: pairOf(a, b) });
  }

  async suppress(tx: Tx, userId: string, otherUserId: string, reason: SuppressionReason) {
    await tx.friendshipSuppression.upsert({
      where: { userId_otherUserId: { userId, otherUserId } },
      create: { userId, otherUserId, reason },
      update: { reason },
    });
  }

  /**
   * Conecta `userId` e `otherId` porque `otherId` está na agenda de `userId` com o telefone
   * verificado. Transação com trava do par: um bloqueio que chega no meio vence, e repetir a
   * chamada não muda nada (idempotente).
   */
  async autoConnect(userId: string, otherId: string): Promise<AutoConnectOutcome> {
    if (userId === otherId) return 'already_friends';
    const pair = pairOf(userId, otherId);
    return this.prisma.tx(async (tx) => {
      await this.prisma.advisoryLock(tx, `friend:${pair.userAId}:${pair.userBId}`);
      if (await this.blockedEitherWay(userId, otherId, tx)) return 'blocked';
      if (await this.areFriends(userId, otherId, tx)) {
        // Já amigos: só encerra solicitação esquecida.
        await tx.friendRequest.updateMany({
          where: {
            status: FriendRequestStatus.PENDING,
            OR: [
              { fromUserId: userId, toUserId: otherId },
              { fromUserId: otherId, toUserId: userId },
            ],
          },
          data: {
            status: FriendRequestStatus.ACCEPTED,
            resolvedBy: FriendshipSource.PHONE_CONTACT,
          },
        });
        return 'already_friends';
      }
      const suppressed = await tx.friendshipSuppression.count({
        where: {
          OR: [
            { userId, otherUserId: otherId },
            { userId: otherId, otherUserId: userId },
          ],
        },
      });
      if (suppressed > 0) return 'suppressed';
      await this.writeFriendship(tx, userId, otherId, FriendshipSource.PHONE_CONTACT);
      return 'connected';
    });
  }
}
