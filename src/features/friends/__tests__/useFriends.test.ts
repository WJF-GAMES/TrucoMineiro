import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useFriends } from '../useFriends';
import type { Presence, Profile } from '@/domain/model/types';

type Row = { uid: string; since: number; source: string; profile: Profile; presence: Presence };
let emitRows: ((rows: Row[]) => void) | null = null;
let emitPresence: ((p: Presence | null) => void) | null = null;

jest.mock('@/services/api', () => ({
  subscribeFriendRows: (_uid: string, cb: (rows: Row[]) => void) => {
    emitRows = cb;
    return () => undefined;
  },
  subscribeBlockedUsers: () => () => undefined,
  subscribeIncomingRequests: () => () => undefined,
  subscribeOutgoingRequests: () => () => undefined,
  subscribePresence: (_uid: string, cb: (p: Presence | null) => void) => {
    emitPresence = cb;
    return () => undefined;
  },
}));

const row = (uid: string, nickname: string, state: Presence['state']): Row => ({
  uid,
  since: 1,
  source: 'manual',
  profile: { id: uid, nickname } as Profile,
  presence: { state, lastChanged: 1 },
});

describe('useFriends', () => {
  it('lista amigos com perfil e presença numa leitura só, ordenados por presença', async () => {
    const { result } = await renderHook(() => useFriends('me'));
    await act(async () => emitRows?.([row('zeca', 'Zeca', 'offline'), row('ana', 'Ana', 'online')]));
    await waitFor(() => expect(result.current.friends).toHaveLength(2));
    expect(result.current.friends.map((f) => f.profile.nickname)).toEqual(['Ana', 'Zeca']);
    expect(result.current.loading).toBe(false);
  });

  it('presença ao vivo prevalece sobre a da lista relida', async () => {
    const { result } = await renderHook(() => useFriends('me'));
    await act(async () => emitRows?.([row('rafa', 'Rafa', 'offline')]));
    await act(async () => emitPresence?.({ state: 'in_match', lastChanged: 2 }));
    await waitFor(() => expect(result.current.friends[0]!.presence?.state).toBe('in_match'));
    await act(async () => emitRows?.([row('rafa', 'Rafa', 'offline')]));
    expect(result.current.friends[0]!.presence?.state).toBe('in_match');
  });
});
