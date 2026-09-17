import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { PageQuery, RankingQuery } from '../common/dto';
import { UserLookupService } from '../users/user-lookup.service';
import { LeaguesService } from './leagues.service';

class GroupParam {
  @Matches(/^\d{4}-W\d{2}__[a-z_]{3,24}__\d{3}$/, { message: 'groupId inválido.' })
  id!: string;
}

@ApiTags('leagues')
@ApiBearerAuth()
@Controller('v1/leagues')
export class LeaguesController {
  constructor(
    private readonly leagues: LeaguesService,
    private readonly users: UserLookupService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'As 20 ligas' })
  async definitions() {
    return { leagues: await this.leagues.definitions() };
  }

  @Get('me')
  @ApiOperation({ summary: 'Aba "Minha Liga" (conserta vínculo faltando antes de responder)' })
  async me(@CurrentUser() user: AuthUser) {
    // Só entra em grupo quem já tem apelido: ninguém aparece sem nome no ranking.
    await this.users.requirePlayable(user.id);
    return this.leagues.snapshot(user.id);
  }

  @Post('me/ensure')
  @HttpCode(200)
  async ensure(@CurrentUser() user: AuthUser) {
    await this.users.requirePlayable(user.id);
    return this.leagues.summary(user.id);
  }

  @Get('me/history')
  history(@CurrentUser() user: AuthUser, @Query() q: PageQuery) {
    return this.leagues.history(user.id, q.limit ?? 20, q.cursor);
  }

  @Get('ranking/global')
  async global(@CurrentUser() user: AuthUser, @Query() q: RankingQuery) {
    return { entries: await this.leagues.globalRanking(user.id, q.limit ?? 50) };
  }

  @Get('groups/:id/ranking')
  async group(@CurrentUser() user: AuthUser, @Param() p: GroupParam) {
    return { groupId: p.id, members: await this.leagues.groupMembers(p.id, user.id) };
  }
}
