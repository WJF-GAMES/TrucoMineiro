import { Controller, Get, HttpCode, Inject, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { RawResponse } from '../common/response.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig, CONFIG } from '../config/env';
import { MetricsService } from '../metrics/metrics.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AdminGuard } from '../auth/admin.guard';
import { PresenceService } from '../presence/presence.service';

let shuttingDown = false;
export const markShuttingDown = () => {
  shuttingDown = true;
};

@ApiExcludeController()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly realtime: RealtimeService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Liveness: o processo responde. */
  @Get('health')
  @Public()
  @RawResponse()
  health() {
    return { status: 'ok', instance: this.config.instanceId, uptimeSec: Math.round(process.uptime()) };
  }

  /** Readiness: banco acessível, WebSocket montado e sem desligamento em curso. */
  @Get('health/ready')
  @Public()
  @RawResponse()
  async ready(@Res({ passthrough: true }) res: Response) {
    const started = Date.now();
    const db = await this.prisma.ping();
    const ws = this.realtime.attached;
    const ok = db && ws && !shuttingDown;
    res.status(ok ? 200 : 503);
    return {
      status: ok ? 'ready' : 'unavailable',
      checks: { database: db ? 'up' : 'down', websocket: ws ? 'up' : 'down', shuttingDown },
      latencyMs: Date.now() - started,
    };
  }

  /** Métricas Prometheus (protegidas pelo segredo de admin). */
  @Get('metrics')
  @Public()
  @RawResponse()
  @UseGuards(AdminGuard)
  @HttpCode(200)
  metricsText(@Res({ passthrough: true }) res: Response) {
    res.setHeader('content-type', 'text/plain; version=0.0.4');
    return this.metrics.render();
  }
}

@Controller('v1/stats')
export class StatsController {
  constructor(private readonly presence: PresenceService) {}

  @Get('online')
  async online() {
    return { count: await this.presence.onlineCount() };
  }
}
