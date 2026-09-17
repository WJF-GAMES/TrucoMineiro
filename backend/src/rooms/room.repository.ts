import { Injectable } from '@nestjs/common';
import {
  Room as RoomRow,
  RoomClosedReason,
  RoomFillPolicy,
  RoomInviteStatus,
  RoomSource,
  RoomStatus,
} from '@prisma/client';
import { Tx } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { now } from '../common/clock';
import type {
  AvatarId,
  Room,
  RoomClosedReason as DomainClosedReason,
  RoomInviteStatus as DomainInviteStatus,
  RoomPlayer,
  RoomSeatInvite,
  RoomStatus as DomainRoomStatus,
} from '../domain/model/types';

const STATUS_TO_DOMAIN: Record<RoomStatus, DomainRoomStatus> = {
  WAITING: 'waiting',
  STARTING: 'starting',
  IN_MATCH: 'in_match',
  CLOSED: 'closed',
};
const STATUS_FROM_DOMAIN: Record<DomainRoomStatus, RoomStatus> = {
  waiting: RoomStatus.WAITING,
  starting: RoomStatus.STARTING,
  in_match: RoomStatus.IN_MATCH,
  closed: RoomStatus.CLOSED,
};

/** Sala lida com trava + tradução entre o uid público e o id interno de quem aparece nela. */
export interface LoadedRoom {
  row: RoomRow;
  room: Room;
  /** uid público → id interno (humanos) */
  idOf: Map<string, string>;
  /** convidado (uid) → quem convidou (id interno) */
  inviterOf: Map<string, string>;
  /** Convites com assento nulo (convite simples) — o domínio os vê com `seat: -1`. */
  seatless: Set<string>;
  /** Convites já dispensados da caixa de entrada. */
  dismissed: Map<string, Date | null>;
}

