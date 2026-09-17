import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import { rooms, S2C } from './events';

type EventName = (typeof S2C)[keyof typeof S2C];

/**
 * Emissão de eventos para os clientes. Os serviços de domínio só conhecem este serviço; o gateway
 * registra o namespace no boot. Com `REDIS_URL` o adapter do Socket.IO entrega em todas as
 * instâncias (`socketsJoin`/`emit` são distribuídos).
 */
@Injectable()
export class RealtimeService {
  private nsp: Namespace | null = null;

  attach(nsp: Namespace) {
    this.nsp = nsp;
  }

  get attached(): boolean {
    return this.nsp !== null;
  }

  toUser(userId: string, event: EventName, payload: unknown) {
    this.nsp?.to(rooms.user(userId)).emit(event, payload);
  }

  toUsers(userIds: string[], event: EventName, payload: unknown) {
    if (!this.nsp || userIds.length === 0) return;
    this.nsp.to(userIds.map(rooms.user)).emit(event, payload);
  }

  toRoom(code: string, event: EventName, payload: unknown) {
    this.nsp?.to(rooms.room(code)).emit(event, payload);
  }

  toMatch(matchId: string, event: EventName, payload: unknown) {
    this.nsp?.to(rooms.match(matchId)).emit(event, payload);
  }

  toMatchSeat(matchId: string, seat: number, event: EventName, payload: unknown) {
    this.nsp?.to(rooms.matchSeat(matchId, seat)).emit(event, payload);
  }

  toPresenceWatchers(firebaseUid: string, event: EventName, payload: unknown) {
    this.nsp?.to(rooms.presence(firebaseUid)).emit(event, payload);
  }

  toLeague(groupId: string, event: EventName, payload: unknown) {
    this.nsp?.to(rooms.league(groupId)).emit(event, payload);
  }

  broadcast(event: EventName, payload: unknown) {
    this.nsp?.emit(event, payload);
  }

  /** Faz todos os sockets de um usuário (em qualquer instância) entrarem numa sala. */
  joinUser(userId: string, room: string) {
    this.nsp?.in(rooms.user(userId)).socketsJoin(room);
  }

  leaveUser(userId: string, room: string) {
    this.nsp?.in(rooms.user(userId)).socketsLeave(room);
  }

  /** Esvazia uma sala de sockets (ex.: assento que mudou de dono). */
  clearRoom(room: string) {
    this.nsp?.in(room).socketsLeave(room);
  }

  /**
   * Ids dos sockets numa sala em TODAS as instâncias (com Redis; sem Redis, só os locais).
   * O adapter serializa `socket.data` (só valores simples — ver o gateway). Em falha (Redis
   * lento/fora), cai para os locais.
   */
  async socketIdsIn(room: string): Promise<Set<string>> {
    if (!this.nsp) return new Set();
    try {
      // `fetchSockets` é o que o adapter Redis distribui (o `allSockets` dele só olha a instância).
      const sockets = await this.nsp.in(room).fetchSockets();
      return new Set(sockets.map((s) => s.id));
    } catch {
      return new Set(this.nsp.adapter.rooms.get(room) ?? []);
    }
  }

  /** Avisa as outras instâncias (sem efeito com uma instância só). */
  serverSideEmit(event: string, payload: unknown) {
    try {
      this.nsp?.serverSideEmit(event, payload);
    } catch {
      /* adapter em memória não distribui: nada a fazer */
    }
  }

  onServerEvent(event: string, handler: (payload: unknown) => void) {
    this.nsp?.on(event, handler);
  }

  localSocketCount(): number {
    return this.nsp?.sockets.size ?? 0;
  }
}
