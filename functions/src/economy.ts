import { authedCallable, HttpsError, obj, str } from './lib/callable';
import { db, now } from './lib/admin';
import { Profile } from './domain/model/types';
import { storeItemById } from './domain/model/store';
import { defaultProfile } from './users';

const DAILY_COINS = 50;

function todayInSaoPaulo(): string {
  return new Date(now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Daily reward. Idempotent through the rewards/{uid}_{rewardId} lock document. */
export const claimReward = authedCallable<
  { rewardId: string },
  { alreadyClaimed: boolean; coins: number }
>(
  async ({ uid, data }) => {
    const m = /^daily_(\d{4}-\d{2}-\d{2})$/.exec(data.rewardId);
    if (!m) throw new HttpsError('invalid-argument', 'Recompensa desconhecida.');
    if (m[1] !== todayInSaoPaulo())
      throw new HttpsError('failed-precondition', 'Essa recompensa não está disponível hoje.');
    const lockRef = db.doc(`rewards/${uid}_${data.rewardId}`);
    const profileRef = db.doc(`profiles/${uid}`);
    return db.runTransaction(async (tx) => {
      const [lock, profile] = await Promise.all([tx.get(lockRef), tx.get(profileRef)]);
      if (lock.exists) return { alreadyClaimed: true, coins: 0 };
      const { id: _id, ...base } = defaultProfile(uid);
      const p = { ...base, ...(profile.data() as Partial<Profile> | undefined) };
      tx.set(lockRef, { uid, rewardId: data.rewardId, coins: DAILY_COINS, claimedAt: now() });
      tx.set(profileRef, { ...p, coins: p.coins + DAILY_COINS, updatedAt: now() });
      return { alreadyClaimed: false, coins: DAILY_COINS };
    });
  },
  (d) => ({ rewardId: str(obj(d, 'payload').rewardId, 'rewardId', 6, 40) }),
);

export const purchaseItem = authedCallable<
  { itemId: string },
  { ok: true; coins: number; gems: number }
>(
  async ({ uid, data }) => {
    const item = storeItemById(data.itemId);
    if (!item) throw new HttpsError('not-found', 'Item não encontrado.');
    const profileRef = db.doc(`profiles/${uid}`);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(profileRef);
      const { id: _id, ...base } = defaultProfile(uid);
      const p = { ...base, ...(snap.data() as Partial<Profile> | undefined) } as Profile;
      const owned = p.ownedItems ?? [];
      if (owned.includes(item.id)) throw new HttpsError('already-exists', 'Você já tem esse item.');
      if (p.coins < item.priceCoins)
        throw new HttpsError('failed-precondition', 'Moedas insuficientes.');
      const next = {
        ...p,
        coins: p.coins - item.priceCoins,
        ownedItems: [...owned, item.id],
        updatedAt: now(),
      };
      tx.set(profileRef, next);
      tx.set(db.doc(`purchases/${uid}_${item.id}`), {
        uid,
        itemId: item.id,
        priceCoins: item.priceCoins,
        purchasedAt: now(),
      });
      return { ok: true as const, coins: next.coins, gems: next.gems };
    });
  },
  (d) => ({ itemId: str(obj(d, 'payload').itemId, 'itemId', 3, 60) }),
);