@Injectable()
export class RoomRepository {
  /** Trava a sala (linha) até o fim da transação. `null` quando o código não existe. */
  async lock(tx: Tx, code: string): Promise<LoadedRoom | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Room" WHERE code = ${code} FOR UPDATE`;
    if (rows.length === 0) return null;
    return this.load(tx, rows[0]!.id);
  }

  async require(tx: Tx, code: string, message = 'Sala não encontrada. Confira o código.'): Promise<LoadedRoom> {
    const loaded = await this.lock(tx, code);
    if (!loaded) throw new AppError('ROOM_NOT_FOUND', message);
    return loaded;
  }

  async load(tx: Tx, roomId: string): Promise<LoadedRoom> {
    const row = await tx.room.findUniqueOrThrow({
      where: { id: roomId },
      include: {
        host: { select: { firebaseUid: true } },
        seats: { include: { user: { select: { firebaseUid: true } }, reservedFor: { select: { firebaseUid: true } } } },
        invites: {
          include: {
            invitee: {
              select: { firebaseUid: true, profile: { select: { nickname: true, avatarId: true } } },
            },
          },
        },
      },
    });
    const idOf = new Map<string, string>([[row.host.firebaseUid, row.hostUserId]]);
    const players: Record<string, RoomPlayer> = {};
    for (const s of row.seats) {
      const uid = s.isBot || !s.user ? (s.botKey ?? `bot_${s.seat}`) : s.user.firebaseUid;
      if (!s.isBot && s.userId) idOf.set(uid, s.userId);
      if (s.reservedFor && s.reservedForUserId) idOf.set(s.reservedFor.firebaseUid, s.reservedForUserId);
      players[uid] = {
        uid,
        seat: s.seat,
        nickname: s.nickname,
        avatarId: s.avatarId as AvatarId,
        ready: s.ready,
        bot: s.isBot,
        joinedAt: s.joinedAt.getTime(),
        connected: s.connected,
        ...(s.isBot ? { reservedFor: s.reservedFor?.firebaseUid ?? null } : {}),
      };
    }
    const invites: Record<string, RoomSeatInvite> = {};
    const inviterOf = new Map<string, string>();
    const seatless = new Set<string>();
    const dismissed = new Map<string, Date | null>();
    for (const i of row.invites) {
      const uid = i.invitee.firebaseUid;
      idOf.set(uid, i.inviteeUserId);
      inviterOf.set(uid, i.inviterUserId);
      dismissed.set(uid, i.dismissedAt);
      if (i.seat === null) seatless.add(uid);
      invites[uid] = {
        uid,
        seat: i.seat ?? -1,
        nickname: i.invitee.profile?.nickname ?? '',
        avatarId: (i.invitee.profile?.avatarId ?? 'joao') as AvatarId,
        status: i.status as DomainInviteStatus,
        invitedAt: i.invitedAt.getTime(),
        respondedAt: i.respondedAt?.getTime() ?? null,
      };
    }
    const room: Room = {
      code: row.code,
      hostUid: row.host.firebaseUid,
      status: STATUS_TO_DOMAIN[row.status],
      maxPlayers: 4,
      players,
      sessionId: row.currentMatchId,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      source: row.source === RoomSource.MATCHMAKING ? 'matchmaking' : 'private',
      invites,
      inviteExpiresAt: row.inviteExpiresAt?.getTime() ?? null,
      lateJoinUntil: row.lateJoinUntil?.getTime() ?? null,
      ...(row.fillPolicy ? { fillWithAi: row.fillPolicy === RoomFillPolicy.ON_TIMEOUT ? 'on_timeout' : 'manual' } : {}),
      closedReason: (row.closedReason?.toLowerCase() as DomainClosedReason | undefined) ?? null,
    };
    return { row, room, idOf, inviterOf, seatless, dismissed };
  }

  /**
   * Grava a sala nova sobre a antiga (dentro da mesma transação da trava).
   * `inviterId` é quem convida os convidados novos (o dono, por padrão).
   */
  async save(tx: Tx, loaded: LoadedRoom, next: Room, extra: { inviterId?: string; inviteTtlMs?: number } = {}) {
    const { row, idOf } = loaded;
    const unknown = [...Object.values(next.players), ...Object.values(next.invites ?? {})]
      .map((p) => ('bot' in p && p.bot ? null : p.uid))
      .filter((uid): uid is string => Boolean(uid) && !idOf.has(uid!));
    if (unknown.length > 0) {
      const users = await tx.user.findMany({
        where: { firebaseUid: { in: unknown } },
        select: { id: true, firebaseUid: true },
      });
      for (const u of users) idOf.set(u.firebaseUid, u.id);
    }
    const reservedIds = Object.values(next.players)
      .map((p) => p.reservedFor)
      .filter((u): u is string => Boolean(u) && !idOf.has(u!));
    if (reservedIds.length > 0) {
      const users = await tx.user.findMany({
        where: { firebaseUid: { in: reservedIds } },
        select: { id: true, firebaseUid: true },
      });
      for (const u of users) idOf.set(u.firebaseUid, u.id);
    }

    await tx.room.update({
      where: { id: row.id },
      data: {
        status: STATUS_FROM_DOMAIN[next.status],
        closedReason: next.closedReason ? (next.closedReason.toUpperCase() as RoomClosedReason) : null,
        inviteExpiresAt: next.inviteExpiresAt ? new Date(next.inviteExpiresAt) : null,
        lateJoinUntil: next.lateJoinUntil ? new Date(next.lateJoinUntil) : null,
        fillPolicy: next.fillWithAi
          ? next.fillWithAi === 'on_timeout'
            ? RoomFillPolicy.ON_TIMEOUT
            : RoomFillPolicy.MANUAL
          : null,
        currentMatchId: next.sessionId ?? null,
        version: { increment: 1 },
      },
    });

    const before = loaded.room.players;
    if (!samePlayers(before, next.players)) {
      await tx.roomSeat.deleteMany({ where: { roomId: row.id } });
      await tx.roomSeat.createMany({
        data: Object.values(next.players).map((p) => ({
          roomId: row.id,
          seat: p.seat,
          userId: p.bot ? null : (idOf.get(p.uid) ?? null),
          botKey: p.bot ? p.uid : null,
          nickname: p.nickname,
          avatarId: p.avatarId,
          ready: p.ready,
          isBot: p.bot,
          connected: p.connected !== false,
          reservedForUserId: p.bot && p.reservedFor ? (idOf.get(p.reservedFor) ?? null) : null,
          joinedAt: new Date(p.joinedAt),
        })),
      });
    }

    const oldInvites = loaded.room.invites ?? {};
    const newInvites = next.invites ?? {};
    for (const uid of Object.keys(oldInvites)) {
      if (!(uid in newInvites)) {
        const inviteeUserId = idOf.get(uid);
        if (inviteeUserId)
          await tx.roomInvite.deleteMany({ where: { roomId: row.id, inviteeUserId } });
      }
    }
    const t = now();
    for (const inv of Object.values(newInvites)) {
      const old = oldInvites[inv.uid];
      if (old && old.status === inv.status && old.seat === inv.seat && old.respondedAt === inv.respondedAt) continue;
      const inviteeUserId = idOf.get(inv.uid);
      if (!inviteeUserId) continue;
      const closed = inv.status !== 'PENDING' && inv.status !== 'AI_FILLED';
      await tx.roomInvite.upsert({
        where: { roomId_inviteeUserId: { roomId: row.id, inviteeUserId } },
        create: {
          roomId: row.id,
          inviteeUserId,
          inviterUserId: extra.inviterId ?? row.hostUserId,
          seat: inv.seat >= 0 ? inv.seat : null,
          status: inv.status as RoomInviteStatus,
          invitedAt: new Date(inv.invitedAt),
          respondedAt: inv.respondedAt ? new Date(inv.respondedAt) : null,
          expiresAt: new Date(next.lateJoinUntil ?? t + (extra.inviteTtlMs ?? 10 * 60_000)),
        },
        update: {
          seat: inv.seat >= 0 ? inv.seat : null,
          status: inv.status as RoomInviteStatus,
          respondedAt: inv.respondedAt ? new Date(inv.respondedAt) : null,
          ...(next.lateJoinUntil ? { expiresAt: new Date(next.lateJoinUntil) } : {}),
          // Convite respondido/encerrado sai da caixa de entrada.
          ...(closed ? { dismissedAt: new Date(t) } : {}),
        },
      });
    }
  }

  /** Ids internos dos humanos sentados. */
  humanIds(loaded: LoadedRoom, room: Room = loaded.room): string[] {
    return Object.values(room.players)
      .filter((p) => !p.bot)
      .map((p) => loaded.idOf.get(p.uid))
      .filter((id): id is string => Boolean(id));
  }
}

function samePlayers(a: Room['players'], b: Room['players']): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const x = a[k];
    const y = b[k];
    return (
      y !== undefined &&
      x!.seat === y.seat &&
      x!.ready === y.ready &&
      x!.bot === y.bot &&
      x!.nickname === y.nickname &&
      x!.avatarId === y.avatarId &&
      (x!.connected ?? true) === (y.connected ?? true) &&
      (x!.reservedFor ?? null) === (y.reservedFor ?? null)
    );
  });
}
