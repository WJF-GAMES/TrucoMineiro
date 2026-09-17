import { Injectable } from '@nestjs/common';
import { MatchStatus, Prisma, RoomStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { PhoneDirectoryService } from '../contacts/phone-directory.service';
import { FriendshipRepository } from '../friends/friendship.repository';
import { LeaguesService } from '../leagues/leagues.service';
import { GameService } from '../game/game.service';
import { RoomsService } from '../rooms/rooms.service';
import { ProgressionService } from '../progression/progression.service';
import { AppError } from '../common/errors';
import { moduleLogger } from '../common/logger';
import { now } from '../common/clock';
import { MetricsService } from '../metrics/metrics.service';
import { weekKeyFor } from '../domain/model/leagueWeek';
import { AVATAR_IDS, type AvatarId, type PlayerStats, type Profile } from '../domain/model/types';
import { toProfile, toStats, UserLookupService } from './user-lookup.service';
import type { PendingIdentity } from '../auth/auth.decorators';

const log = moduleLogger('users');

/** País a partir do DDI do telefone verificado (o cliente nunca informa isso). */
const DIAL_TO_COUNTRY: [string, string][] = [
  ['+595', 'PY'],
  ['+598', 'UY'],
  ['+351', 'PT'],
  ['+55', 'BR'],
  ['+54', 'AR'],
  ['+1', 'US'],
];

export function countryFromPhone(phone: string | null): string {
  if (!phone) return 'BR';
  return DIAL_TO_COUNTRY.find(([dial]) => phone.startsWith(dial))?.[1] ?? 'BR';
}

export const NICK_RE = /^[\p{L}\p{N} _.-]{3,16}$/u;
const SEARCH_LIMIT = 20;
/** `lastSeenAt` é informativo: gravar no máximo uma vez por minuto poupa escrita no bootstrap. */
const LAST_SEEN_WRITE_MS = 60_000;

const ENSURED_USER_SELECT = {
  id: true,
  firebaseUid: true,
  countryCode: true,
  phoneHash: true,
  lastSeenAt: true,
  profile: true,
  stats: true,
} satisfies Prisma.UserSelect;
type EnsuredUserRow = Prisma.UserGetPayload<{ select: typeof ENSURED_USER_SELECT }>;
type EnsuredUser = EnsuredUserRow & {
  profile: NonNullable<EnsuredUserRow['profile']>;
  stats: NonNullable<EnsuredUserRow['stats']>;
};

export interface BootstrapResult {
  uid: string;
  onboarded: boolean;
  profile: Profile;
  stats: PlayerStats;
  league: Awaited<ReturnType<LeaguesService['summary']>> | null;
  activeMatch: { matchId: string; roomCode: string | null } | null;
  invites: Awaited<ReturnType<RoomsService['inbox']>>;
  unreadNotifications: number;
  unlockedAchievements: Record<string, number>;
  serverTime: number;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly firebase: FirebaseAdminService,
    private readonly phones: PhoneDirectoryService,
    private readonly leagues: LeaguesService,
    private readonly game: GameService,
    private readonly rooms: RoomsService,
    private readonly progression: ProgressionService,
    private readonly lookup: UserLookupService,
    private readonly metrics: MetricsService,
    private readonly friendships: FriendshipRepository,
  ) {}

  /**
   * Garante usuário, perfil e estatísticas (idempotente — um primeiro login que falhou no meio não
   * deixa conta pela metade).
   */
  async ensureUser(identity: PendingIdentity): Promise<string> {
    return (await this.ensureUserRow(identity)).id;
  }

  /**
   * Caminho quente (usuário já existe): uma leitura só, e `lastSeenAt` gravado no máximo uma
   * vez por minuto. Conta nova (ou incompleta) cai no caminho de criação idempotente.
   */
  private async ensureUserRow(identity: PendingIdentity): Promise<EnsuredUser> {
    const countryCode = countryFromPhone(identity.phoneNumber);
    const t = new Date(now());
    const existing = await this.prisma.user.findUnique({
      where: { firebaseUid: identity.firebaseUid },
      select: ENSURED_USER_SELECT,
    });
    if (existing?.profile && existing.stats) {
      const stale =
        !existing.lastSeenAt || t.getTime() - existing.lastSeenAt.getTime() > LAST_SEEN_WRITE_MS;
      if (stale || existing.countryCode !== countryCode) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { countryCode, lastSeenAt: t },
        });
        existing.countryCode = countryCode;
      }
      this.auth.remember(identity.firebaseUid, existing.id);
      return existing as EnsuredUser;
    }
    let user: { id: string };
    try {
      user = await this.prisma.user.upsert({
        where: { firebaseUid: identity.firebaseUid },
        create: { firebaseUid: identity.firebaseUid, countryCode, lastSeenAt: t },
        update: { countryCode, lastSeenAt: t },
        select: { id: true },
      });
    } catch (e) {
      // Dois bootstraps simultâneos do mesmo usuário: o segundo lê o que o primeiro criou.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      user = await this.prisma.user.findUniqueOrThrow({
        where: { firebaseUid: identity.firebaseUid },
        select: { id: true },
      });
    }
    await this.prisma.userProfile.createMany({ data: [{ userId: user.id }], skipDuplicates: true });
    await this.prisma.playerStatistics.createMany({
      data: [{ userId: user.id }],
      skipDuplicates: true,
    });
    this.auth.remember(identity.firebaseUid, user.id);
    return (await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: ENSURED_USER_SELECT,
    })) as EnsuredUser;
  }

  /**
   * Primeira chamada depois do login: cria o que faltar, indexa o telefone, garante a liga e
   * devolve tudo o que a Home precisa numa resposta só.
   */
  async bootstrap(
    identity: PendingIdentity,
    device?: { token: string; platform: string },
  ): Promise<BootstrapResult> {
    const user = await this.ensureUserRow(identity);
    const userId = user.id;
    this.firebase.rememberTestPhone(identity.firebaseUid, identity.phoneNumber);
    // Diretório de telefones: o número vem do token do Firebase Auth. Falha aqui não impede o login.
    await this.phones
      .index(userId, identity.phoneNumber, undefined, user.phoneHash)
      .catch((e: Error) => log.warn('phone_index_failed', { error: e.message }));
    if (device) await this.registerDevice(userId, device.token, device.platform);

    const onboarded = Boolean(user.profile.nickname);
    // Liga + grupo da semana a cada abertura (auto-repair). Quem ainda não tem apelido entra na
    // liga no cadastro: ninguém aparece sem nome no ranking.
    let league: BootstrapResult['league'] = null;
    if (onboarded) {
      league = await this.leagues.summary(userId).catch((e: Error) => {
        log.warn('league_bootstrap_failed', { error: e.message });
        return null;
      });
    }
    const [activeMatch, invites, unreadNotifications, achievements] = await Promise.all([
      this.game.activeMatchOf(userId),
      onboarded ? this.rooms.inbox(userId) : Promise.resolve([]),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.userAchievement.findMany({ where: { userId } }),
    ]);
    this.metrics.inc('bootstrap_total', { onboarded: String(onboarded) });
    return {
      uid: user.firebaseUid,
      onboarded,
      profile: toProfile(user.firebaseUid, user.profile, user.countryCode),
      stats: toStats(user.firebaseUid, user.stats),
      league,
      activeMatch,
      invites,
      unreadNotifications,
      unlockedAchievements: Object.fromEntries(
        achievements.map((a) => [a.achievementId, a.unlockedAt.getTime()]),
      ),
      serverTime: now(),
    };
  }

  async profile(userId: string): Promise<{ profile: Profile; stats: PlayerStats }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firebaseUid: true, countryCode: true, profile: true, stats: true },
    });
    if (!user.profile || !user.stats) throw new AppError('USER_NOT_FOUND', 'Conta não encontrada.');
    return {
      profile: toProfile(user.firebaseUid, user.profile, user.countryCode),
      stats: toStats(user.firebaseUid, user.stats),
    };
  }

  /**
   * Cadastro/edição de Nome e Avatar. Ordem consistente: documentos base → liga → apelido.
   * O apelido é gravado por último porque é ele que libera o app (`onboarded`).
   */
  async updateProfile(
    identity: PendingIdentity,
    nicknameRaw: string,
    avatarId: string,
  ): Promise<{ ok: true; profile: Profile }> {
    const nickname = nicknameRaw.trim();
    if (!NICK_RE.test(nickname))
      throw new AppError('NICKNAME_INVALID', 'Apelido deve ter de 3 a 16 caracteres.');
    if (!(AVATAR_IDS as string[]).includes(avatarId))
      throw new AppError('VALIDATION_FAILED', 'avatarId inválido.');
    const userId = await this.ensureUser(identity);
    const before = await this.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
    const wasOnboarded = Boolean(before.nickname);
    try {
      await this.leagues.ensureAssignment(userId);
    } catch (e) {
      log.error('update_profile_league_unavailable', { error: (e as Error).message });
      if (!wasOnboarded)
        throw new AppError('LEAGUE_UNAVAILABLE', 'Não foi possível entrar na liga. Tente de novo.');
    }
    const updated = await this.prisma.userProfile.update({
      where: { userId },
      data: { nickname, nicknameLower: nickname.toLowerCase(), avatarId: avatarId as AvatarId },
    });
    if (!wasOnboarded) this.metrics.inc('onboarding_completed_total');
    // O ranking lê a identidade direto do perfil: a mudança já aparece na liga.
    const progress = await this.prisma.leagueProgress.findUnique({ where: { userId } });
    if (progress?.currentGroupId && progress.currentWeekKey === weekKeyFor(now()))
      this.leagues.scheduleGroupBroadcast(progress.currentGroupId);
    await this.progression.pushProfile(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firebaseUid: true, countryCode: true },
    });
    return { ok: true, profile: toProfile(user.firebaseUid, updated, user.countryCode) };
  }

  async registerDevice(userId: string, token: string, platform: string): Promise<{ ok: true }> {
    // O token pertence a um aparelho: se outra conta logou nele, o token muda de dono.
    await this.prisma.userDevice.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
    return { ok: true };
  }

  async unregisterDevice(userId: string, token: string): Promise<{ ok: true }> {
    await this.prisma.userDevice.deleteMany({ where: { userId, token } });
    return { ok: true };
  }

  /**
   * Exclusão de conta: sai da partida/sala/liga, apaga os dados (cascata no banco) e a conta do
   * Firebase Auth. Idempotente.
   */
  async deleteAccount(userId: string, firebaseUid: string): Promise<{ ok: true }> {
    await this.deleteUserData(userId, firebaseUid);
    await this.firebase
      .deleteUser(firebaseUid)
      .catch((e: Error) => log.warn('auth_delete_failed', { error: e.message }));
    return { ok: true };
  }

  async deleteUserData(userId: string, firebaseUid: string): Promise<void> {
    const active = await this.game.activeMatchOf(userId);
    if (active) await this.game.abandon(userId, active.matchId).catch(() => undefined);
    const hosted = await this.prisma.room.findMany({
      where: { hostUserId: userId, status: { in: [RoomStatus.WAITING, RoomStatus.STARTING] } },
      select: { code: true },
    });
    for (const r of hosted)
      await this.rooms.leaveRoom(userId, firebaseUid, r.code).catch(() => undefined);
    // Partidas em andamento que o citam (IA ocupando a vaga dele etc.) seguem sem ele.
    await this.prisma.matchParticipant.updateMany({
      where: {
        OR: [{ reservedForUserId: userId }, { pendingUserId: userId }],
        match: { status: MatchStatus.PLAYING },
      },
      data: { reservedForUserId: null, pendingUserId: null },
    });
    // Sala em partida hospedada por ele: passa para outro humano da mesa, para a partida dos
    // outros continuar com sala (reconexão, vagas reservadas). Sem outro humano, sai junto.
    const inMatch = await this.prisma.room.findMany({
      where: { hostUserId: userId, status: RoomStatus.IN_MATCH },
      select: {
        id: true,
        seats: { where: { userId: { not: null } }, select: { userId: true, seat: true } },
      },
    });
    for (const room of inMatch) {
      const heir = room.seats
        .filter((s) => s.userId !== userId)
        .sort((a, b) => a.seat - b.seat)[0]?.userId;
      if (heir)
        await this.prisma.room.update({ where: { id: room.id }, data: { hostUserId: heir } });
    }
    await this.leagues.leaveCurrentGroup(userId);
    // Demais salas hospedadas por ele (inclusive fechadas) saem junto; partidas mantêm o histórico dos outros.
    await this.prisma.user.delete({ where: { id: userId } }).catch((e: unknown) => {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')) throw e;
    });
    this.auth.forget(firebaseUid);
    this.metrics.inc('accounts_deleted_total');
  }

  /** Busca por prefixo do apelido. Fora: quem não tem apelido e eu mesmo. */
  async search(userId: string, termRaw: string): Promise<Profile[]> {
    const term = termRaw.trim().toLowerCase();
    if (term.length < 2) return [];
    const blocked = await this.friendships.blockedSet(userId);
    const rows = await this.prisma.userProfile.findMany({
      where: {
        nicknameLower: { startsWith: term },
        nickname: { not: '' },
        userId: { notIn: [userId, ...blocked] },
      },
      orderBy: { nicknameLower: 'asc' },
      take: SEARCH_LIMIT,
      include: { user: { select: { firebaseUid: true, countryCode: true } } },
    });
    return rows.map((r) => toProfile(r.user.firebaseUid, r, r.user.countryCode));
  }

  async publicPlayer(
    viewerId: string,
    uid: string,
  ): Promise<{ profile: Profile; stats: PlayerStats }> {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid: uid },
      select: { id: true, firebaseUid: true, countryCode: true, profile: true, stats: true },
    });
    // Bloqueio em qualquer sentido: para quem bloqueou/foi bloqueado, o jogador "não existe".
    const hidden =
      user && user.id !== viewerId && (await this.friendships.blockedEitherWay(viewerId, user.id));
    if (!user?.profile?.nickname || !user.stats || hidden)
      throw new AppError('PLAYER_NOT_FOUND', 'Jogador não encontrado.');
    return {
      profile: toProfile(user.firebaseUid, user.profile, user.countryCode),
      stats: toStats(user.firebaseUid, user.stats),
    };
  }

  async achievements(userId: string) {
    const [catalog, unlocked] = await Promise.all([
      this.prisma.achievement.findMany({ orderBy: { order: 'asc' } }),
      this.prisma.userAchievement.findMany({ where: { userId } }),
    ]);
    return {
      achievements: catalog.map((a) => ({
        id: a.id,
        order: a.order,
        title: a.title,
        description: a.description,
        icon: a.icon,
        target: a.target,
        stat: a.stat,
      })),
      unlocked: Object.fromEntries(unlocked.map((u) => [u.achievementId, u.unlockedAt.getTime()])),
    };
  }

  /**
   * Reconciliação com o Firebase Auth (substitui o gatilho `onAuthUserDeleted`): conta apagada
   * direto no Console some daqui também. Roda em lotes pelo job diário.
   */
  async reconcileDeletedAccounts(batch = 1000): Promise<number> {
    let removed = 0;
    let cursor: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        orderBy: { id: 'asc' },
        take: batch,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, firebaseUid: true },
      });
      if (users.length === 0) break;
      cursor = users[users.length - 1]!.id;
      for (let i = 0; i < users.length; i += 100) {
        const slice = users.slice(i, i + 100);
        const { notFound } = await this.firebase.getUsers(slice.map((u) => u.firebaseUid));
        for (const uid of notFound) {
          const u = slice.find((x) => x.firebaseUid === uid);
          if (!u) continue;
          await this.deleteUserData(u.id, uid).catch((e: Error) =>
            log.error('reconcile_delete_failed', { error: e.message }),
          );
          removed++;
        }
      }
      if (users.length < batch) break;
    }
    if (removed) log.info('deleted_accounts_reconciled', { removed });
    return removed;
  }

  lookupService() {
    return this.lookup;
  }
}
