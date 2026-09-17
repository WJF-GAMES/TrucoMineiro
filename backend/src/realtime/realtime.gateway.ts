import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { RealtimeService } from './realtime.service';
import { C2S, rooms as wsRooms, S2C, SERVER_EVENTS, WS_NAMESPACE } from './events';
import { PresenceService, CLIENT_STATES, ClientPresenceState } from '../presence/presence.service';
import { RoomsService } from '../rooms/rooms.service';
import { GameService } from '../game/game.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { LeaguesService } from '../leagues/leagues.service';
import { UserLookupService } from '../users/user-lookup.service';
import { parseAction } from '../game/action-parser';
import { AppError } from '../common/errors';
import { toErrorBody } from '../common/http-exception.filter';
import { moduleLogger } from '../common/logger';
import { MetricsService } from '../metrics/metrics.service';
import { AppConfig, CONFIG } from '../config/env';
import { ROOM_CODE_RE, UID_RE } from '../common/dto';
import type { GameAction } from '../domain/game';

const log = moduleLogger('ws');

/**
 * `socket.data` só com valores simples: o adapter Redis serializa esse objeto quando outra
 * instância consulta os sockets (`fetchSockets`). Estado interno fica em `SocketState`.
 */
interface SocketData {
  userId: string;
  uid: string;
  tokenExpiresAt: number;
}

interface SocketState {
  matches: Map<string, number | null>;
  presence: Set<string>;
  bucket: { tokens: number; at: number };
}

type AckReply = { ok: true; data: unknown } | { ok: false; error: unknown };
type AuthedSocket = Socket & { data: SocketData };

const BUCKET_CAPACITY = 60;
const BUCKET_REFILL_PER_SEC = 30;
const MAX_PRESENCE_SUBSCRIPTIONS = 300;
const TOKEN_GRACE_MS = 5 * 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown, re: RegExp, name: string): string {
  if (typeof v !== 'string') throw new AppError('VALIDATION_FAILED', `${name} inválido.`);
  const s = name === 'code' ? v.trim().toUpperCase() : v;
  if (!re.test(s)) throw new AppError('VALIDATION_FAILED', `${name} inválido.`);
  return s;
}

function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new AppError('VALIDATION_FAILED', 'payload inválido.');
  return v as Record<string, unknown>;
}

const matchIdOf = (body: unknown) => str(obj(body).matchId, UUID_RE, 'matchId');
const codeOf = (body: unknown) => str(obj(body).code, ROOM_CODE_RE, 'code');
const actionIdOf = (body: unknown) => {
  const v = obj(body).actionId;
  if (typeof v !== 'string' || v.length < 4 || v.length > 120)
    throw new AppError('VALIDATION_FAILED', 'actionId inválido.');
  return v;
};

/**
 * Gateway único (namespace `/rt`). Autentica no handshake com o Firebase ID Token (`auth.token`),
 * nunca confia em userId enviado pelo cliente. Eventos com ack; erros no mesmo formato da API REST.
 */
