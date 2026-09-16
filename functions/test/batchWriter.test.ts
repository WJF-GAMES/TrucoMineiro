/**
 * O limite de 500 operações por lote é do Firestore de produção — o **emulador não o aplica**
 * (verificado: um lote de 870 escritas passa direto no emulador e falha em produção). Ou seja,
 * nenhum teste contra o emulador prova que o fatiamento acontece; este prova, contando os
 * `commit()`.
 *
 * Isso importa para `deleteAccount`: uma conta com muitas amizades passa de 500 documentos
 * (cada amizade são dois) e, num lote único, o `commit()` falharia inteiro — depois de a saída
 * da liga e o índice de telefone já terem sido feitos, deixando a conta pela metade.
 */
const commits: number[] = [];
let pending = 0;

const fakeBatch = () => {
  pending = 0;
  return {
    set: () => void pending++,
    delete: () => void pending++,
    commit: async () => {
      commits.push(pending);
      pending = 0;
    },
  };
};

jest.mock('../src/lib/admin', () => ({
  db: { batch: () => fakeBatch() },
  rtdb: {},
  auth: {},
  messaging: {},
  REGION: 'southamerica-east1',
  DB_TRIGGER_REGION: 'us-central1',
  IS_EMULATOR: true,
  ENFORCE_APP_CHECK: false,
  now: () => Date.now(),
}));

import { BatchWriter } from '../src/lib/batchWriter';

const LIMIT = 450;
const ref = { id: 'x' } as unknown as FirebaseFirestore.DocumentReference;

describe('BatchWriter', () => {
  beforeEach(() => {
    commits.length = 0;
  });

  it('não comita nada antes do flush quando cabe num lote só', async () => {
    const w = new BatchWriter();
    for (let i = 0; i < 10; i++) w.delete(ref);
    expect(commits).toHaveLength(0);
    await w.flush();
    expect(commits).toEqual([10]);
  });

  it('fatia em vários lotes e nenhum passa do limite do Firestore', async () => {
    const w = new BatchWriter();
    const total = 1000;
    for (let i = 0; i < total; i++) w.delete(ref);
    await w.flush();

    expect(commits.length).toBeGreaterThan(1);
    for (const size of commits) expect(size).toBeLessThanOrEqual(LIMIT);
    expect(commits.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('o caso que motivou o corte: 400 amizades (800 docs) + histórico', async () => {
    const w = new BatchWriter();
    for (let i = 0; i < 400; i++) {
      w.delete(ref); // friendships/{uid}/friends/{f}
      w.delete(ref); // friendships/{f}/friends/{uid}
    }
    for (let i = 0; i < 60; i++) w.delete(ref); // leagueHistory/{uid}/weeks/*
    await w.flush();

    // Num `db.batch()` único isso seria uma chamada de 860 operações — recusada em produção.
    expect(commits.every((size) => size <= LIMIT)).toBe(true);
    expect(commits.reduce((a, b) => a + b, 0)).toBe(860);
  });

  it('flush sem escritas pendentes não chama commit', async () => {
    const w = new BatchWriter();
    await w.flush();
    expect(commits).toHaveLength(0);
  });

  it('pode ser reutilizado depois do flush', async () => {
    const w = new BatchWriter();
    w.delete(ref);
    await w.flush();
    w.delete(ref);
    w.delete(ref);
    await w.flush();
    expect(commits).toEqual([1, 2]);
  });
});
