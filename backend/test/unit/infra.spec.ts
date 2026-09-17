import { HttpException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { loadConfig } from '../../src/config/env';
import { redact } from '../../src/common/logger';
import { toErrorBody } from '../../src/common/http-exception.filter';
import { AppError, ERROR_CODES, KIND_STATUS } from '../../src/common/errors';
import { parseAction, replayAiMatch } from '../../src/game/action-parser';
import { signWebhook } from '../../src/webhooks/webhooks.service';
import { isSafeSwapPoint } from '../../src/game/game.service';
import { newStoredState, readStoredState, timerKeyOf, trimState } from '../../src/game/stored-state';
import { buildView } from '../../src/game/game-views';
import { applyAction, createMatch, skipCeremony } from '../../src/domain/game';
import { countryFromPhone, NICK_RE } from '../../src/users/users.service';
import { toDomainPresence } from '../../src/presence/presence.service';
import { KeyedMutex } from '../../src/common/keyed-mutex';

const base = { DATABASE_URL: 'postgresql://x' } as NodeJS.ProcessEnv;

describe('config: falha no boot quando segredo crítico falta', () => {
  it('produção exige segredos fortes e proíbe modo de teste/emulador', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/CONTACTS_PEPPER|FIREBASE_PROJECT_ID/);
    const strong = {
      ...base,
      NODE_ENV: 'production',
      FIREBASE_PROJECT_ID: 'p',
      CONTACTS_PEPPER: 'x'.repeat(32),
      ADMIN_SECRET: 'y'.repeat(32),
    } as NodeJS.ProcessEnv;
    expect(loadConfig(strong).nodeEnv).toBe('production');
    expect(() => loadConfig({ ...strong, AUTH_MODE: 'test' })).toThrow(/proibido/);
    expect(() => loadConfig({ ...strong, FIREBASE_AUTH_EMULATOR_HOST: 'x:1' })).toThrow(/emulador|EMULATOR/i);
    expect(() => loadConfig({ ...strong, CONTACTS_PEPPER: 'curto' })).toThrow(/32/);
    expect(() => loadConfig({ ...strong, JOBS_MODE: 'external' })).toThrow(/WEBHOOK_SCHEDULER_SECRET/);
    expect(() => loadConfig({ ...strong, JOBS_MODE: 'external', WEBHOOK_SCHEDULER_SECRET: 'curto' })).toThrow(/32/);
    const oidc = { WEBHOOK_SCHEDULER_OIDC_AUDIENCE: 'https://api', WEBHOOK_SCHEDULER_SERVICE_ACCOUNT: 'sa@p.iam' };
    expect(loadConfig({ ...strong, JOBS_MODE: 'external', ...oidc }).schedulerOidc).toEqual({
      audience: 'https://api',
      serviceAccount: 'sa@p.iam',
    });
    expect(() => loadConfig({ ...strong, WEBHOOK_SCHEDULER_OIDC_AUDIENCE: 'https://api' })).toThrow(/juntos/);
    expect(() => loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('prazos vêm do ambiente em segundos', () => {
    const c = loadConfig({ ...base, PRIVATE_ROOM_WAIT_SECONDS: '12', DISCONNECT_AI_GRACE_SECONDS: 'abc' });
    expect(c.lobbyWaitMs).toBe(12_000);
    expect(c.disconnectAiGraceMs).toBe(8_000);
    expect(c.pushEnabled).toBe(true);
  });
});

describe('logger: não vaza dado sensível', () => {
  it('redige token, telefone, estado secreto e Bearer', () => {
    const out = redact({
      authorization: 'Bearer abc.def',
      message: 'ligou para +5531999998888 com Bearer xyz.123',
      phones: ['+5531999998888'],
      state: { hands: [[1]] },
      nested: { idToken: 'secret', ok: 1 },
    }) as Record<string, unknown>;
    const text = JSON.stringify(out);
    expect(text).not.toContain('999998888');
    expect(text).not.toContain('xyz.123');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('hands');
    expect(text).toContain('+***8888');
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
  });
});

describe('erros padronizados', () => {
  it('todo código tem status HTTP', () => {
    for (const kind of Object.values(ERROR_CODES)) expect(KIND_STATUS[kind]).toBeGreaterThanOrEqual(400);
  });

  it('mapeia AppError, HttpException, banco fora e erro desconhecido sem vazar detalhes', () => {
    expect(toErrorBody(new AppError('ROOM_FULL', 'cheia'))).toMatchObject({
      status: 429,
      body: { error: { code: 'ROOM_FULL', kind: 'resource-exhausted', message: 'cheia' } },
    });
    expect(toErrorBody(new NotFoundException()).status).toBe(404);
    expect(toErrorBody(new HttpException('x', 413)).body.error).toMatchObject({ code: 'VALIDATION_FAILED', kind: 'invalid-argument' });
    expect(toErrorBody(new HttpException('x', 405)).body.error.code).toBe('NOT_FOUND');
    expect(toErrorBody(new HttpException('x', 403)).body.error).toMatchObject({ code: 'FORBIDDEN', kind: 'permission-denied' });
    expect(toErrorBody(new HttpException('x', 429)).body.error.code).toBe('RATE_LIMITED');
    const db = new Prisma.PrismaClientKnownRequestError('timeout do pool', { code: 'P2024', clientVersion: '6' });
    expect(toErrorBody(db)).toMatchObject({ status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE' } } });
    const boom = toErrorBody(new Error('SELECT * FROM senha'));
    expect(boom.status).toBe(500);
    expect(JSON.stringify(boom.body)).not.toContain('SELECT');
  });
});

describe('ações e replay da partida contra IA', () => {
  it('valida a forma da intenção (o motor valida a regra)', () => {
    expect(parseAction({ type: 'PLAY_CARD', seat: 2, cardId: '7C' })).toEqual({ type: 'PLAY_CARD', seat: 2, cardId: '7C' });
    expect(parseAction({ type: 'CUT', seat: 1, depth: 'low' })).toEqual({ type: 'CUT', seat: 1, depth: 'low' });
    expect(parseAction({ type: 'RUN', seat: 3, extra: 1 })).toEqual({ type: 'RUN', seat: 3 });
    for (const bad of [
      null,
      { type: 'WIN', seat: 0 },
      { type: 'RUN', seat: 4 },
      { type: 'PLAY_CARD', seat: 0, cardId: '8C' },
      { type: 'PLAY_CARD', seat: 0 },
      { type: 'CUT', seat: 0, depth: 'fundo' },
    ])
      expect(() => parseAction(bad)).toThrow(AppError);
  });

  it('replay recusa partida longa demais', () => {
    expect(() =>
      replayAiMatch({ seed: 1, aiSeed: 1, difficulty: 'easy', actions: Array.from({ length: 2001 }, () => ({ type: 'RUN', seat: 0 })) }),
    ).toThrow(/grande/);
  });
});

describe('estado privado e views', () => {
  it('estado guardado não perde nada no JSON e a view não leva mãos alheias', () => {
    const s = newStoredState(99, 5, 1000);
    const roundTrip = readStoredState(JSON.parse(JSON.stringify(trimState(s))))!;
    expect(roundTrip.hand.deck).toHaveLength(40);
    expect(roundTrip.timerKey).toBe(timerKeyOf(s));
    const dealt = { ...roundTrip, ...skipCeremony(roundTrip) };
    const view = buildView('m', dealt, 0, [], { startedAt: null, deadlineAt: null }, 1);
    expect(JSON.stringify(view)).not.toContain('"deck"');
    expect(JSON.stringify(view)).not.toContain('"hands"');
    expect(view.myCards).toHaveLength(3);
    expect(readStoredState(null)).toBeNull();
  });

  it('ponto seguro de troca: só no começo da mão', () => {
    const state = createMatch(5);
    expect(isSafeSwapPoint(state)).toBe(true);
    const dealt = skipCeremony(state);
    expect(isSafeSwapPoint(dealt)).toBe(true);
    const seat = dealt.hand.turnSeat;
    const played = applyAction(dealt, { type: 'PLAY_CARD', seat, cardId: `${dealt.hand.hands[seat]![0]!.rank}${{ paus: 'P', copas: 'C', espadas: 'E', ouros: 'O' }[dealt.hand.hands[seat]![0]!.suit]}` });
    expect(isSafeSwapPoint(played)).toBe(false);
  });
});

describe('utilidades', () => {
  it('assinatura de webhook é determinística e depende do corpo e do id', () => {
    expect(signWebhook('s', 1, 'e1', '{}')).toBe(signWebhook('s', 1, 'e1', '{}'));
    expect(signWebhook('s', 1, 'e1', '{}')).not.toBe(signWebhook('s', 1, 'e1', '{"a":1}'));
    expect(signWebhook('s', 1, 'e1', '{}')).not.toBe(signWebhook('s', 1, 'e2', '{}'));
    expect(signWebhook('s', 1, 'e1', '{}')).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it('país pelo DDI e regra do apelido', () => {
    expect(countryFromPhone('+5531999990000')).toBe('BR');
    expect(countryFromPhone('+351912345678')).toBe('PT');
    expect(countryFromPhone('+595981000000')).toBe('PY');
    expect(countryFromPhone(null)).toBe('BR');
    expect(NICK_RE.test('Zé do Truco')).toBe(true);
    expect(NICK_RE.test('ab')).toBe(false);
    expect(NICK_RE.test('<script>')).toBe(false);
  });

  it('presença do app: três estados simples + detalhe', () => {
    expect(toDomainPresence('IN_MATCH', new Date(5), 'm')).toMatchObject({ state: 'in_match', sessionId: 'm', lastChanged: 5 });
    expect(toDomainPresence('BACKGROUND', null, null)).toMatchObject({ state: 'online', detail: 'BACKGROUND' });
    expect(toDomainPresence(undefined, undefined, undefined).state).toBe('offline');
  });
});

describe('KeyedMutex', () => {
  it('serializa por chave, não trava chaves diferentes e sobrevive a erro', async () => {
    const m = new KeyedMutex();
    const order: string[] = [];
    const task = (id: string, ms: number, fail = false) => async () => {
      order.push(`start:${id}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end:${id}`);
      if (fail) throw new Error(id);
      return id;
    };
    const results = await Promise.allSettled([
      m.run('a', task('a1', 20, true)),
      m.run('a', task('a2', 1)),
      m.run('b', task('b1', 1)),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
    expect(order.indexOf('start:a2')).toBeGreaterThan(order.indexOf('end:a1'));
    expect(order.indexOf('end:b1')).toBeLessThan(order.indexOf('end:a1'));
    expect(m.size).toBe(0);
  });
});
