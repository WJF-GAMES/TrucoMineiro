import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useFriends } from '../useFriends';
import type { Presence, Profile } from '@/domain/model/types';

let emitFriends: ((list: { id: string }[]) => void) | null = null;
let resolveProfile: ((p: Profile) => void) | null = null;

jest.mock('@/services/firebase/firestore', () => ({
  subscribeFriends: (_uid: string, cb: (list: { id: string }[]) => void) => {
    emitFriends = cb;
    return () => undefined;
  },
  subscribeBlockedUsers: () => () => undefined,
  getProfile: () =>
    new Promise<Profile>((resolve) => {
      resolveProfile = resolve;
    }),
}));
// Presença já em cache: o RTDB entrega o valor na hora da assinatura, antes do perfil.
jest.mock('@/services/firebase/rtdb', () => ({
  subscribePresence: (_uid: string, cb: (p: Presence | null) => void) => {
    cb({ state: 'online', lastChanged: 1 } as Presence);
    return () => undefined;
  },
}));

describe('useFriends', () => {
  it('mantém a presença que chegou antes do perfil', async () => {
    const { result } = await renderHook(() => useFriends('me'));
    await act(async () => emitFriends?.([{ id: 'rafa' }]));
    await act(async () => resolveProfile?.({ id: 'rafa', nickname: 'Rafa' } as Profile));
    await waitFor(() => expect(result.current.friends).toHaveLength(1));
    expect(result.current.friends[0]!.presence?.state).toBe('online');
  });
});
