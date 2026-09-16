import type { Room, RoomPlayer, RoomSeatInvite } from '@/domain/model/types';
import {
  closedMessage,
  formatCountdown,
  inviteChanges,
  lobbyRemaining,
  myLobbyState,
  seatState,
  seatsOpenForInvite,
} from '../lobbyState';
import {
  isSelectionLocked,
  MAX_INVITE_FRIENDS,
  selectionCounter,
  tablePreview,
  toggleFriend,
} from '../friendSelection';

const player = (uid: string, seat: number, over: Partial<RoomPlayer> = {}): RoomPlayer => ({
  uid,
  seat,
  nickname: uid,
  avatarId: 'joao',
  ready: true,
  bot: false,
  joinedAt: 0,
  connected: true,
  ...over,
});
const invite = (uid: string, seat: number, status: RoomSeatInvite['status']): RoomSeatInvite => ({
  uid,
  seat,
  nickname: uid,
  avatarId: 'maria',
  status,
  invitedAt: 0,
});

function room(over: Partial<Room> = {}): Room {
  return {
    code: 'ABC123',
    hostUid: 'will',
    status: 'waiting',
    maxPlayers: 4,
    players: { will: player('will', 0) },
    sessionId: null,
    createdAt: 0,
    updatedAt: 0,
    source: 'private',
    fillWithAi: 'on_timeout',
    inviteExpiresAt: 30_000,
    invites: {
      ana: invite('ana', 1, 'ACCEPTED'),
      bruno: invite('bruno', 2, 'PENDING'),
      carlos: invite('carlos', 3, 'DECLINED'),
    },
    ...over,
  };
}

describe('estado dos assentos no lobby', () => {
  it('mostra quem entrou, quem está sendo esperado e quem recusou', () => {
    const r = room({ players: { will: player('will', 0), ana: player('ana', 1) } });
    expect(seatState(r, 0)).toMatchObject({ kind: 'player', label: 'Pronto' });
    expect(seatState(r, 1)).toMatchObject({ kind: 'player', label: 'Entrou' });
    expect(seatState(r, 2)).toMatchObject({ kind: 'invite', label: 'Aguardando...' });
    expect(seatState(r, 3)).toMatchObject({ kind: 'invite', label: 'Recusou' });
  });

  it('IA, offline e vaga livre', () => {
    const r = room({
      invites: {},
      players: {
        will: player('will', 0, { connected: false }),
        bot: player('bot', 1, { bot: true }),
      },
    });
    expect(seatState(r, 0)).toMatchObject({ label: 'Offline' });
    expect(seatState(r, 1)).toMatchObject({ label: 'IA' });
    expect(seatState(r, 2)).toEqual({ kind: 'empty' });
  });

  it('vagas que o dono ainda pode preencher: livres e recusadas', () => {
    expect(seatsOpenForInvite(room())).toEqual([1, 3]);
  });
});

describe('contagem do lobby', () => {
  it('conta só com espera configurada e sala aguardando', () => {
    expect(lobbyRemaining(room(), 6_000)).toBe(24_000);
    expect(lobbyRemaining(room(), 90_000)).toBe(0);
    expect(lobbyRemaining(room({ fillWithAi: 'manual' }), 0)).toBeNull();
    expect(lobbyRemaining(room({ status: 'in_match' }), 0)).toBeNull();
  });

  it('formata como mm:ss', () => {
    expect(formatCountdown(24_000)).toBe('00:24');
    expect(formatCountdown(23_100)).toBe('00:24');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(65_000)).toBe('01:05');
  });
});

describe('avisos para o dono', () => {
  it('entrou e recusou viram um aviso cada, só na mudança', () => {
    const before = room({
      invites: { ana: invite('ana', 1, 'PENDING'), bruno: invite('bruno', 2, 'PENDING') },
    });
    const after = room({
      invites: { ana: invite('ana', 1, 'ACCEPTED'), bruno: invite('bruno', 2, 'DECLINED') },
    });
    expect(inviteChanges(before, after)).toEqual([
      { uid: 'ana', nickname: 'ana', kind: 'joined' },
      { uid: 'bruno', nickname: 'bruno', kind: 'declined' },
    ]);
    expect(inviteChanges(after, after)).toEqual([]);
    expect(inviteChanges(undefined, after)).toEqual([]);
  });
});

describe('situação de quem abre o lobby', () => {
  it('dentro, esperando a vaga da IA ou sem lugar', () => {
    const started = room({
      status: 'in_match',
      sessionId: 's1',
      players: {
        will: player('will', 0),
        ana: player('ana', 1),
        bot_2: player('bot_2', 2, { bot: true, reservedFor: 'bruno' }),
        bot_3: player('bot_3', 3, { bot: true }),
      },
    });
    expect(myLobbyState(started, 'ana')).toBe('inside');
    expect(myLobbyState(started, 'bruno')).toBe('late_pending');
    expect(myLobbyState(started, 'carlos')).toBe('started_without_me');
    expect(myLobbyState(room(), 'bruno')).toBe('outside');
  });

  it('mensagem de sala fechada conforme o motivo', () => {
    expect(closedMessage(room({ closedReason: 'cancelled' }), false)).toBe(
      'Esta sala foi cancelada.',
    );
    expect(closedMessage(room({ closedReason: 'finished' }), false)).toBe(
      'Esta partida já terminou.',
    );
    expect(closedMessage(room({ closedReason: 'expired' }), false)).toBe(
      'Este convite não está mais disponível.',
    );
  });
});

describe('seleção de amigos', () => {
  it('no máximo 3, mantendo a ordem da escolha', () => {
    let sel: string[] = [];
    for (const u of ['c', 'a', 'b']) sel = toggleFriend(sel, u).next;
    expect(sel).toEqual(['c', 'a', 'b']);
    const fourth = toggleFriend(sel, 'd');
    expect(fourth).toEqual({ next: ['c', 'a', 'b'], limited: true });
    expect(isSelectionLocked(sel, 'd')).toBe(true);
    expect(isSelectionLocked(sel, 'a')).toBe(false);
    sel = toggleFriend(sel, 'a').next;
    expect(sel).toEqual(['c', 'b']);
    expect(isSelectionLocked(sel, 'd')).toBe(false);
    expect(MAX_INVITE_FRIENDS).toBe(3);
  });

  it('textos do contador e da mesa', () => {
    expect(selectionCounter(2)).toBe('2 de 3 selecionados');
    expect(selectionCounter(1)).toBe('1 de 3 selecionado');
    expect(tablePreview(1)).toBe('Você + 1 · 2 vagas com IA');
    expect(tablePreview(3)).toBe('Mesa completa: 4 jogadores');
  });
});
