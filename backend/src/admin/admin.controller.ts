import { Controller, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { Public } from '../auth/auth.decorators';
import { AdminGuard } from '../auth/admin.guard';
import { AdminWeekQuery } from '../common/dto';
import { LeaguesService } from '../leagues/leagues.service';
import { JobsService, JOB_NAMES, JobName } from '../jobs/jobs.service';
import { SeedService } from './seed.service';
import { weekKeyFor } from '../domain/model/leagueWeek';
import { normalizeLeagueId } from '../domain/model/leagues';
import { now } from '../common/clock';
import { AppError } from '../common/errors';

class OpParam {
  @IsIn(['seed', 'repair', 'finalize', 'prepare', 'rebalance', 'rank'])
  op!: string;
}

class JobParam {
  @IsIn(JOB_NAMES as unknown as string[])
  job!: string;
}

/** Operações administrativas (substituem `seedCatalog`, `leagueAdmin` e `diagnostics`). */
@ApiTags('admin')
@ApiHeader({ name: 'x-admin-secret', required: true })
@Public()
@UseGuards(AdminGuard)
@Controller('v1/admin')
export class AdminController {
  constructor(
    private readonly leagues: LeaguesService,
    private readonly jobs: JobsService,
    private readonly seed: SeedService,
  ) {}

  @Post('seed')
  @HttpCode(200)
  @ApiOperation({ summary: 'Seed estrutural (20 ligas + conquistas). Idempotente.' })
  runSeed() {
    return this.seed.run();
  }

  @Post('leagues/:op')
  @HttpCode(200)
  async league(@Param() p: OpParam, @Query() q: AdminWeekQuery) {
    const weekKey = q.weekKey ?? weekKeyFor(now());
    switch (p.op) {
      case 'seed':
        return { leagues: await this.leagues.seedDefinitions() };
      case 'repair':
        return this.leagues.repair();
      case 'finalize':
        return this.leagues.finalizeWeek(weekKey);
      case 'prepare':
        return this.leagues.prepareNextWeekGroups(weekKey);
      case 'rebalance':
        return this.leagues.rebalanceLeague(normalizeLeagueId(q.leagueId), weekKey);
      case 'rank':
        if (!q.groupId) throw new AppError('VALIDATION_FAILED', 'groupId obrigatório.');
        return { members: await this.leagues.recomputeRanking(q.groupId) };
    }
    throw new AppError('NOT_FOUND', 'Operação desconhecida.');
  }

  @Post('jobs/:job')
  @HttpCode(200)
  runJob(@Param() p: JobParam) {
    return this.jobs.run(p.job as JobName);
  }

  @Post('diagnostics')
  @HttpCode(200)
  diagnostics() {
    return this.seed.diagnostics();
  }
}
