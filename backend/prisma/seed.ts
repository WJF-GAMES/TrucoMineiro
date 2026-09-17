/**
 * Seed ESTRUTURAL (idempotente): as 20 ligas e o catálogo de conquistas. Nunca cria usuários.
 * Uso: `npm run seed` (DATABASE_URL do ambiente).
 */
import { PrismaClient } from '@prisma/client';
import { LEAGUE_DEFINITIONS } from '../src/domain/model/leagues';
import { ACHIEVEMENTS } from '../src/progression/achievements';

export async function seedStructural(prisma: PrismaClient) {
  for (const l of LEAGUE_DEFINITIONS) {
    const data = {
      order: l.order,
      displayName: l.displayName,
      assetKey: l.assetKey,
      previousLeagueId: l.previousLeagueId,
      nextLeagueId: l.nextLeagueId,
      isFirst: l.isFirst,
      isLast: l.isLast,
      active: l.active,
    };
    await prisma.league.upsert({ where: { id: l.id }, create: { id: l.id, ...data }, update: data });
  }
  for (const a of ACHIEVEMENTS) {
    const data = {
      order: a.order,
      title: a.title,
      description: a.description,
      icon: a.icon,
      target: a.target,
      stat: a.stat,
    };
    await prisma.achievement.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data });
  }
  return { leagues: LEAGUE_DEFINITIONS.length, achievements: ACHIEVEMENTS.length };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedStructural(prisma)
    .then((r) => console.log(JSON.stringify({ seeded: r })))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
