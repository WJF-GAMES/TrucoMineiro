import { MATCH_BATCH_LIMIT, phoneHash, validateMatchPayload } from '../src/contacts';
import { requestId } from '../src/social';

/**
 * Cobre as duas garantias do diretório de telefones que não dependem do Firestore:
 * o hash (o que realmente fica guardado) e a validação da entrada (o que trava enumeração).
 */

const e164 = (n: number) => `+55619${String(90000000 + n)}`;

describe('phoneHash', () => {
  it('é determinístico: o mesmo número sempre dá o mesmo hash', () => {
    expect(phoneHash('+5561996289726')).toBe(phoneHash('+5561996289726'));
  });

  it('números diferentes dão hashes diferentes', () => {
    const hashes = new Set(Array.from({ length: 500 }, (_, i) => phoneHash(e164(i))));
    expect(hashes.size).toBe(500);
  });

  it('não deixa o telefone aparecer no que é gravado', () => {
    const hash = phoneHash('+5561996289726');
    expect(hash).not.toContain('996289726');
    expect(hash).not.toContain('55');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('é sensível ao número inteiro, não só ao final', () => {
    expect(phoneHash('+5561996289726')).not.toBe(phoneHash('+5511996289726'));
  });
});

describe('validateMatchPayload', () => {
  const payload = (phones: unknown) => ({ phones });

  it('aceita um lote no tamanho máximo', () => {
    const phones = Array.from({ length: MATCH_BATCH_LIMIT }, (_, i) => e164(i));
    expect(validateMatchPayload(payload(phones)).phones).toHaveLength(MATCH_BATCH_LIMIT);
  });

  it('recusa lote acima do limite — é o teto que impede varrer a base', () => {
    const phones = Array.from({ length: MATCH_BATCH_LIMIT + 1 }, (_, i) => e164(i));
    expect(() => validateMatchPayload(payload(phones))).toThrow(/no máximo/);
  });

  it('aceita lista vazia', () => {
    expect(validateMatchPayload(payload([])).phones).toEqual([]);
  });

  it.each([
    ['sem "+"', '5561996289726'],
    ['com máscara', '+55 (61) 99628-9726'],
    ['começando com zero', '+0561996289726'],
    ['curto demais', '+5561'],
    ['longo demais', '+5561996289726123456'],
    ['letras', '+55abcdefghij'],
    ['vazio', ''],
  ])('recusa telefone %s', (_label, phone) => {
    expect(() => validateMatchPayload(payload([phone]))).toThrow();
  });

  it.each([
    ['não-array', 'não é lista'],
    ['ausente', undefined],
    ['objeto', { 0: '+5561996289726' }],
  ])('recusa payload %s', (_label, phones) => {
    expect(() => validateMatchPayload(payload(phones))).toThrow();
  });

  it('recusa item que não é string', () => {
    expect(() => validateMatchPayload(payload([5561996289726]))).toThrow();
    expect(() => validateMatchPayload(payload([null]))).toThrow();
  });
});

describe('requestId', () => {
  it('é determinístico por sentido — duas chamadas simultâneas gravam o mesmo documento', () => {
    expect(requestId('a', 'b')).toBe(requestId('a', 'b'));
  });

  it('distingue A→B de B→A, para as duas solicitações não se sobrescreverem', () => {
    expect(requestId('a', 'b')).not.toBe(requestId('b', 'a'));
  });
});
