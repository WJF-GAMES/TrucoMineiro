import { ApiError, request, setFetch, toApiError } from '../client';
import { ApiConfigError, resolveEndpoints } from '../config';

const mockGetIdToken = jest.fn<Promise<string | null>, [boolean?]>();
jest.mock('@/services/firebase/auth', () => ({
  getIdToken: (force?: boolean) => mockGetIdToken(force),
}));
jest.mock('@/services/firebase/appCheck', () => ({ getAppCheckToken: () => Promise.resolve('ac-token') }));

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: (() => Promise<Response> | Response)[]) {
  const calls: Call[] = [];
  setFetch(((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('sem resposta');
    return Promise.resolve(next());
  }) as unknown as typeof fetch);
  return calls;
}

const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) }) as unknown as Response;

describe('config da API', () => {
  it('release exige URL https; dev usa o backend local', () => {
    expect(() => resolveEndpoints({ dev: false })).toThrow(ApiConfigError);
    expect(() => resolveEndpoints({ api: 'http://api.x', dev: false })).toThrow(/https/);
    expect(resolveEndpoints({ api: 'https://api.x/', dev: false })).toEqual({
      apiUrl: 'https://api.x',
      wsUrl: 'https://api.x',
    });
    expect(resolveEndpoints({ api: 'https://api.x', ws: 'https://ws.x', dev: false }).wsUrl).toBe('https://ws.x');
    expect(resolveEndpoints({ dev: true }).apiUrl).toMatch(/^http:\/\/(10\.0\.2\.2|localhost):11002$/);
  });
});

describe('apiClient', () => {
  beforeEach(() => {
    mockGetIdToken.mockReset();
    mockGetIdToken.mockResolvedValue('tok-1');
  });

  it('envia o ID Token e o App Check e devolve o `data`', async () => {
    const calls = fakeFetch([() => json(200, { data: { ok: true } })]);
    await expect(request('/v1/me/profile')).resolves.toEqual({ ok: true });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-1');
    expect(headers['x-firebase-appcheck']).toBe('ac-token');
    expect(calls[0]!.url).toMatch(/\/v1\/me\/profile$/);
  });

  it('token vencido: renova e repete uma vez', async () => {
    mockGetIdToken.mockImplementation(async (force) => (force ? 'tok-2' : 'tok-1'));
    const calls = fakeFetch([
      () => json(401, { error: { code: 'AUTH_TOKEN_EXPIRED', kind: 'unauthenticated', message: 'x' } }),
      () => json(200, { data: 7 }),
    ]);
    await expect(request('/v1/rooms', { method: 'POST', body: {} })).resolves.toBe(7);
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok-2');
  });

  it('erro de negócio vira ApiError com família e código', async () => {
    fakeFetch([() => json(429, { error: { code: 'ROOM_FULL', kind: 'resource-exhausted', message: 'A sala já está completa.' } })]);
    const err = (await request('/v1/rooms/ABC234/join', { method: 'POST' }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'resource-exhausted', errorCode: 'ROOM_FULL', status: 429, message: 'A sala já está completa.' });
  });

  it('GET repete em falha de rede; POST sem chave de idempotência não', async () => {
    const calls = fakeFetch([
      () => Promise.reject(new TypeError('Network request failed')),
      () => json(200, { data: 'ok' }),
    ]);
    await expect(request('/v1/friends')).resolves.toBe('ok');
    expect(calls).toHaveLength(2);

    const postCalls = fakeFetch([() => Promise.reject(new TypeError('Network request failed'))]);
    const err = (await request('/v1/rooms', { method: 'POST', body: {} }).catch((e) => e)) as ApiError;
    expect(err.code).toBe('unavailable');
    expect(postCalls).toHaveLength(1);
  });

  it('POST com Idempotency-Key é repetível', async () => {
    const calls = fakeFetch([() => json(503, { error: { code: 'SERVICE_UNAVAILABLE', kind: 'unavailable' } }), () => json(200, { data: 1 })]);
    await expect(request('/v1/rooms', { method: 'POST', body: {}, idempotencyKey: 'k-12345678' })).resolves.toBe(1);
    expect((calls[0]!.init.headers as Record<string, string>)['idempotency-key']).toBe('k-12345678');
  });

  it('com Idempotency-Key, CONFLICT (ainda processando) é repetido; sem chave, não', async () => {
    const conflict = () => json(409, { error: { code: 'CONFLICT', kind: 'aborted' } });
    fakeFetch([conflict, () => json(200, { data: 'ok' })]);
    await expect(request('/v1/rooms', { method: 'POST', body: {}, idempotencyKey: 'k-87654321' })).resolves.toBe('ok');
    const calls = fakeFetch([conflict, () => json(200, { data: 'ok' })]);
    await expect(request('/v1/rooms', { method: 'POST', body: {} })).rejects.toMatchObject({ errorCode: 'CONFLICT' });
    expect(calls).toHaveLength(1);
  });

  it('sem sessão não chama o servidor', async () => {
    mockGetIdToken.mockResolvedValue(null);
    const calls = fakeFetch([]);
    await expect(request('/v1/me/profile')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(calls).toHaveLength(0);
  });

  it('mensagens amigáveis para falhas internas', () => {
    expect(toApiError(500, null).message).toBe('Algo deu errado. Tente novamente.');
    expect(toApiError(503, { error: { kind: 'unavailable' } }).message).toMatch(/conexão/);
  });
});
