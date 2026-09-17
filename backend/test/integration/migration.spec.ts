import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { Harness, resetDb, startHarness } from '../helpers/harness';
import { importAll, validate } from '../../scripts/migration/postgres-import';
import { decodeFields } from '../../scripts/migration/firebase-export';
import { weekKeyFor } from '../../src/domain/model/leagueWeek';

/** Backup sintético no mesmo formato do export real (NDJSON por coleção). */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'truco-migration-'));
  const week = weekKeyFor(Date.now());
  const group = `${week}__bronze__001`;
  const t = Date.UTC(2026, 8, 1);
  const files: Record<string, { path: string; id: string; data: Record<string, unknown> }[]> = {
    users: [
      { path: 'users/alice', id: 'alice', data: { createdAt: t, lastSeenAt: t, fcmTokens: { ['tok_alice'.padEnd(30, 'x')]: { platform: 'android', updatedAt: t } }, inviteToken: 'inviteAliceToken0001' } },
      { path: 'users/bob', id: 'bob', data: { createdAt: t } },
      { path: 'users/carol', id: 'carol', data: { createdAt: t } },
    ],
    profiles: [
      { path: 'profiles/alice', id: 'alice', data: { nickname: 'Alice', nicknameLower: 'alice', avatarId: 'maria', countryCode: 'BR', level: 3, xp: 120, xpToNext: 500, leagueId: 'silver', leaguePoints: 90, createdAt: t } },
      { path: 'profiles/bob', id: 'bob', data: { nickname: 'Bob do Truco Mineiro Longo', avatarId: 'desconhecido', level: 1, xp: 0, leagueId: 'liga-velha' } },
      { path: 'profiles/carol', id: 'carol', data: { nickname: '', avatarId: 'joao' } },
      { path: 'profiles/ghost', id: 'ghost', data: { nickname: 'Fantasma' } },
    ],
    playerStats: [
      { path: 'playerStats/alice', id: 'alice', data: { matches: 10, wins: 7, losses: 3, winRate: 70, onlineMatches: 4, aiMatches: 6, bestStreak: 4, currentStreak: 1 } },
      { path: 'playerStats/orphan', id: 'orphan', data: { matches: 1 } },
    ],
    userAchievements: [{ path: 'userAchievements/alice', id: 'alice', data: { unlocked: { first_win: t, ten_wins: t, removida: t } } }],
    phoneIndex: [{ path: `phoneIndex/${'a'.repeat(64)}`, id: 'a'.repeat(64), data: { uid: 'alice', updatedAt: t } }],
    'friendships.friends': [
      { path: 'friendships/alice/friends/bob', id: 'bob', data: { since: t, source: 'phone_contact' } },
      { path: 'friendships/bob/friends/alice', id: 'alice', data: { since: t, source: 'phone_contact' } },
      { path: 'friendships/alice/friends/nobody', id: 'nobody', data: { since: t } },
    ],
    friendRequests: [
      { path: 'friendRequests/carol_alice', id: 'carol_alice', data: { from: 'carol', to: 'alice', status: 'pending', createdAt: t } },
      { path: 'friendRequests/bob_carol', id: 'bob_carol', data: { from: 'bob', to: 'carol', status: 'declined', createdAt: t } },
    ],
    'blocks.blocked': [{ path: 'blocks/alice/blocked/carol', id: 'carol', data: { since: t } }],
    'autoConnectSuppressed.users': [{ path: 'autoConnectSuppressed/alice/users/carol', id: 'carol', data: { since: t, reason: 'blocked' } }],
    weeklyLeagueGroups: [{ path: `weeklyLeagueGroups/${group}`, id: group, data: { leagueId: 'bronze', weekKey: week, division: 1, status: 'active', memberCount: 99 } }],
    'weeklyLeagueGroups.members': [
      { path: `weeklyLeagueGroups/${group}/members/alice`, id: 'alice', data: { weeklyPoints: 30, wins: 2, matches: 3, tiebreakScore: 30, joinedAt: t } },
      { path: `weeklyLeagueGroups/${group}/members/bob`, id: 'bob', data: { weeklyPoints: 5, wins: 0, matches: 1, joinedAt: t } },
    ],
    playerProgress: [
      { path: 'playerProgress/alice', id: 'alice', data: { currentLeagueId: 'bronze', currentDivision: 1, currentWeekKey: week, currentLeagueGroupId: group, weeklyPoints: 30, seasonPoints: 300, lastWeeklyResult: 'relegated', lastWeeklyRank: 19 } },
      { path: 'playerProgress/bob', id: 'bob', data: { currentLeagueId: 'bronze', currentWeekKey: week, currentLeagueGroupId: 'grupo-que-nao-existe', weeklyPoints: 5 } },
    ],
    'leagueHistory.weeks': [
      { path: 'leagueHistory/alice/weeks/2026-W30', id: '2026-W30', data: { leagueId: 'silver', division: 1, groupId: '2026-W30__silver__001', groupSize: 20, finalRank: 19, weeklyPoints: 2, result: 'relegated', previousLeagueId: 'silver', nextLeagueId: 'bronze', processedAt: t } },
    ],
    processedLeagueEvents: [
      { path: 'processedLeagueEvents/m1__alice__match_win', id: 'm1__alice__match_win', data: { uid: 'alice', matchId: 'm1', eventType: 'match_win', points: 25, weekKey: week, groupId: group, processedAt: t } },
    ],
    matchHistory: [
      {
        path: 'matchHistory/alice_local-1',
        id: 'alice_local-1',
        data: { mode: 'ai', difficulty: 'hard', playerIds: ['alice'], players: [{ uid: 'alice', seat: 0, nickname: 'Alice', avatarId: 'maria', bot: false }, { uid: 'bot1', seat: 1, nickname: 'IA', avatarId: 'seu_ze', bot: true }, { uid: 'bot2', seat: 2, nickname: 'IA', avatarId: 'maria', bot: true }, { uid: 'bot3', seat: 3, nickname: 'IA', avatarId: 'tiao', bot: true }], scores: [12, 7], winnerTeam: 0, handsPlayed: 9, finishedAt: t },
      },
      {
        path: 'matchHistory/s_online1',
        id: 's_online1',
        data: { mode: 'online', playerIds: ['alice', 'bob'], players: [{ uid: 'alice', seat: 0, nickname: 'Alice', avatarId: 'maria', bot: false }, { uid: 'bob', seat: 1, nickname: 'Bob', avatarId: 'joao', bot: false }, { uid: 'bot_2_x', seat: 2, nickname: 'Maria (IA)', avatarId: 'maria', bot: true }, { uid: 'bot_3_y', seat: 3, nickname: 'Tião (IA)', avatarId: 'tiao', bot: true }], scores: [9, 12], winnerTeam: 1, handsPlayed: 11, finishedAt: t },
      },
    ],
  };
  for (const [name, docs] of Object.entries(files))
    writeFileSync(join(dir, `${name}.ndjson`), docs.map((d) => JSON.stringify(d)).join('\n') + '\n');
  return dir;
}

