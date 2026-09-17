import type { Profile } from '@/domain/model/types';
import type { FriendEntry } from '../useFriends';
import type { AgendaMatchResult, MatchedContact } from '../contactsMatch';
import { buildFriendsDirectory } from '../friendsDirectory';

const friend = (id: string, nickname = id): FriendEntry => ({
  profile: { id, nickname, avatarId: 'joao' } as Profile,
  presence: null,
});

const match = (over: Partial<MatchedContact>): MatchedContact => ({
  contactId: 'c',
  contactName: 'Contato',
  uid: 'u',
  nickname: 'u',
  avatarId: 'joao',
  level: 1,
  relation: 'none',
  ...over,
});

const agenda: AgendaMatchResult = {
  matched: [
    match({ contactId: 'c1', contactName: 'Zé da Padaria', uid: 'ze', relation: 'friend' }),
    match({ contactId: 'c2', contactName: 'Ana', uid: 'ana', nickname: 'aninha' }),
    match({ contactId: 'c3', contactName: 'Ana Trabalho', uid: 'ana', nickname: 'aninha' }),
    match({ contactId: 'c5', contactName: 'Eu mesmo', uid: 'me', relation: 'self' }),
    // Já é amigo, mas o índice ainda não sabia (relação desatualizada): vira a linha do amigo.
    match({ contactId: 'c6', contactName: 'Bia Vizinha', uid: 'bia', relation: 'request_sent' }),
  ],
  unmatched: [
    { contactId: 'c4', contactName: 'Tio Beto' },
    { contactId: 'c7', contactName: 'Joana' },
  ],
};

const keys = (list: { key: string }[]) => list.map((e) => e.key);

describe('buildFriendsDirectory', () => {
  it('une amigos e agenda sem repetir ninguém, na ordem amigos → jogadores → convites', () => {
    const d = buildFriendsDirectory([friend('ze'), friend('bia')], agenda);
    expect(keys(d.people)).toEqual(['f-ze', 'f-bia', 'm-ana']);
    expect(keys(d.invites)).toEqual(['i-c4', 'i-c7']);
    expect(d.total).toBe(5);
  });

  it('amigo que também é contato leva o nome da agenda', () => {
    const d = buildFriendsDirectory([friend('ze'), friend('bia')], agenda);
    expect(d.people[0]).toMatchObject({ kind: 'friend', contactName: 'Zé da Padaria' });
    expect(d.people[1]).toMatchObject({ kind: 'friend', contactName: 'Bia Vizinha' });
  });

  it('o próprio usuário nunca aparece', () => {
    const d = buildFriendsDirectory([], agenda);
    expect(keys(d.people)).not.toContain('m-me');
  });

  it('sem agenda, só os amigos', () => {
    const d = buildFriendsDirectory([friend('ze')], null);
    expect(keys(d.people)).toEqual(['f-ze']);
    expect(d.invites).toEqual([]);
  });

  it('busca por apelido, por nome da agenda e sem acento', () => {
    const list = [friend('ze', 'Zezinho'), friend('bia')];
    expect(keys(buildFriendsDirectory(list, agenda, 'padaria').people)).toEqual(['f-ze']);
    expect(keys(buildFriendsDirectory(list, agenda, 'ZEZI').people)).toEqual(['f-ze']);
    expect(keys(buildFriendsDirectory(list, agenda, 'aninha').people)).toEqual(['m-ana']);
    const beto = buildFriendsDirectory(list, agenda, 'béto');
    expect(keys(beto.people)).toEqual([]);
    expect(keys(beto.invites)).toEqual(['i-c4']);
  });
});

