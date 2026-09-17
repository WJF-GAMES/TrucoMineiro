import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { FinalizeAiMatchDto, IdParam, MatchmakingDto, PageQuery, SubmitActionDto } from '../common/dto';
import { GameService } from './game.service';
import { parseAction } from './action-parser';
import { MatchmakingService } from '../matchmaking/matchmaking.service';

@ApiTags('matches')
@ApiBearerAuth()
@Controller('v1')
export class MatchesController {
  constructor(
    private readonly game: GameService,
    private readonly matchmaking: MatchmakingService,
  ) {}

  @Get('matches')
  @ApiOperation({ summary: 'Histórico de partidas (paginação por cursor)' })
  history(@CurrentUser() user: AuthUser, @Query() q: PageQuery) {
    return this.game.history(user.id, q.limit ?? 30, q.cursor);
  }

  @Get('matches/:id')
  @ApiOperation({ summary: 'Retrato da partida para o assento do usuário (reconexão)' })
  snapshot(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.game.snapshot(user.id, p.id);
  }

  @Get('matches/:id/snapshot')
  snapshotAlias(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.game.snapshot(user.id, p.id);
  }

  @Post('matches/:id/actions')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Intenção de jogada (alternativa REST ao WebSocket)' })
  act(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() body: SubmitActionDto) {
    return this.game.submitAction(user.id, p.id, parseAction(body.action), body.actionId);
  }

  @Post('matches/:id/advance-bots')
  @HttpCode(200)
  advance(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.game.requestBotStep(user.id, p.id);
  }

  @Post('matches/:id/rejoin')
  @HttpCode(200)
  async rejoin(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    await this.game.setConnected(user.id, p.id, true);
    return { ok: true };
  }

  @Post('matches/:id/abandon')
  @HttpCode(200)
  abandon(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.game.abandon(user.id, p.id);
  }

  @Post('matches/:id/claim-seat')
  @HttpCode(200)
  claim(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.game.claimSeat(user.id, p.id);
  }

  @Post('matches/ai')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Registra partida contra a IA (o servidor re-executa e valida)' })
  finalizeAi(@CurrentUser() user: AuthUser, @Body() body: FinalizeAiMatchDto) {
    return this.game.finalizeAiMatch(user, {
      matchId: body.matchId,
      seed: body.seed,
      aiSeed: body.aiSeed,
      difficulty: body.difficulty,
      actions: body.actions.map(parseAction),
    });
  }

  @Get('matchmaking')
  async ticket(@CurrentUser() user: AuthUser) {
    return { entry: await this.matchmaking.get(user.id) };
  }

  @Post('matchmaking')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  start(@CurrentUser() user: AuthUser, @Body() body: MatchmakingDto) {
    return this.matchmaking.start(user.id, body.allowBots === true);
  }

  @Delete('matchmaking')
  cancel(@CurrentUser() user: AuthUser) {
    return this.matchmaking.cancel(user.id);
  }
}
