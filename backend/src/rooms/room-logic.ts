import type {
  AvatarId,
  Room,
  RoomClosedReason,
  RoomPlayer,
  RoomSeatInvite,
} from '../domain/model/types';
import type { ErrorCode } from '../common/errors';
import { MESSAGES } from '../common/errors';
import { botKey } from '../common/ids';

/**
 * Regras puras da sala (sem banco): assentos, reservas dos convidados, preenchimento por IA e
 * fechamento. O serviço lê a sala (com trava), aplica isto e grava.
 *
 * Times: assento % 2 (0 e 2 contra 1 e 3). Com amigos A, B e C nos assentos 1, 2 e 3, o dono joga
 * com B contra A e C.
 */

export const SEATS = [0, 1, 2, 3] as const;

const BOT_POOL: { nickname: string; avatarId: AvatarId }[] = [
  { nickname: 'Seu Zé (IA)', avatarId: 'seu_ze' },
  { nickname: 'Maria (IA)', avatarId: 'maria' },
  { nickname: 'Tião (IA)', avatarId: 'tiao' },
  { nickname: 'Galo (IA)', avatarId: 'galo' },
];

export const playersOf = (room: Room) => Object.values(room.players ?? {});
export const invitesOf = (room: Room) => Object.values(room.invites ?? {});

/** Vagas guardadas para convidados que ainda podem chegar (pendentes, com assento). */
export function reservedSeats(room: Room): Set<number> {
  return new Set(
    invitesOf(room)
      .filter((i) => i.status === 'PENDING' && i.seat >= 0)
      .map((i) => i.seat),
  );
}

/** Primeiro assento sem ninguém e sem reserva — é o que um visitante pelo código pode pegar. */
export function freeSeat(room: Room): number | null {
  const taken = new Set(playersOf(room).map((p) => p.seat));
  const reserved = reservedSeats(room);
  for (const s of SEATS) if (!taken.has(s) && !reserved.has(s)) return s;
  return null;
}

/** Assento sem jogador e sem reserva — o dono pode chamar outro amigo para ele. */
export function openSeatForInvite(room: Room): number | null {
  const taken = new Set(playersOf(room).map((p) => p.seat));
  const reserved = reservedSeats(room);
  for (const s of SEATS) if (s !== 0 && !taken.has(s) && !reserved.has(s)) return s;
  return null;
}

function botFor(seat: number, used: Set<string>, t: number, reservedFor: string | null): RoomPlayer {
  const bot = BOT_POOL.find((b) => !used.has(b.nickname)) ?? BOT_POOL[seat % BOT_POOL.length]!;
  used.add(bot.nickname);
  return {
    uid: botKey(seat),
    seat,
    nickname: bot.nickname,
    avatarId: bot.avatarId,
    ready: true,
    bot: true,
    joinedAt: t,
    connected: true,
    reservedFor,
  };
}

/** Bots para os assentos livres (sem olhar reservas). Usado pelo matchmaking. */
export function botPlayers(existing: Room['players'], count: number, t: number): Room['players'] {
  const used = new Set(Object.values(existing ?? {}).map((p) => p.nickname));
  const taken = new Set(Object.values(existing ?? {}).map((p) => p.seat));
  const out: Room['players'] = {};
  for (const s of SEATS) {
    if (Object.keys(out).length >= count) break;
    if (taken.has(s)) continue;
    const bot = botFor(s, used, t, null);
    out[bot.uid] = bot;
  }
  return out;
}

/**
 * Completa a mesa com IA. A vaga de um convidado que ainda não respondeu vira IA **com reserva**
 * (`reservedFor`): se ele entrar depois, assume o lugar num ponto seguro da partida.
 */
export function fillWithAi(room: Room, t: number): Room {
  const players = { ...(room.players ?? {}) };
  const invites = { ...(room.invites ?? {}) };
  const used = new Set(Object.values(players).map((p) => p.nickname));
  const taken = new Set(Object.values(players).map((p) => p.seat));
  const pendingBySeat = new Map(
    Object.values(invites)
      .filter((i) => i.status === 'PENDING' && i.seat >= 0)
      .map((i) => [i.seat, i] as const),
  );
  for (const s of SEATS) {
    if (taken.has(s)) continue;
    const pending = pendingBySeat.get(s);
    const bot = botFor(s, used, t, pending?.uid ?? null);
    players[bot.uid] = bot;
    if (pending) invites[pending.uid] = { ...pending, status: 'AI_FILLED', respondedAt: t };
  }
  return { ...room, players, invites, updatedAt: t };
}

