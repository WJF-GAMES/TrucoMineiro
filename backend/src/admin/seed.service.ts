import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeaguesService } from '../leagues/leagues.service';
import { ACHIEVEMENTS } from '../progression/achievements';
import { MatchStatus, PresenceState, RoomStatus } from '@prisma/client';

/** Dados estruturais (nunca usuários): 20 ligas e o catálogo de conquistas. */
@Injectable()
export class SeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leagues: LeaguesService,
  ) {}

  async run() {
    const leagues = await this.leagues.seedDefinitions();
    for (const a of ACHIEVEMENTS) {
      const data = {
        order: a.order,
        title: a.title,
        description: a.description,
        icon: a.icon,
        target: a.target,
        stat: a.stat,
      };
      await this.prisma.achievement.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data });
    }
    return { ok: true, leagues, achievements: ACHIEVEMENTS.length };
  }

  /** Contagens para checagem operacional (sem dados pessoais). */
  async diagnostics() {
    const [users, profiles, onboarded, friendships, matches, playing, rooms, waiting, online, groups] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.userProfile.count(),
        this.prisma.userProfile.count({ where: { nickname: { not: '' } } }),
        this.prisma.friendship.count(),
        this.prisma.match.count(),
        this.prisma.match.count({ where: { status: MatchStatus.PLAYING } }),
        this.prisma.room.count(),
        this.prisma.room.count({ where: { status: RoomStatus.WAITING } }),
        this.prisma.userPresence.count({ where: { state: { not: PresenceState.OFFLINE } } }),
        this.prisma.leagueGroup.count(),
      ]);
    return { users, profiles, onboarded, friendships, matches, playing, rooms, waiting, online, groups };
  }
}
