import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { SessionThrottlerGuard } from './common/throttler.guard';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { FirebaseAuthGuard } from './auth/firebase-auth.guard';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { RateLimitService } from './common/rate-limit.service';
import { RealtimeService } from './realtime/realtime.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { UserLookupService } from './users/user-lookup.service';
import { UsersService } from './users/users.service';
import { MeController, PlayersController } from './users/users.controller';
import { JobLockService } from './jobs/job-lock.service';
import { JobsService } from './jobs/jobs.service';
import { PushService } from './notifications/push.service';
import { NotificationsController } from './notifications/notifications.controller';
import { FriendshipRepository } from './friends/friendship.repository';
import { FriendsService } from './friends/friends.service';
import { FriendsController } from './friends/friends.controller';
import { PhoneDirectoryService } from './contacts/phone-directory.service';
import { ContactsService } from './contacts/contacts.service';
import { PresenceService } from './presence/presence.service';
import { LeaguesService } from './leagues/leagues.service';
import { LeaguesController } from './leagues/leagues.controller';
import { ProgressionService } from './progression/progression.service';
import { GameService } from './game/game.service';
import { GameSchedulerService } from './game/game-scheduler.service';
import { MatchesController } from './game/matches.controller';
import { RoomRepository } from './rooms/room.repository';
import { RoomsService } from './rooms/rooms.service';
import { RoomsController } from './rooms/rooms.controller';
import { MatchmakingService } from './matchmaking/matchmaking.service';
import { WebhooksService } from './webhooks/webhooks.service';
import { WebhooksController } from './webhooks/webhooks.controller';
import { HealthController, StatsController } from './health/health.controller';
import { AdminController } from './admin/admin.controller';
import { SeedService } from './admin/seed.service';

/** Serviços compartilhados por todos os módulos de domínio. */
@Global()
@Module({
  providers: [
    RealtimeService,
    RateLimitService,
    UserLookupService,
    JobLockService,
    PushService,
    FriendshipRepository,
    PhoneDirectoryService,
    PresenceService,
  ],
  exports: [
    RealtimeService,
    RateLimitService,
    UserLookupService,
    JobLockService,
    PushService,
    FriendshipRepository,
    PhoneDirectoryService,
    PresenceService,
  ],
})
export class CoreModule {}

@Module({
  providers: [LeaguesService, ProgressionService],
  controllers: [LeaguesController],
  exports: [LeaguesService, ProgressionService],
})
export class LeaguesModule {}

@Module({
  imports: [LeaguesModule],
  providers: [GameService, RoomRepository, RoomsService, MatchmakingService, GameSchedulerService],
  controllers: [MatchesController, RoomsController],
  exports: [GameService, RoomsService, MatchmakingService, GameSchedulerService],
})
export class PlayModule {}

@Module({
  imports: [LeaguesModule, PlayModule],
  providers: [UsersService, FriendsService, ContactsService],
  controllers: [MeController, PlayersController, FriendsController, NotificationsController],
  exports: [UsersService],
})
export class SocialModule {}

@Module({
  imports: [LeaguesModule, PlayModule, SocialModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}

@Module({
  imports: [LeaguesModule, PlayModule, SocialModule],
  providers: [JobsService, WebhooksService, SeedService],
  controllers: [WebhooksController, AdminController, HealthController, StatsController],
})
export class OpsModule {}

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    CoreModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: Number(process.env.HTTP_RATE_LIMIT ?? 300) }],
      }),
    }),
    LeaguesModule,
    PlayModule,
    SocialModule,
    RealtimeModule,
    OpsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SessionThrottlerGuard },
    { provide: APP_GUARD, useExisting: FirebaseAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