describe('buildFriendsDirectory — seções e conexão automática', () => {
  const withPresence = (id: string, state: 'online' | 'in_match' | 'offline'): FriendEntry => ({
    profile: { id, nickname: id, avatarId: 'joao' } as Profile,
    presence: { state, lastChanged: 0 } as FriendEntry['presence'],
  });

  it('separa ONLINE, AMIGOS e CONVIDAR, na ordem da tela', () => {
    const friends = [withPresence('ana', 'online'), withPresence('rui', 'in_match'), friend('ze')];
    const d = buildFriendsDirectory(friends, agenda, '', {
      friendIds: new Set(['ana', 'rui', 'ze']),
    });
    expect(keys(d.online)).toEqual(['f-ana', 'f-rui']);
    expect(keys(d.offline)).toEqual(['f-ze']);
    // Bia só tem solicitação enviada: continua em "já jogam" até alguém aceitar.
    expect(keys(d.players)).toEqual(['m-bia']);
    expect(keys(d.invites)).toEqual(['i-c4', 'i-c7']);
    expect(keys(d.people)).toEqual(['f-ana', 'f-rui', 'f-ze', 'm-bia']);
  });

  it('contato conectado automaticamente aparece só em Amigos, nunca em "já jogam"', () => {
    const auto: AgendaMatchResult = {
      matched: [
        match({ contactId: 'c1', contactName: 'João Pedreiro', uid: 'joao', relation: 'friend' }),
      ],
      unmatched: [],
    };
    const d = buildFriendsDirectory([friend('joao', 'João Silva')], auto, '', {
      friendIds: new Set(['joao']),
    });
    expect(keys(d.people)).toEqual(['f-joao']);
    expect(d.players).toEqual([]);
    // Apelido público na linha; o nome da agenda fica como detalhe.
    expect(d.offline[0]).toMatchObject({ contactName: 'João Pedreiro' });
    expect(d.offline[0]!.entry.profile.nickname).toBe('João Silva');
  });

  it('amizade recém-criada com perfil ainda carregando não pisca como "adicionar"', () => {
    const auto: AgendaMatchResult = {
      matched: [match({ contactId: 'c1', uid: 'novo', relation: 'friend' })],
      unmatched: [],
    };
    const d = buildFriendsDirectory([], auto, '', { friendIds: new Set(['novo']) });
    expect(d.people).toEqual([]);
    const loading = buildFriendsDirectory([], auto, '', { friendIds: null });
    expect(loading.people).toEqual([]);
  });

  it('cache dizendo "amigo" para quem não é mais amigo: volta para "já jogam" em vez de sumir', () => {
    const stale: AgendaMatchResult = {
      matched: [match({ contactId: 'c1', contactName: 'Zé', uid: 'ze', relation: 'friend' })],
      unmatched: [],
    };
    const d = buildFriendsDirectory([], stale, '', { friendIds: new Set() });
    expect(keys(d.players)).toEqual(['m-ze']);
    expect(d.players[0]!.contact.relation).toBe('none');
  });

  it('removido manualmente (servidor devolve "none") fica em "já jogam" com a opção de adicionar', () => {
    const removed: AgendaMatchResult = {
      matched: [match({ contactId: 'c1', uid: 'bia', relation: 'none' })],
      unmatched: [],
    };
    const d = buildFriendsDirectory([], removed, '', { friendIds: new Set() });
    expect(d.players).toMatchObject([{ contact: { uid: 'bia', relation: 'none' } }]);
  });

  it('bloqueado não aparece em lugar nenhum', () => {
    const d = buildFriendsDirectory([friend('ze')], agenda, '', {
      friendIds: new Set(['ze']),
      blockedIds: new Set(['ze', 'ana', 'bia']),
    });
    expect(keys(d.people)).toEqual([]);
  });

  it('o mesmo jogador em dois contatos vira uma linha só', () => {
    const twice: AgendaMatchResult = {
      matched: [
        match({ contactId: 'c1', contactName: 'Ana', uid: 'ana', relation: 'friend' }),
        match({ contactId: 'c2', contactName: 'Ana Trabalho', uid: 'ana', relation: 'friend' }),
      ],
      unmatched: [],
    };
    const d = buildFriendsDirectory([friend('ana')], twice, '', { friendIds: new Set(['ana']) });
    expect(keys(d.people)).toEqual(['f-ana']);
    expect(d.offline[0]!.contactName).toBe('Ana');
  });

  it('amigo manual fora da agenda continua na lista', () => {
    const d = buildFriendsDirectory([friend('manual')], agenda, '', {
      friendIds: new Set(['manual']),
    });
    expect(keys(d.offline)).toContain('f-manual');
  });
});
