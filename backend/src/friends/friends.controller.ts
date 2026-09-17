import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import {
  BlockDto,
  ContactsSyncDto,
  FriendRequestDto,
  IdParam,
  InviteTokenDto,
  PresenceQueryDto,
  RespondDto,
  UidParam,
} from '../common/dto';
import { FriendsService } from './friends.service';
import { ContactsService } from '../contacts/contacts.service';

@ApiTags('friends')
@ApiBearerAuth()
@Controller('v1')
export class FriendsController {
  constructor(
    private readonly friends: FriendsService,
    private readonly contacts: ContactsService,
  ) {}

  @Get('friends')
  @ApiOperation({ summary: 'Amigos com perfil e presença' })
  async list(@CurrentUser() user: AuthUser) {
    return { friends: await this.friends.list(user.id) };
  }

  @Delete('friends/:uid')
  remove(@CurrentUser() user: AuthUser, @Param() p: UidParam) {
    return this.friends.remove(user.id, p.uid);
  }

  @Get('friends/requests')
  requests(@CurrentUser() user: AuthUser) {
    return this.friends.requests(user.id);
  }

  @Post('friends/requests')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  send(@CurrentUser() user: AuthUser, @Body() body: FriendRequestDto) {
    return this.friends.sendRequest(user.id, body.toUid);
  }

  @Post('friends/requests/:id/respond')
  @HttpCode(200)
  respond(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() body: RespondDto) {
    return this.friends.respond(user.id, p.id, body.accept);
  }

  @Delete('friends/requests/to/:uid')
  cancel(@CurrentUser() user: AuthUser, @Param() p: UidParam) {
    return this.friends.cancelRequest(user.id, p.uid);
  }

  @Get('blocks')
  async blocked(@CurrentUser() user: AuthUser) {
    return { blocked: await this.friends.blocked(user.id) };
  }

  @Post('blocks')
  @HttpCode(200)
  block(@CurrentUser() user: AuthUser, @Body() body: BlockDto) {
    return this.friends.block(user.id, body.targetUid);
  }

  @Delete('blocks/:uid')
  unblock(@CurrentUser() user: AuthUser, @Param() p: UidParam) {
    return this.friends.unblock(user.id, p.uid);
  }

  @Post('presence/query')
  @HttpCode(200)
  @ApiOperation({ summary: 'Presença de uma lista de jogadores (até 200)' })
  async presence(@CurrentUser() user: AuthUser, @Body() body: PresenceQueryDto) {
    return { presence: await this.friends.presenceOf(user.id, body.uids) };
  }

  @Post('contacts/sync')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Agenda (E.164) → jogadores encontrados + conexão automática' })
  sync(@CurrentUser() user: AuthUser, @Body() body: ContactsSyncDto) {
    return this.contacts.sync(user.id, user.phoneNumber, this.contacts.validatePhones(body.phones));
  }

  @Post('friends/invite-token')
  @HttpCode(200)
  inviteToken(@CurrentUser() user: AuthUser) {
    return this.contacts.createInviteToken(user.id);
  }

  @Post('friends/invite-token/resolve')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  resolveToken(@Body() body: InviteTokenDto) {
    return this.contacts.resolveInviteToken(body.token);
  }
}