describe('Migração Firebase → PostgreSQL', () => {
  let h: Harness;
  let prisma: PrismaClient;
  beforeAll(async () => {
    h = await startHarness();
    prisma = h.prisma as unknown as PrismaClient;
  });
  afterAll(async () => h.close());
  beforeEach(async () => resetDb(h));

  it('decodifica valores do Firestore REST', () => {
    expect(
      decodeFields({
        a: { integerValue: '5' },
        b: { timestampValue: '2026-09-01T00:00:00Z' },
        c: { mapValue: { fields: { x: { booleanValue: true } } } },
        d: { arrayValue: { values: [{ stringValue: 's' }, { nullValue: null }] } },
      }),
    ).toEqual({ a: 5, b: Date.UTC(2026, 8, 1), c: { x: true }, d: ['s', null] });
  });

  it('importa o modelo relacional, é idempotente e bate as contagens', async () => {
    const dir = fixture();
    const first = await importAll(prisma, dir);
    expect(first.users).toMatchObject({ read: 5, migrated: 3, skipped: 2, failed: 0 });
    expect(first.users!.corrected).toBeGreaterThanOrEqual(1);
    expect(first.friendships).toMatchObject({ migrated: 1, duplicates: 1, skipped: 1 });
    expect(first.matchHistory).toMatchObject({ migrated: 2, failed: 0 });

    // Segunda execução: nada duplica.
    const second = await importAll(prisma, dir);
    for (const [entity, r] of Object.entries(second)) {
      expect({ entity, migrated: r.migrated, failed: r.failed }).toEqual({ entity, migrated: 0, failed: 0 });
    }
    expect(await prisma.user.count()).toBe(3);
    expect(await prisma.friendship.count()).toBe(1);
    expect(await prisma.match.count()).toBe(2);
    expect(await prisma.matchResult.count()).toBe(3);

    const alice = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'alice' },
      include: { profile: true, stats: true, devices: true, leagueProgress: true, achievements: true },
    });
    expect(alice.profile).toMatchObject({ nickname: 'Alice', avatarId: 'maria', level: 3, xp: 120, leagueId: 'bronze' });
    expect(alice.stats).toMatchObject({ matches: 10, wins: 7, onlineMatches: 4 });
    expect(alice.devices).toHaveLength(1);
    expect(alice.phoneHash).toBe('a'.repeat(64));
    expect(alice.inviteToken).toBe('inviteAliceToken0001');
    expect(alice.achievements.map((a) => a.achievementId).sort()).toEqual(['first_win', 'ten_wins']);
    expect(alice.leagueProgress).toMatchObject({ seasonPoints: 300, lastWeeklyResult: 'RELEGATED' });

    const bob = await prisma.user.findUniqueOrThrow({ where: { firebaseUid: 'bob' }, include: { profile: true, leagueProgress: true } });
    expect(bob.profile).toMatchObject({ nickname: 'Bob do Truco Min', avatarId: 'joao', leagueId: 'bronze' });
    expect(bob.leagueProgress!.currentGroupId).toBeNull();

    const group = await prisma.leagueGroup.findFirstOrThrow();
    expect(group.memberCount).toBe(2);
    expect(await prisma.blockedUser.count()).toBe(1);
    expect(await prisma.friendRequest.count()).toBe(2);
    expect(await prisma.leagueWeekResult.count()).toBe(1);
    expect(await prisma.leagueScore.count()).toBe(1);

    const rows = await validate(prisma, dir);
    expect(rows.filter((r) => !r.ok)).toEqual([]);

    // Usuário migrado entra sem refazer cadastro e vê o histórico.
    const boot = await h.http.post('/v1/me/bootstrap').set('authorization', 'Bearer test:alice:+5531999990001').send({}).expect(200);
    expect(boot.body.data).toMatchObject({ onboarded: true, profile: { nickname: 'Alice' } });
    const history = await h.http.get('/v1/matches').set('authorization', 'Bearer test:alice:+5531999990001').expect(200);
    expect(history.body.data.items).toHaveLength(2);
    const friends = await h.http.get('/v1/friends').set('authorization', 'Bearer test:alice:+5531999990001').expect(200);
    expect(friends.body.data.friends.map((f: { uid: string }) => f.uid)).toEqual(['bob']);
    const carol = await h.http.post('/v1/me/bootstrap').set('authorization', 'Bearer test:carol:').send({}).expect(200);
    expect(carol.body.data.onboarded).toBe(false);
  });

  it('dry-run não grava nada', async () => {
    const report = await importAll(prisma, fixture(), true);
    expect(report.users!.migrated).toBe(3);
    expect(await prisma.user.count()).toBe(0);
  });
});
