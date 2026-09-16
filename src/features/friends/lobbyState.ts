import type { Room, RoomPlayer, RoomSeatInvite } from '@/domain/model/types';

/**
 * Leitura da sala para a tela do lobby — pura, para ser testada sem renderizar.
 * A regra continua no servidor; aqui só se decide o que mostrar.
 */

export type SeatState =
  | {
      kind: 'player';
      player: RoomPlayer;
      label: 'IA' | 'Entrou' | 'Pronto' | 'Aguardando' | 'Offline';
    }
  | { kind: 'invite'; invite: RoomSeatInvite; label: 'Aguardando...' | 'Recusou' | 'Não respondeu' }
  | { kind: 'empty' };

const inviteOnSeat = (room: Room, seat: number) =>
  Object.values(room.invites ?? {}).find(
    (i) => i.seat === seat && i.status !== 'ACCEPTED' && i.status !== 'CANCELLED',
  );

export function seatState(room: Room, seat: number): SeatState {
  const player = Object.values(room.players ?? {}).find((p) => p.seat === seat);
  if (player) {
    const invited = Boolean(room.invites?.[player.uid]);
    const label = player.bot
      ? 'IA'
      : player.connected === false
        ? 'Offline'
        : invited
          ? 'Entrou'
          : player.ready
            ? 'Pronto'
            : 'Aguardando';
    return { kind: 'player', player, label };
  }
  const invite = inviteOnSeat(room, seat);
  if (invite) {
    const label =
      invite.status === 'DECLINED'
        ? 'Recusou'
        : invite.status === 'PENDING'
          ? 'Aguardando...'
          : 'Não respondeu';
    return { kind: 'invite', invite, label };
  }
  return { kind: 'empty' };
}

/** Tempo que falta da espera do lobby (ms), ou `null` quando a sala não tem espera. */
export function lobbyRemaining(room: Room, now: number): number | null {
  if (room.status !== 'waiting' || room.fillWithAi !== 'on_timeout' || !room.inviteExpiresAt)
    return null;
  return Math.max(0, room.inviteExpiresAt - now);
}

/** "00:24" */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface InviteChange {
  uid: string;
  nickname: string;
  kind: 'joined' | 'declined';
}

/** O que mudou nos convites desde o último snapshot — vira aviso curto para o dono. */
export function inviteChanges(prev: Room | null | undefined, next: Room): InviteChange[] {
  if (!prev) return [];
  const out: InviteChange[] = [];
  for (const inv of Object.values(next.invites ?? {})) {
    const before = prev.invites?.[inv.uid]?.status;
    if (before === inv.status) continue;
    if (inv.status === 'ACCEPTED' && before === 'PENDING')
      out.push({ uid: inv.uid, nickname: inv.nickname, kind: 'joined' });
    if (inv.status === 'DECLINED' && before === 'PENDING')
      out.push({ uid: inv.uid, nickname: inv.nickname, kind: 'declined' });
  }
  return out;
}

export type MyLobbyState =
  | 'inside'
  /** A partida começou com a IA na minha vaga: assumo no próximo ponto seguro. */
  | 'late_pending'
  | 'started_without_me'
  | 'outside';

export function myLobbyState(room: Room, uid: string | undefined): MyLobbyState {
  if (!uid) return 'outside';
  const me = room.players?.[uid];
  if (me && !me.bot) return 'inside';
  if (room.status !== 'in_match') return 'outside';
  const invite = room.invites?.[uid];
  const holder = Object.values(room.players ?? {}).find((p) => p.reservedFor === uid);
  if (invite && holder?.bot) return 'late_pending';
  return 'started_without_me';
}

export function closedMessage(room: Room, isHost: boolean): string {
  switch (room.closedReason) {
    case 'cancelled':
      return isHost ? 'Você cancelou a sala.' : 'Esta sala foi cancelada.';
    case 'finished':
    case 'abandoned':
      return 'Esta partida já terminou.';
    case 'expired':
      return 'Este convite não está mais disponível.';
    default:
      return 'O anfitrião fechou a sala.';
  }
}

/** Vagas que o dono ainda pode preencher chamando outro amigo. */
export function seatsOpenForInvite(room: Room): number[] {
  const out: number[] = [];
  for (const seat of [1, 2, 3]) {
    const s = seatState(room, seat);
    if (s.kind === 'empty' || (s.kind === 'invite' && s.invite.status === 'DECLINED'))
      out.push(seat);
  }
  return out;
}
