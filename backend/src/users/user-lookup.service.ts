import { Injectable } from '@nestjs/common';
import type { AvatarId, PlayerStats, Profile } from '../domain/model/types';
import { normalizeLeagueId } from '../domain/model/leagues';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AppError, MESSAGES } from '../common/errors';
import type { PlayerStatistics, UserProfile } from '@prisma/client';

export interface PublicIdentity {
  id: string;
  uid: string;
  nickname: string;
  avatarId: AvatarId;
  countryCode: string;
  level: number;
}

/** Converte linhas do banco no formato que o app já usa (`Profile.id` = uid público). */
export function toProfile(uid: string, p: UserProfile, countryCode: string): Profile {
  return {
    id: uid,
    nickname: p.nickname,
    nicknameLower: p.nicknameLower,
    avatarId: p.avatarId as AvatarId,
    countryCode,
    level: p.level,
    xp: p.xp,
    xpToNext: p.xpToNext,
    leagueId: normalizeLeagueId(p.leagueId),
    leaguePoints: p.leaguePoints,
    createdAt: p.createdAt.getTime(),
    updatedAt: p.updatedAt.getTime(),
  };
}

export function toStats(uid: string, s: PlayerStatistics): PlayerStats {
  return {
    id: uid,
    matches: s.matches,
    wins: s.wins,
    losses: s.losses,
    winRate: s.winRate,
    aiMatches: s.aiMatches,
    onlineMatches: s.onlineMatches,
    trucosCalled: s.trucosCalled,
    trucosAccepted: s.trucosAccepted,
    bestStreak: s.bestStreak,
    currentStreak: s.currentStreak,
    hardWins: s.hardWins,
    updatedAt: s.updatedAt.getTime(),
  };
}

/** Tradução uid público ↔ id interno e leitura de identidade pública. */
@Injectable()
export class UserLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async idOf(uid: string, db: Tx | PrismaService = this.prisma): Promise<string | null> {
    if (!uid || uid.length > 128) return null;
    const u = await db.user.findUnique({ where: { firebaseUid: uid }, select: { id: true } });
    return u?.id ?? null;
  }

  async requireId(uid: string, db: Tx | PrismaService = this.prisma): Promise<string> {
    const id = await this.idOf(uid, db);
    if (!id) throw new AppError('PLAYER_NOT_FOUND', 'Jogador não encontrado.');
    return id;
  }

  async idsOf(uids: string[], db: Tx | PrismaService = this.prisma): Promise<Map<string, string>> {
    const unique = [...new Set(uids.filter((u) => u && u.length <= 128))];
    if (unique.length === 0) return new Map();
    const rows = await db.user.findMany({
      where: { firebaseUid: { in: unique } },
      select: { id: true, firebaseUid: true },
    });
    return new Map(rows.map((r) => [r.firebaseUid, r.id]));
  }

  async uidsOf(ids: string[], db: Tx | PrismaService = this.prisma): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firebaseUid: true },
    });
    return new Map(rows.map((r) => [r.id, r.firebaseUid]));
  }

  async identities(
    ids: string[],
    db: Tx | PrismaService = this.prisma,
  ): Promise<Map<string, PublicIdentity>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firebaseUid: true, countryCode: true, profile: true },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          uid: r.firebaseUid,
          nickname: r.profile?.nickname ?? '',
          avatarId: (r.profile?.avatarId ?? 'joao') as AvatarId,
          countryCode: r.countryCode,
          level: r.profile?.level ?? 1,
        },
      ]),
    );
  }

  /** Perfil completo (com apelido) — exigido para jogar. */
  async requirePlayable(
    userId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<PublicIdentity> {
    const identity = (await this.identities([userId], db)).get(userId);
    if (!identity?.nickname) throw new AppError('PROFILE_INCOMPLETE', MESSAGES.profileIncomplete);
    return identity;
  }

  async profiles(
    ids: string[],
    db: Tx | PrismaService = this.prisma,
  ): Promise<Map<string, Profile>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firebaseUid: true, countryCode: true, profile: true },
    });
    const out = new Map<string, Profile>();
    for (const r of rows)
      if (r.profile) out.set(r.id, toProfile(r.firebaseUid, r.profile, r.countryCode));
    return out;
  }
}
