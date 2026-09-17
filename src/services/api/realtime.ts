import { io, type Socket } from 'socket.io-client';
import { getAppCheckToken } from '@/services/firebase/appCheck';
import { getIdToken } from '@/services/firebase/auth';
import { ApiError, friendlyMessage, type ApiErrorKind } from './client';
import { endpoints } from './config';

/**
 * Conexão de tempo real com o backend (Socket.IO, namespace `/rt`). Uma por app.
 *  - autentica com o Firebase ID Token a cada (re)conexão (nunca manda userId);
 *  - reconecta sozinha com backoff; ao voltar, reexecuta as assinaturas registradas
 *    (sala, partida, presença, liga) para o estado nunca ficar velho;
 *  - `emit` devolve os dados do ack ou lança `ApiError` no mesmo formato da API REST.
 */

type Handler = (payload: never) => void;
type Ack = { ok: true; data: unknown } | { ok: false; error: { code?: string; kind?: string; message?: string } };

const WAIT_CONNECTED_MS = 8_000;
const ACK_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_MS = 45 * 60_000;

class RealtimeClient {
  private socket: Socket | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();
  private readonly resubscribers = new Set<() => void>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private forceRefresh = false;
  private started = false;

  get connected(): boolean {
    return Boolean(this.socket?.connected);
  }

  start() {
    if (this.started) return;
    this.started = true;
    let url: string;
    try {
      url = endpoints().wsUrl;
    } catch {
      return;
    }
    const socket = io(`${url}/rt`, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 8_000,
      randomizationFactor: 0.5,
      timeout: 10_000,
      auth: (cb) => {
        const force = this.forceRefresh;
        this.forceRefresh = false;
        Promise.all([getIdToken(force), getAppCheckToken()])
          .then(([token, appCheck]) => cb({ token: token ?? '', ...(appCheck ? { appCheck } : {}) }))
          .catch(() => cb({ token: '' }));
      },
    });
    socket.on('connect', () => {
      this.emitConnection(true);
      this.resubscribers.forEach((fn) => {
        try {
          fn();
        } catch {
          // uma assinatura com erro não derruba as outras
        }
      });
    });
    socket.on('disconnect', (reason) => {
      this.emitConnection(false);
      // Desconexão pedida pelo servidor (token vencido): reconecta com token novo.
      if (reason === 'io server disconnect' && this.started) {
        this.forceRefresh = true;
        socket.connect();
      }
    });
    socket.on('connect_error', (err: Error & { data?: { code?: string } }) => {
      this.emitConnection(false);
      const code = err?.data?.code ?? err?.message;
      if (code === 'AUTH_TOKEN_EXPIRED' || code === 'AUTH_TOKEN_INVALID') this.forceRefresh = true;
    });
    socket.onAny((event: string, payload: unknown) => {
      this.handlers.get(event)?.forEach((h) => (h as (p: unknown) => void)(payload));
    });
    this.socket = socket;
    this.refreshTimer = setInterval(() => {
      void getIdToken(true)
        .then((token) => (token ? this.emit('session.refresh', { token }) : null))
        .catch(() => undefined);
    }, TOKEN_REFRESH_MS);
  }

  stop() {
    this.started = false;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.emitConnection(false);
  }

  /** Reconecta já (app voltou do segundo plano). */
  wake() {
    if (this.socket && !this.socket.connected) this.socket.connect();
  }

  private emitConnection(connected: boolean) {
    this.connectionListeners.forEach((l) => l(connected));
  }

  onConnection(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.connected);
    return () => this.connectionListeners.delete(listener);
  }

  on<T>(event: string, handler: (payload: T) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler);
    return () => set!.delete(handler as Handler);
  }

  /**
   * Executa `fn` agora (se conectado) e a cada reconexão. Devolve o cancelamento.
   * É assim que sala/partida/presença voltam sozinhas depois de uma queda.
   */
  whileConnected(fn: () => void): () => void {
    this.resubscribers.add(fn);
    if (this.connected) fn();
    return () => this.resubscribers.delete(fn);
  }

  private waitConnected(): Promise<Socket> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new ApiError('unavailable', friendlyMessage('unavailable'), 'SOCKET_NOT_STARTED'));
    if (socket.connected) return Promise.resolve(socket);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off('connect', ok);
        reject(new ApiError('unavailable', friendlyMessage('unavailable'), 'SOCKET_OFFLINE'));
      }, WAIT_CONNECTED_MS);
      const ok = () => {
        clearTimeout(timer);
        resolve(socket);
      };
      socket.once('connect', ok);
    });
  }

  async emit<T>(event: string, payload: unknown): Promise<T> {
    const socket = await this.waitConnected();
    let ack: Ack;
    try {
      ack = (await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload)) as Ack;
    } catch {
      throw new ApiError('deadline-exceeded', friendlyMessage('deadline-exceeded'), 'SOCKET_TIMEOUT');
    }
    if (ack?.ok) return ack.data as T;
    const kind = ((ack as { error?: { kind?: string } })?.error?.kind as ApiErrorKind | undefined) ?? 'unknown';
    const err = (ack as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(kind, friendlyMessage(kind, err?.message), err?.code ?? 'UNKNOWN');
  }
}

export const realtime = new RealtimeClient();

/** Nomes dos eventos (espelho de backend/src/realtime/events.ts). */
export const WS = {
  ready: 'session.ready',
  presenceChanged: 'presence.changed',
  onlineCount: 'stats.online',
  roomUpdated: 'room.updated',
  invitesUpdated: 'invites.updated',
  friendsChanged: 'friends.changed',
  friendRequestsChanged: 'friend-requests.changed',
  blocksChanged: 'blocks.changed',
  profileUpdated: 'user.profile',
  activeMatch: 'user.active-match',
  notification: 'user.notification',
  matchmakingUpdated: 'matchmaking.updated',
  leagueMembers: 'league.members',
  gameMeta: 'game.meta',
  gameView: 'game.view',
  gameResult: 'game.result',
} as const;
