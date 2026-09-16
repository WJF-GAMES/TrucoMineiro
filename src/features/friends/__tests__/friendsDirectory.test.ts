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
