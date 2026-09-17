import {
  acceptInvite,
  botPlayers,
  canStart,
  closeRoom,
  declineInvite,
  fillWithAi,
  freeSeat,
  openSeatForInvite,
} from '../../src/rooms/room-logic';
import type { Room, RoomSeatInvite } from '../../src/domain/model/types';

const T = 1_000_000;

function baseRoom(extra: Partial<Room> = {}): Room {
  return {
    code: 'ABC234',
    hostUid: 'host',
    status: 'waiting',
    maxPlayers: 4,
    players: {
      host: { uid: 'host', seat: 0, nickname: 'Dono', avatarId: 'joao', ready: true, bot: false, joinedAt: T },
    },
    sessionId: null,
    createdAt: T,
    updatedAt: T,
    source: 'private',
    ...extra,
  };
}

const invite = (uid: string, seat: number, status: RoomSeatInvite['status'] = 'PENDING'): RoomSeatInvite => ({
  uid,
  seat,
  nickname: uid,
  avatarId: 'maria',
  status,
  invitedAt: T,
  respondedAt: null,
});

describe('room-logic (regras puras da sala)', () => {
  it('assentos livres respeitam reservas; convite simples (-1) não reserva', () => {
    const room = baseRoom({ invites: { a: invite('a', 1), d: invite('d', -1) } });
    expect(freeSeat(room)).toBe(2);
    expect(openSeatForInvite(room)).toBe(2);
    expect(freeSeat(baseRoom({ invites: { a: invite('a', 1), b: invite('b', 2), c: invite('c', 3) } }))).toBeNull();
  });

  it('IA completa as vagas; vaga de convidado pendente fica reservada', () => {
    const room = fillWithAi(baseRoom({ invites: { a: invite('a', 1), b: invite('b', 2, 'DECLINED') } }), T + 1);
    const bots = Object.values(room.players).filter((p) => p.bot);
    expect(bots).toHaveLength(3);
    expect(bots.find((b) => b.seat === 1)!.reservedFor).toBe('a');
    expect(bots.find((b) => b.seat === 2)!.reservedFor).toBeNull();
    expect(room.invites!.a!.status).toBe('AI_FILLED');
    expect(new Set(bots.map((b) => b.nickname)).size).toBe(3);
    expect(canStart(room)).toEqual({ ok: true });
  });

  it('não começa sem 4 prontos', () => {
    expect(canStart(baseRoom())).toMatchObject({ ok: false });
    const room = baseRoom();
    room.players.x = { uid: 'x', seat: 1, nickname: 'x', avatarId: 'joao', ready: false, bot: false, joinedAt: T };
    Object.assign(room.players, botPlayers(room.players, 2, T));
    expect(canStart(room)).toEqual({ ok: false, reason: 'Todos precisam estar prontos.' });
  });

  it('aceite: idempotente, reserva própria, atrasado assume a IA, cheio/cancelado/expirado', () => {
    const profile = { nickname: 'A', avatarId: 'joao' as const };
    const room = baseRoom({ invites: { a: invite('a', 1) }, lateJoinUntil: T + 1000 });
    const joined = acceptInvite(room, 'a', profile, T + 1);
    expect(joined.kind).toBe('joined');
    if (joined.kind !== 'joined') throw new Error();
    expect(joined.room.players.a).toMatchObject({ seat: 1, ready: true });
    expect(acceptInvite(joined.room, 'a', profile, T + 2)).toEqual({ kind: 'already_inside' });

    const inMatch = { ...fillWithAi(room, T), status: 'in_match' as const, sessionId: 's' };
    expect(acceptInvite(inMatch, 'a', profile, T + 2)).toEqual({ kind: 'late', seat: 1 });
    expect(acceptInvite(inMatch, 'a', profile, T + 5000)).toMatchObject({ kind: 'error', code: 'INVITE_EXPIRED' });
    expect(acceptInvite(inMatch, 'zz', profile, T)).toMatchObject({ kind: 'error', code: 'INVITE_NOT_FOUND' });

    const cancelled = closeRoom(room, 'cancelled', T);
    expect(acceptInvite(cancelled, 'a', profile, T)).toMatchObject({ kind: 'error', code: 'ROOM_CANCELLED' });
    expect(cancelled.invites!.a!.status).toBe('CANCELLED');
    expect(closeRoom(room, 'expired', T).invites!.a!.status).toBe('EXPIRED');

    const starting = { ...room, status: 'starting' as const };
    expect(acceptInvite(starting, 'a', profile, T)).toMatchObject({ code: 'ROOM_STARTING' });
  });

  it('convite simples ocupa o primeiro assento livre', () => {
    const room = baseRoom({ invites: { d: invite('d', -1) } });
    const out = acceptInvite(room, 'd', { nickname: 'D', avatarId: 'galo' }, T);
    expect(out.kind).toBe('joined');
    if (out.kind === 'joined') expect(out.room.players.d!.seat).toBe(1);
  });

  it('recusa libera a vaga; recusar de novo não muda nada', () => {
    const room = baseRoom({ invites: { a: invite('a', 1) } });
    const declined = declineInvite(room, 'a', T)!;
    expect(declined.invites!.a!.status).toBe('DECLINED');
    expect(freeSeat(declined)).toBe(1);
    expect(declineInvite(declined, 'a', T)).toBeNull();
  });
});
