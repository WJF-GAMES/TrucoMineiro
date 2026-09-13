import {
  agendaFingerprint,
  chunk,
  filterAgenda,
  mergeMatches,
  normalizeAgenda,
  type DeviceContact,
} from '../contactsMatch';
import type { ContactMatch } from '@/domain/model/types';

const contact = (id: string, name: string, ...phones: string[]): DeviceContact => ({
  id,
  name,
  phones,
});

const match = (index: number, over: Partial<ContactMatch> = {}): ContactMatch => ({
  index,
  uid: `u${index}`,
  nickname: `Nick${index}`,
  avatarId: 'joao',
  level: 3,
  relation: 'none',
  ...over,
});

describe('normalizeAgenda', () => {
  it('converte todo formato da agenda para o mesmo E.164', () => {
    const agenda = normalizeAgenda([
      contact('1', 'João', '(61) 9.9628-9726'),
      contact('2', 'Maria', '61996289726'),
      contact('3', 'Zé', '+55 61 99628-9726'),
    ]);
    // Três grafias do MESMO número: um único número sobe para o servidor.
    expect(agenda.phones).toEqual(['+5561996289726']);
    expect(agenda.ownersByPhoneIndex[0]).toEqual(['1', '2', '3']);
    expect(agenda.contacts).toHaveLength(3);
  });

  it('deduplica os vários números de um mesmo contato', () => {
    const agenda = normalizeAgenda([
      contact('1', 'João', '(61) 9.9628-9726', '61996289726', '(61) 3224-5566'),
    ]);
    expect(agenda.contacts[0]!.phones).toEqual(['+5561996289726', '+556132245566']);
    expect(agenda.phones).toHaveLength(2);
  });

  it('descarta contatos sem telefone válido', () => {
    const agenda = normalizeAgenda([
      contact('1', 'Sem número'),
      contact('2', 'Lixo', 'não é telefone', '123'),
      contact('3', 'Boa', '61996289726'),
    ]);
    expect(agenda.contacts.map((c) => c.id)).toEqual(['3']);
    expect(agenda.skipped).toBe(2);
  });

  it('respeita o DDI salvo no contato em vez do país da conta', () => {
    const agenda = normalizeAgenda(
      [contact('1', 'Tuga', '+351 912 345 678'), contact('2', 'BR', '61996289726')],
      'BR',
    );
    expect(agenda.phones).toContain('+351912345678');
    expect(agenda.phones).toContain('+5561996289726');
  });

  it('exclui o próprio número do usuário', () => {
    const agenda = normalizeAgenda(
      [contact('1', 'Eu mesmo', '61996289726'), contact('2', 'Outro', '61987654321')],
      'BR',
      ['+5561996289726'],
    );
    expect(agenda.phones).toEqual(['+5561987654321']);
    expect(agenda.contacts.map((c) => c.id)).toEqual(['2']);
  });

  it('usa um rótulo genérico quando o contato não tem nome', () => {
    const agenda = normalizeAgenda([contact('1', '   ', '61996289726')]);
    expect(agenda.contacts[0]!.name).toBe('Contato');
  });

  it.each([0, 1, 100, 1_000])('normaliza uma agenda de %i contatos', (size) => {
    const contacts = Array.from({ length: size }, (_, i) =>
      contact(`c${i}`, `Pessoa ${i}`, `619${String(90000000 + i)}`),
    );
    const agenda = normalizeAgenda(contacts);
    expect(agenda.contacts).toHaveLength(size);
    expect(new Set(agenda.phones).size).toBe(agenda.phones.length);
  });

  it('aguenta 10.000 contatos com números repetidos em tempo razoável', () => {
    const contacts = Array.from({ length: 10_000 }, (_, i) =>
      // Metade dos contatos repete o número do anterior, em outra formatação.
      contact(
        `c${i}`,
        `Pessoa ${i}`,
        i % 2 === 0 ? `619${String(90000000 + i)}` : `(61) 9${String(90000000 + i - 1)}`,
      ),
    );
    const started = Date.now();
    const agenda = normalizeAgenda(contacts);
    expect(agenda.contacts).toHaveLength(10_000);
    expect(agenda.phones).toHaveLength(5_000); // dedupe entre contatos funcionou
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe('chunk', () => {
  it('fatia em lotes do tamanho pedido', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 200)).toEqual([]);
  });

  it('nunca gera mais de um lote por 200 números', () => {
    const phones = Array.from({ length: 1_001 }, (_, i) => `+55619${i}`);
    expect(chunk(phones, 200)).toHaveLength(6);
  });

  it('rejeita tamanho inválido em vez de entrar em laço infinito', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe('mergeMatches', () => {
  const agenda = normalizeAgenda([
    contact('joao', 'João Faculdade', '61996289726'),
    contact('maria', 'Maria Vizinha', '61987654321'),
    contact('ze', 'Zé do Bar', '61911112222'),
  ]);

  it('sem nenhum match, todo mundo cai em "ainda não joga"', () => {
    const result = mergeMatches(agenda, []);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched.map((u) => u.contactName)).toEqual([
      'João Faculdade',
      'Maria Vizinha',
      'Zé do Bar',
    ]);
  });

  it('mostra o nome da agenda junto do apelido do jogo', () => {
    const result = mergeMatches(agenda, [match(0, { nickname: 'JoaoTruco' })]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toMatchObject({
      contactName: 'João Faculdade',
      nickname: 'JoaoTruco',
    });
    expect(result.unmatched).toHaveLength(2);
  });

  it('nunca devolve telefone nenhum no resultado', () => {
    const result = mergeMatches(agenda, [match(0), match(1)]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('+55');
    expect(serialized).not.toContain('996289726');
  });

  it('esconde o próprio usuário quando ele está na própria agenda', () => {
    const result = mergeMatches(agenda, [match(0, { relation: 'self' })]);
    expect(result.matched).toHaveLength(0);
    // E também não aparece como "convide para jogar": ele já joga.
    expect(result.unmatched.map((u) => u.contactId)).toEqual(['maria', 'ze']);
  });

  it('ordena por utilidade: quem dá para adicionar primeiro, amigos por último', () => {
    const result = mergeMatches(agenda, [
      match(0, { relation: 'friend' }),
      match(1, { relation: 'none' }),
      match(2, { relation: 'request_received' }),
    ]);
    expect(result.matched.map((m) => m.relation)).toEqual(['none', 'request_received', 'friend']);
  });

  it('não duplica quando dois números do mesmo contato apontam para o mesmo jogador', () => {
    const twoNumbers = normalizeAgenda([contact('1', 'João', '61996289726', '61987654321')]);
    const result = mergeMatches(twoNumbers, [
      match(0, { uid: 'mesmo' }),
      match(1, { uid: 'mesmo' }),
    ]);
    expect(result.matched).toHaveLength(1);
  });

  it('lista os dois contatos quando eles compartilham o mesmo número', () => {
    const shared = normalizeAgenda([
      contact('casa', 'Telefone de casa', '61996289726'),
      contact('pai', 'Pai', '61996289726'),
    ]);
    const result = mergeMatches(shared, [match(0, { uid: 'mesmo' })]);
    expect(result.matched.map((m) => m.contactId).sort()).toEqual(['casa', 'pai']);
    expect(result.unmatched).toHaveLength(0);
  });

  it('ignora um índice fora da faixa em vez de quebrar', () => {
    expect(() => mergeMatches(agenda, [match(99)])).not.toThrow();
    expect(mergeMatches(agenda, [match(99)]).matched).toHaveLength(0);
  });
});

describe('agendaFingerprint', () => {
  it('não depende da ordem dos números', () => {
    expect(agendaFingerprint(['+551', '+552'])).toBe(agendaFingerprint(['+552', '+551']));
  });

  it('muda quando um contato entra ou sai', () => {
    const before = agendaFingerprint(['+551', '+552']);
    expect(agendaFingerprint(['+551', '+552', '+553'])).not.toBe(before);
    expect(agendaFingerprint(['+551'])).not.toBe(before);
  });

  it('não permite reconstruir os números', () => {
    const print = agendaFingerprint(['+5561996289726']);
    expect(print).not.toContain('996289726');
    expect(print.length).toBeLessThan(20);
  });

  it('separa os números para que agrupamentos diferentes não colidam', () => {
    expect(agendaFingerprint(['1', '23'])).not.toBe(agendaFingerprint(['12', '3']));
  });
});

describe('filterAgenda', () => {
  const result = mergeMatches(
    normalizeAgenda([
      contact('1', 'João Faculdade', '61996289726'),
      contact('2', 'Maria Vizinha', '61987654321'),
    ]),
    [match(0, { nickname: 'ReiDoTruco' })],
  );

  it('filtra pelo nome da agenda e pelo apelido do jogo', () => {
    expect(filterAgenda(result, 'joão').matched).toHaveLength(1);
    expect(filterAgenda(result, 'reidotruco').matched).toHaveLength(1);
    expect(filterAgenda(result, 'maria').unmatched).toHaveLength(1);
    expect(filterAgenda(result, 'ninguém').matched).toHaveLength(0);
  });

  it('devolve tudo quando a busca está vazia', () => {
    expect(filterAgenda(result, '   ')).toBe(result);
  });
});