@WebSocketGateway({
  namespace: WS_NAMESPACE,
  cors: { origin: true, credentials: false },
  pingInterval: 20_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 64_000,
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger('RealtimeGateway');
  private sweep: NodeJS.Timeout | null = null;
  private nsp: Namespace | null = null;
  private readonly states = new WeakMap<Socket, SocketState>();

  constructor(
    private readonly auth: AuthService,
    private readonly firebase: FirebaseAdminService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
    private readonly roomsService: RoomsService,
    private readonly game: GameService,
    private readonly matchmaking: MatchmakingService,
    private readonly leagues: LeaguesService,
    private readonly users: UserLookupService,
    private readonly metrics: MetricsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  afterInit(nsp: Namespace) {
    this.nsp = nsp;
    this.realtime.attach(nsp);
    this.metrics.gauge('ws_connected_sockets', () => nsp.sockets.size);
    this.realtime.onServerEvent(SERVER_EVENTS.presenceReclaim, (payload) => {
      const userId = (payload as { userId?: unknown } | null)?.userId;
      if (typeof userId === 'string') void this.presence.reclaim(userId).catch(() => undefined);
    });
    nsp.use((socket, next) => {
      void this.authenticate(socket as AuthedSocket)
        .then(() => next())
        .catch((e: unknown) => {
          const { body } = toErrorBody(e);
          const err = new Error(body.error.code) as Error & { data?: unknown };
          err.data = body.error;
          this.metrics.inc('ws_auth_failures_total', { code: body.error.code });
          next(err);
        });
    });
    // Sockets com token vencido há muito tempo (sem `session.refresh`) são desconectados; o
    // cliente reconecta com um token novo.
    this.sweep = setInterval(() => {
      const t = Date.now();
      for (const s of nsp.sockets.values()) {
        const data = (s as AuthedSocket).data;
        if (data?.tokenExpiresAt && data.tokenExpiresAt + TOKEN_GRACE_MS < t) {
          s.emit(S2C.error, { code: 'AUTH_TOKEN_EXPIRED', message: 'Sessão expirada.' });
          s.disconnect(true);
        }
      }
    }, 60_000);
    this.sweep.unref();
  }

  onModuleDestroy() {
    if (this.sweep) clearInterval(this.sweep);
  }

  private st(socket: Socket): SocketState {
    let state = this.states.get(socket);
    if (!state) {
      state = {
        matches: new Map(),
        presence: new Set(),
        bucket: { tokens: BUCKET_CAPACITY, at: Date.now() },
      };
      this.states.set(socket, state);
    }
    return state;
  }

  private async authenticate(socket: AuthedSocket) {
    const raw = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const header = socket.handshake.headers.authorization;
    const token = typeof raw === 'string' ? raw : header ? this.auth.extractBearer(header) : '';
    if (!token) throw new AppError('AUTH_TOKEN_MISSING', 'Faça login para continuar.');
    const identity = await this.firebase.verifyIdToken(token);
    const appCheck = (socket.handshake.auth as { appCheck?: unknown } | undefined)?.appCheck;
    await this.firebase.verifyAppCheck(typeof appCheck === 'string' ? appCheck : undefined);
    const user = await this.auth.resolve({
      firebaseUid: identity.firebaseUid,
      phoneNumber: identity.phoneNumber,
    });
    if (!user) throw new AppError('USER_NOT_FOUND', 'Conta não encontrada. Entre novamente.');
    socket.data = { userId: user.id, uid: user.uid, tokenExpiresAt: identity.expiresAt };
    this.states.set(socket, {
      matches: new Map(),
      presence: new Set(),
      bucket: { tokens: BUCKET_CAPACITY, at: Date.now() },
    });
  }

  async handleConnection(socket: AuthedSocket) {
    if (!socket.data?.userId) {
      socket.disconnect(true);
      return;
    }
    const { userId, uid } = socket.data;
    await socket.join(wsRooms.user(userId));
    this.metrics.inc('ws_connections_total');
    try {
      await this.presence.connected(userId, uid);
      const [active, count] = await Promise.all([
        this.game.activeMatchOf(userId),
        this.presence.onlineCount(),
      ]);
      socket.emit(S2C.ready, {
        uid,
        serverTime: Date.now(),
        activeMatch: active,
        onlineCount: count,
      });
    } catch (e) {
      log.warn('connection_setup_failed', { error: (e as Error).message });
      socket.emit(S2C.ready, { uid, serverTime: Date.now(), activeMatch: null, onlineCount: 0 });
    }
  }

  async handleDisconnect(socket: AuthedSocket) {
    const data = socket.data;
    if (!data?.userId) return;
    this.metrics.inc('ws_disconnections_total');
    try {
      for (const matchId of this.st(socket).matches.keys()) {
        if (!(await this.userHasOtherSocketIn(data.userId, socket.id, matchId))) {
          await this.game.setConnected(data.userId, matchId, false).catch(() => undefined);
        }
      }
      const elsewhere = await this.realtime.socketIdsIn(wsRooms.user(data.userId));
      elsewhere.delete(socket.id);
      await this.presence.disconnected(data.userId, data.uid, elsewhere.size > 0);
      if (elsewhere.size === 0) this.cancelSearchIfStillGone(data.userId);
    } catch (e) {
      log.warn('disconnect_cleanup_failed', { error: (e as Error).message });
    }
  }

  /**
   * App fechado no meio da busca de partida: depois de uma carência (queda rápida de rede não
   * conta), sem nenhum socket em nenhuma instância, a busca é cancelada.
   */
  private cancelSearchIfStillGone(userId: string) {
    const timer = setTimeout(() => {
      void (async () => {
        const ids = await this.realtime.socketIdsIn(wsRooms.user(userId));
        if (ids.size === 0) await this.matchmaking.cancelForDisconnectedUser(userId);
      })().catch((e: Error) =>
        log.warn('matchmaking_disconnect_cancel_failed', { error: e.message }),
      );
    }, this.config.matchmakingDisconnectGraceMs);
    timer.unref();
  }

  /** Outro socket do mesmo usuário vendo a partida, em qualquer instância. */
  private async userHasOtherSocketIn(
    userId: string,
    socketId: string,
    matchId: string,
  ): Promise<boolean> {
    const ids = await this.realtime.socketIdsIn(wsRooms.userMatch(userId, matchId));
    ids.delete(socketId);
    return ids.size > 0;
  }

  /** Executa o handler com rate limit e métricas; o retorno vira o ack do Socket.IO. */
  private async run(
    socket: AuthedSocket,
    event: string,
    fn: () => Promise<unknown>,
  ): Promise<AckReply> {
    const b = this.st(socket).bucket;
    const t = Date.now();
    b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + ((t - b.at) / 1000) * BUCKET_REFILL_PER_SEC);
    b.at = t;
    if (b.tokens < 1) {
      this.metrics.inc('ws_rate_limited_total');
      return {
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          kind: 'resource-exhausted',
          message: 'Muitas ações seguidas.',
        },
      };
    }
    b.tokens -= 1;
    const started = Date.now();
    try {
      const data = await fn();
      return { ok: true, data: data ?? null };
    } catch (e) {
      const { status, body } = toErrorBody(e);
      if (status >= 500) log.error('ws_handler_failed', { event, error: (e as Error).message });
      return { ok: false, error: body.error };
    } finally {
      this.metrics.observe('ws_event_duration_ms', Date.now() - started, { event });
    }
  }

  // --- Sessão / presença --------------------------------------------------------------------

  @SubscribeMessage(C2S.ping)
  ping(): AckReply {
    return { ok: true, data: { serverTime: Date.now() } };
  }

  @SubscribeMessage(C2S.sessionRefresh)
  refresh(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.sessionRefresh, async () => {
      const token = obj(body).token;
      if (typeof token !== 'string') throw new AppError('AUTH_TOKEN_MISSING', 'Token ausente.');
      const identity = await this.firebase.verifyIdToken(token);
      if (identity.firebaseUid !== s.data.uid)
        throw new AppError('AUTH_TOKEN_INVALID', 'Token de outra conta.');
      s.data.tokenExpiresAt = identity.expiresAt;
      return { expiresAt: identity.expiresAt };
    });
  }

  @SubscribeMessage(C2S.presenceSet)
  presenceSet(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.presenceSet, async () => {
      const o = obj(body);
      const state = String(o.state ?? '').toUpperCase();
      if (!(CLIENT_STATES as readonly string[]).includes(state))
        throw new AppError('VALIDATION_FAILED', 'state inválido.');
      const matchId = typeof o.matchId === 'string' && UUID_RE.test(o.matchId) ? o.matchId : null;
      await this.presence.set(s.data.userId, s.data.uid, state as ClientPresenceState, matchId);
      return { state };
    });
  }

  @SubscribeMessage(C2S.presenceSubscribe)
  presenceSubscribe(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.presenceSubscribe, async () => {
      const uids = obj(body).uids;
      if (!Array.isArray(uids) || uids.length > 200)
        throw new AppError('VALIDATION_FAILED', 'uids inválido.');
      const valid = uids.filter((u): u is string => typeof u === 'string' && UID_RE.test(u));
      if (this.st(s).presence.size + valid.length > MAX_PRESENCE_SUBSCRIPTIONS)
        throw new AppError('RATE_LIMITED', 'Assinaturas de presença demais.');
      const { presence, allowed } = await this.presence.visibleFor(s.data.userId, valid);
      for (const uid of allowed) {
        this.st(s).presence.add(uid);
        await s.join(wsRooms.presence(uid));
      }
      return { presence };
    });
  }

  @SubscribeMessage(C2S.presenceUnsubscribe)
  presenceUnsubscribe(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.presenceUnsubscribe, async () => {
      const uids = obj(body).uids;
      if (!Array.isArray(uids)) throw new AppError('VALIDATION_FAILED', 'uids inválido.');
      for (const uid of uids) {
        if (typeof uid !== 'string') continue;
        this.st(s).presence.delete(uid);
        await s.leave(wsRooms.presence(uid));
      }
      return { ok: true };
    });
  }

  // --- Salas --------------------------------------------------------------------------------

  @SubscribeMessage(C2S.roomSubscribe)
  roomSubscribe(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.roomSubscribe, async () => {
      const code = codeOf(body);
      await s.join(wsRooms.room(code));
      return { room: await this.roomsService.findRoom(code) };
    });
  }

  @SubscribeMessage(C2S.roomUnsubscribe)
  roomUnsubscribe(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.roomUnsubscribe, async () => {
      await s.leave(wsRooms.room(codeOf(body)));
      return { ok: true };
    });
  }

  @SubscribeMessage(C2S.roomSync)
  roomSync(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.roomSync, async () => ({
      room: await this.roomsService.findRoom(codeOf(body)),
    }));
  }

  @SubscribeMessage(C2S.roomJoin)
  roomJoin(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.roomJoin, async () => {
      const code = codeOf(body);
      const res = await this.roomsService.joinRoom(s.data.userId, s.data.uid, code);
      await s.join(wsRooms.room(code));
      return res;
    });
  }

  @SubscribeMessage(C2S.roomLeave)
  roomLeave(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.roomLeave, async () => {
      const code = codeOf(body);
      const res = await this.roomsService.leaveRoom(s.data.userId, s.data.uid, code);
      await s.leave(wsRooms.room(code));
      return res;
    });
  }

  @SubscribeMessage(C2S.roomReady)
  roomReady(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.roomReady, async () =>
      this.roomsService.setReady(s.data.uid, codeOf(body), obj(body).ready === true),
    );
  }

  @SubscribeMessage(C2S.roomInvite)
  roomInvite(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.roomInvite, async () =>
      this.roomsService.inviteToRoom(
        s.data.userId,
        s.data.uid,
        codeOf(body),
        str(obj(body).friendUid, UID_RE, 'friendUid'),
      ),
    );
  }

  @SubscribeMessage(C2S.roomInviteAccept)
  inviteAccept(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.roomInviteAccept, async () => {
      const code = codeOf(body);
      const res = await this.roomsService.respondInvite(s.data.userId, s.data.uid, code, true);
      await s.join(wsRooms.room(code));
      return res;
    });
  }

  @SubscribeMessage(C2S.roomInviteDecline)
  inviteDecline(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.roomInviteDecline, async () =>
      this.roomsService.respondInvite(s.data.userId, s.data.uid, codeOf(body), false),
    );
  }

  // --- Liga / matchmaking -------------------------------------------------------------------

  @SubscribeMessage(C2S.leagueSubscribe)
  leagueSubscribe(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.leagueSubscribe, async () => {
      const groupId = str(obj(body).groupId, /^\d{4}-W\d{2}__[a-z_]{3,24}__\d{3}$/, 'groupId');
      await s.join(wsRooms.league(groupId));
      return { groupId, members: await this.leagues.groupMembers(groupId, s.data.userId) };
    });
  }

  @SubscribeMessage(C2S.leagueUnsubscribe)
  leagueUnsubscribe(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.leagueUnsubscribe, async () => {
      const groupId = obj(body).groupId;
      if (typeof groupId === 'string') await s.leave(wsRooms.league(groupId));
      return { ok: true };
    });
  }

  @SubscribeMessage(C2S.matchmakingSubscribe)
  matchmakingSubscribe(@ConnectedSocket() s: AuthedSocket, @MessageBody() _b: unknown) {
    return this.run(s, C2S.matchmakingSubscribe, async () => ({
      entry: await this.matchmaking.get(s.data.userId),
    }));
  }

  // --- Partida ------------------------------------------------------------------------------

  private async joinMatchRooms(s: AuthedSocket, matchId: string, seat: number | null) {
    const previous = this.st(s).matches.get(matchId);
    if (previous !== undefined && previous !== null && previous !== seat)
      await s.leave(wsRooms.matchSeat(matchId, previous));
    await s.join([wsRooms.match(matchId), wsRooms.userMatch(s.data.userId, matchId)]);
    if (seat !== null) await s.join(wsRooms.matchSeat(matchId, seat));
    this.st(s).matches.set(matchId, seat);
  }

  private async gameJoin(s: AuthedSocket, body: unknown) {
    const matchId = matchIdOf(body);
    const snap = await this.game.join(s.data.userId, matchId);
    await this.joinMatchRooms(s, matchId, snap.seat);
    if (snap.seat !== null && snap.meta.status === 'playing')
      await this.presence
        .set(s.data.userId, s.data.uid, 'IN_MATCH', matchId)
        .catch(() => undefined);
    return snap;
  }

  @SubscribeMessage(C2S.gameJoin)
  gameJoinEvent(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameJoin, () => this.gameJoin(s, body));
  }

  @SubscribeMessage(C2S.gameReconnect)
  gameReconnect(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameReconnect, () => this.gameJoin(s, body));
  }

  @SubscribeMessage(C2S.gameSync)
  gameSync(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameSync, async () => {
      const matchId = matchIdOf(body);
      const snap = await this.game.snapshot(s.data.userId, matchId);
      if (this.st(s).matches.get(matchId) !== snap.seat)
        await this.joinMatchRooms(s, matchId, snap.seat);
      return snap;
    });
  }

  @SubscribeMessage(C2S.gameLeaveView)
  gameLeaveView(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameLeaveView, async () => {
      const matchId = matchIdOf(body);
      const seat = this.st(s).matches.get(matchId);
      if (seat !== undefined && seat !== null) await s.leave(wsRooms.matchSeat(matchId, seat));
      await s.leave(wsRooms.match(matchId));
      await s.leave(wsRooms.userMatch(s.data.userId, matchId));
      this.st(s).matches.delete(matchId);
      if (!(await this.userHasOtherSocketIn(s.data.userId, s.id, matchId)))
        await this.presence.set(s.data.userId, s.data.uid, 'ONLINE', null).catch(() => undefined);
      return { ok: true };
    });
  }

  private async seatOf(s: AuthedSocket, matchId: string): Promise<number> {
    const known = this.st(s).matches.get(matchId);
    if (known !== undefined && known !== null) return known;
    const seat = await this.game.seatFor(s.data.userId, matchId);
    if (seat === null) throw new AppError('NOT_IN_MATCH', 'Você não está nessa partida.');
    return seat;
  }

  private async submit(
    s: AuthedSocket,
    body: unknown,
    build: (seat: number, o: Record<string, unknown>) => GameAction,
  ) {
    const o = obj(body);
    const matchId = matchIdOf(o);
    const actionId = actionIdOf(o);
    const seat = await this.seatOf(s, matchId);
    const action = parseAction(build(seat, o));
    return this.game.submitAction(s.data.userId, matchId, action, actionId);
  }

  @SubscribeMessage(C2S.gameAction)
  gameAction(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameAction, () =>
      this.submit(s, body, (_seat, o) => o.action as GameAction),
    );
  }

  @SubscribeMessage(C2S.gamePlayCard)
  playCard(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gamePlayCard, () =>
      this.submit(
        s,
        body,
        (seat, o) => ({ type: 'PLAY_CARD', seat, cardId: String(o.cardId) }) as GameAction,
      ),
    );
  }

  @SubscribeMessage(C2S.gamePlayCoveredCard)
  playCovered(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gamePlayCoveredCard, () =>
      this.submit(
        s,
        body,
        (seat, o) => ({ type: 'PLAY_CARD_COVERED', seat, cardId: String(o.cardId) }) as GameAction,
      ),
    );
  }

  @SubscribeMessage(C2S.gameTrucoRequest)
  trucoRequest(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameTrucoRequest, () =>
      this.submit(s, body, (seat) => ({ type: 'REQUEST_TRUCO', seat }) as GameAction),
    );
  }

  @SubscribeMessage(C2S.gameTrucoRespond)
  trucoRespond(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameTrucoRespond, () =>
      this.submit(s, body, (seat, o) => {
        const map: Record<string, GameAction['type']> = {
          ACCEPT: 'ACCEPT_TRUCO',
          RAISE: 'RAISE',
          RUN: 'RUN',
        };
        const type = map[String(o.response).toUpperCase()] ?? String(o.response);
        return { type, seat } as GameAction;
      }),
    );
  }

  @SubscribeMessage(C2S.gameShuffle)
  shuffle(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameShuffle, () =>
      this.submit(
        s,
        body,
        (seat, o) =>
          ({ type: o.finish === true ? 'FINISH_SHUFFLE' : 'SHUFFLE', seat }) as GameAction,
      ),
    );
  }

  @SubscribeMessage(C2S.gameCut)
  cut(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameCut, () =>
      this.submit(s, body, (seat, o) =>
        o.finish === true
          ? ({ type: 'FINISH_CUT', seat } as GameAction)
          : ({
              type: 'CUT',
              seat,
              ...(o.depth === undefined ? {} : { depth: o.depth }),
            } as GameAction),
      ),
    );
  }

  @SubscribeMessage(C2S.gameHandOfEleven)
  handOfEleven(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameHandOfEleven, () =>
      this.submit(
        s,
        body,
        (seat, o) =>
          ({
            type: o.accept === true ? 'ACCEPT_MAO_DE_ONZE' : 'DECLINE_MAO_DE_ONZE',
            seat,
          }) as GameAction,
      ),
    );
  }

  @SubscribeMessage(C2S.gameAdvanceBots)
  advanceBots(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameAdvanceBots, () =>
      this.game.requestBotStep(s.data.userId, matchIdOf(body)),
    );
  }

  @SubscribeMessage(C2S.gameAbandon)
  abandon(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameAbandon, async () => {
      const matchId = matchIdOf(body);
      const res = await this.game.abandon(s.data.userId, matchId);
      this.st(s).matches.delete(matchId);
      // Quem desistiu não conta mais como "conectado" nessa partida.
      await s.leave(wsRooms.userMatch(s.data.userId, matchId));
      await this.presence.set(s.data.userId, s.data.uid, 'ONLINE', null).catch(() => undefined);
      return res;
    });
  }

  @SubscribeMessage(C2S.gameClaimSeat)
  claimSeat(@ConnectedSocket() s: AuthedSocket, @MessageBody() body: unknown) {
    return this.run(s, C2S.gameClaimSeat, async () => {
      const matchId = matchIdOf(body);
      const res = await this.game.claimSeat(s.data.userId, matchId);
      if (res.status === 'seated') await this.gameJoin(s, { matchId });
      return res;
    });
  }
}