/** A mesa pode começar: 4 assentos, cada um com exatamente um controlador pronto. */
export function canStart(room: Room): { ok: true } | { ok: false; reason: string } {
  const players = playersOf(room);
  const seats = new Set(players.map((p) => p.seat));
  if (players.length !== 4 || seats.size !== 4)
    return { ok: false, reason: 'A mesa precisa de 4 jogadores.' };
  if (!players.every((p) => p.ready || p.bot))
    return { ok: false, reason: 'Todos precisam estar prontos.' };
  return { ok: true };
}

/** Fecha a sala e invalida o que ainda estava pendente. */
export function closeRoom(room: Room, reason: RoomClosedReason, t: number): Room {
  const invites: Record<string, RoomSeatInvite> = {};
  for (const [uid, inv] of Object.entries(room.invites ?? {})) {
    const open = inv.status === 'PENDING' || inv.status === 'AI_FILLED';
    invites[uid] = open
      ? { ...inv, status: reason === 'expired' ? 'EXPIRED' : 'CANCELLED', respondedAt: t }
      : inv;
  }
  return { ...room, status: 'closed', closedReason: reason, invites, updatedAt: t };
}

export type AcceptOutcome =
  | { kind: 'joined'; room: Room }
  | { kind: 'already_inside' }
  | { kind: 'late'; seat: number }
  | { kind: 'error'; code: ErrorCode; message: string };

/**
 * Convidado aceitando. Idempotente: quem já está na sala só é devolvido para ela (push aberto duas
 * vezes, dois aparelhos). Com a partida em andamento, o convidado cuja vaga está com a IA entra
 * como "assumir depois" (`late`) — a troca em si acontece na partida, num ponto seguro.
 */
export function acceptInvite(
  room: Room,
  uid: string,
  profile: { nickname: string; avatarId: AvatarId },
  t: number,
): AcceptOutcome {
  if (room.players?.[uid]) return { kind: 'already_inside' };
  const invite = room.invites?.[uid];
  if (!invite) return { kind: 'error', code: 'INVITE_NOT_FOUND', message: MESSAGES.unavailable };
  if (room.status === 'closed') {
    if (room.closedReason === 'cancelled')
      return { kind: 'error', code: 'ROOM_CANCELLED', message: MESSAGES.cancelled };
    const message =
      room.closedReason === 'finished' || room.closedReason === 'abandoned'
        ? MESSAGES.finished
        : MESSAGES.unavailable;
    return { kind: 'error', code: 'INVITE_EXPIRED', message };
  }
  const lateOver = room.lateJoinUntil != null && t > room.lateJoinUntil;
  if (invite.status === 'CANCELLED' || invite.status === 'EXPIRED' || lateOver)
    return { kind: 'error', code: 'INVITE_EXPIRED', message: MESSAGES.unavailable };
  if (room.status === 'starting')
    return { kind: 'error', code: 'ROOM_STARTING', message: MESSAGES.starting };
  if (room.status === 'in_match') {
    const holder = playersOf(room).find((p) => p.seat === invite.seat);
    if (holder?.bot && holder.reservedFor === uid) return { kind: 'late', seat: invite.seat };
    return { kind: 'error', code: 'ROOM_STARTED', message: MESSAGES.started };
  }
  // Sala aguardando: a vaga reservada é dele, a não ser que tenha recusado e alguém a ocupado.
  const occupied = invite.seat < 0 || playersOf(room).some((p) => p.seat === invite.seat);
  let seat = invite.seat;
  if (occupied) {
    const other = freeSeat({
      ...room,
      invites: { ...room.invites, [uid]: { ...invite, status: 'DECLINED' } },
    });
    if (other === null) return { kind: 'error', code: 'ROOM_FULL', message: MESSAGES.full };
    seat = other;
  }
  const player: RoomPlayer = {
    uid,
    seat,
    ...profile,
    // Quem aceitou o convite já está pronto: o dono pode começar assim que todos entrarem.
    ready: true,
    bot: false,
    joinedAt: t,
    connected: true,
  };
  return {
    kind: 'joined',
    room: {
      ...room,
      players: { ...room.players, [uid]: player },
      invites: { ...room.invites, [uid]: { ...invite, seat, status: 'ACCEPTED', respondedAt: t } },
      updatedAt: t,
    },
  };
}

/** Convidado recusando antes de entrar: a reserva cai e o dono vê "Recusou" na hora. */
export function declineInvite(room: Room, uid: string, t: number): Room | null {
  const invite = room.invites?.[uid];
  if (!invite || invite.status !== 'PENDING') return null;
  return {
    ...room,
    invites: { ...room.invites, [uid]: { ...invite, status: 'DECLINED', respondedAt: t } },
    updatedAt: t,
  };
}
