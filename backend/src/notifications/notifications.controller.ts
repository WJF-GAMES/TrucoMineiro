import { Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { IdParam, PageQuery } from '../common/dto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: PageQuery) {
    const take = q.limit ?? 30;
    const rows = await this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, take).map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data,
      read: n.readAt !== null,
      createdAt: n.createdAt.getTime(),
    }));
    const unread = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return { items, unread, nextCursor: rows.length > take ? items[items.length - 1]!.id : null };
  }

  @Patch(':id/read')
  async read(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    const res = await this.prisma.notification.updateMany({
      where: { id: p.id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await this.prisma.notification.count({ where: { id: p.id, userId: user.id } });
      if (!exists) throw new AppError('NOT_FOUND', 'Notificação não encontrada.');
    }
    return { ok: true };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    const res = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, updated: res.count };
  }
}
