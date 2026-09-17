import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import {
  DirectInviteDto,
  FriendRoomDto,
  ReadyDto,
  RespondDto,
  RoomCodeParam,
  RoomInviteDto,
  UID_RE,
} from '../common/dto';
import { Matches } from 'class-validator';
import { RoomsService } from './rooms.service';

class RoomInviteParams extends RoomCodeParam {
  @Matches(UID_RE, { message: 'uid inválido.' })
  uid!: string;
}

@ApiTags('rooms')
@ApiBearerAuth()
@Controller('v1')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post('rooms')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sala privada (código)' })
  create(@CurrentUser() user: AuthUser) {
    return this.rooms.createRoom(user.id);
  }

  @Post('rooms/friends')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sala com até 3 amigos: reserva vagas, convida e dispara push' })
  createWithFriends(@CurrentUser() user: AuthUser, @Body() body: FriendRoomDto) {
    return this.rooms.createFriendRoom(user.id, body.friendUids);
  }

  @Get('rooms/:code')
  get(@Param() p: RoomCodeParam) {
    return this.rooms.getRoom(p.code);
  }

  @Post('rooms/:code/join')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  join(@CurrentUser() user: AuthUser, @Param() p: RoomCodeParam) {
    return this.rooms.joinRoom(user.id, user.uid, p.code);
  }

  @Post('rooms/:code/leave')
  @HttpCode(200)
  leave(@CurrentUser() user: AuthUser, @Param() p: RoomCodeParam) {
    return this.rooms.leaveRoom(user.id, user.uid, p.code);
  }

  @Post('rooms/:code/ready')
  @HttpCode(200)
  ready(@CurrentUser() user: AuthUser, @Param() p: RoomCodeParam, @Body() body: ReadyDto) {
    return this.rooms.setReady(user.uid, p.code, body.ready);
  }

  @Post('rooms/:code/fill-bots')
  @HttpCode(200)
  fill(@CurrentUser() user: AuthUser, @Param() p: RoomCodeParam) {
    return this.rooms.fillWithBots(user.uid, p.code);
  }

  @Post('rooms/:code/start')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param() p: RoomCodeParam) {
    return this.rooms.startMatch(user.uid, p.code);
  }

  @Post('rooms/:code/lobby-timeout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fim da espera do lobby: IA completa e a partida começa' })
  lobbyTimeout(@CurrentUser() user: AuthUser, @Param() p: RoomCodeParam) {
    return this.rooms.resolveLobbyTimeout(user.uid, p.code);
  }

  @Post('rooms/:code/invites')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Dono convida um amigo para uma vaga (reserva + push)' })
  invite(@CurrentUser() user: AuthUser, @Param() p: RoomCodeParam, @Body() body: RoomInviteDto) {
    return this.rooms.inviteToRoom(user.id, user.uid, p.code, body.friendUid);
  }

  @Post('rooms/:code/invites/direct')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Convite simples (amigo ou contato da agenda) para a sala' })
  inviteDirect(@CurrentUser() user: AuthUser, @Param() p: RoomCodeParam, @Body() body: DirectInviteDto) {
    return this.rooms.inviteDirect(user.id, p.code, body.friendUid, body.phones);
  }

  @Delete('rooms/:code/invites/:uid')
  removeInvite(@CurrentUser() user: AuthUser, @Param() p: RoomInviteParams) {
    return this.rooms.removeInvite(user.uid, p.code, p.uid);
  }

  @Get('invites')
  @ApiOperation({ summary: 'Convites de sala recebidos (caixa de entrada)' })
  async inbox(@CurrentUser() user: AuthUser) {
    return { invites: await this.rooms.inbox(user.id) };
  }

  @Post('invites/:code/respond')
  @HttpCode(200)
  respond(@CurrentUser() user: AuthUser, @Param() p: RoomCodeParam, @Body() body: RespondDto) {
    return this.rooms.respondInvite(user.id, user.uid, p.code, body.accept);
  }

  @Delete('invites/:code')
  dismiss(@CurrentUser() user: AuthUser, @Param() p: RoomCodeParam) {
    return this.rooms.dismissInvite(user.id, p.code);
  }
}
