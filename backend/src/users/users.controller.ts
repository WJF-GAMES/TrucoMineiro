import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AllowUnregistered,
  AuthUser,
  CurrentIdentity,
  CurrentUser,
  PendingIdentity,
} from '../auth/auth.decorators';
import {
  BootstrapDto,
  DeviceDto,
  RemoveDeviceDto,
  SearchQuery,
  UidParam,
  UpdateProfileDto,
} from '../common/dto';
import { UsersService } from './users.service';
import { GameService } from '../game/game.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('v1/me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly game: GameService,
  ) {}

  @Post('bootstrap')
  @HttpCode(200)
  @AllowUnregistered()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Login → cria/localiza o usuário, garante liga e devolve o resumo inicial',
  })
  bootstrap(@CurrentIdentity() identity: PendingIdentity, @Body() body: BootstrapDto) {
    return this.users.bootstrap(identity, body.device);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Perfil + estatísticas do usuário logado' })
  profile(@CurrentUser() user: AuthUser) {
    return this.users.profile(user.id);
  }

  @Patch('profile')
  @AllowUnregistered()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Cadastro/edição de Nome e Avatar (entra na liga Bronze no primeiro cadastro)',
  })
  updateProfile(@CurrentIdentity() identity: PendingIdentity, @Body() body: UpdateProfileDto) {
    return this.users.updateProfile(identity, body.nickname, body.avatarId);
  }

  @Get('achievements')
  achievements(@CurrentUser() user: AuthUser) {
    return this.users.achievements(user.id);
  }

  @Get('active-match')
  @ApiOperation({ summary: 'Partida online em andamento (restauração após reiniciar o app)' })
  activeMatch(@CurrentUser() user: AuthUser) {
    return this.game.activeMatchOf(user.id);
  }

  @Post('devices')
  @HttpCode(200)
  registerDevice(@CurrentUser() user: AuthUser, @Body() body: DeviceDto) {
    return this.users.registerDevice(user.id, body.token, body.platform);
  }

  @Post('devices/remove')
  @HttpCode(200)
  @ApiOperation({ summary: 'Logout: o aparelho deixa de receber push desta conta' })
  unregisterDevice(@CurrentUser() user: AuthUser, @Body() body: RemoveDeviceDto) {
    return this.users.unregisterDevice(user.id, body.token);
  }

  @Delete()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exclui a conta (dados + Firebase Auth)' })
  deleteAccount(@CurrentUser() user: AuthUser) {
    return this.users.deleteAccount(user.id, user.uid);
  }
}

@ApiTags('players')
@ApiBearerAuth()
@Controller('v1/players')
export class PlayersController {
  constructor(private readonly users: UsersService) {}

  @Get('search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async search(@CurrentUser() user: AuthUser, @Query() q: SearchQuery) {
    return { players: await this.users.search(user.id, q.term) };
  }

  @Get(':uid')
  player(@CurrentUser() user: AuthUser, @Param() p: UidParam) {
    return this.users.publicPlayer(user.id, p.uid);
  }
}
