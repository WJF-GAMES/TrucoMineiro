import { onRequest } from 'firebase-functions/v2/https';
import { db, IS_EMULATOR, now, REGION } from './lib/admin';
import { LEAGUES } from './domain/model/leagues';
import { ACHIEVEMENTS } from './progression';

/**
 * Seeds static catalog collections (leagues, achievements, current season).
 * Only callable in the emulator or with the SEED_SECRET header in production.
 */
export const seedCatalog = onRequest({ region: REGION }, async (req, res) => {
  const secret = process.env.SEED_SECRET;
  if (!IS_EMULATOR && (!secret || req.get('x-seed-secret') !== secret)) {
    res.status(403).send('forbidden');
    return;
  }
  const batch = db.batch();
  for (const l of LEAGUES) {
    const { id, ...data } = l;
    batch.set(db.doc(`leagues/${id}`), data);
  }
  for (const a of ACHIEVEMENTS) {
    const { id, ...data } = a;
    batch.set(db.doc(`achievements/${id}`), data);
  }
  const start = now();
  batch.set(db.doc('seasons/current'), {
    name: 'Temporada Minas Gerais',
    subtitle: 'Mostre que o Truco Mineiro é forte!',
    startsAt: start,
    endsAt: start + 30 * 86_400_000,
  });
  await batch.commit();
  res.json({ ok: true, leagues: LEAGUES.length, achievements: ACHIEVEMENTS.length });
});

/**
 * Read-only snapshot of the collections the app depends on. Used to check, from outside the app,
 * whether a user's documents were really written. Same secret as seedCatalog.
 */
export const diagnostics = onRequest({ region: REGION }, async (req, res) => {
  const secret = process.env.SEED_SECRET;
  if (!IS_EMULATOR && (!secret || req.get('x-seed-secret') !== secret)) {
    res.status(403).send('forbidden');
    return;
  }
  const [profiles, users, stats, leagues, seasons] = await Promise.all([
    db.collection('profiles').limit(10).get(),
    db.collection('users').limit(10).get(),
    db.collection('playerStats').limit(10).get(),
    db.collection('leagues').get(),
    db.collection('seasons').get(),
  ]);
  res.json({
    counts: {
      profiles: profiles.size,
      users: users.size,
      playerStats: stats.size,
      leagues: leagues.size,
      seasons: seasons.size,
    },
    profiles: profiles.docs.map((d) => ({
      id: d.id,
      nickname: d.get('nickname'),
      coins: d.get('coins'),
      avatarId: d.get('avatarId'),
    })),
  });
});
