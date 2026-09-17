import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Matches } from 'class-validator';
import { Public } from '../auth/auth.decorators';
import { WebhooksService } from './webhooks.service';

class ProviderParam {
  @Matches(/^[a-z][a-z0-9-]{1,39}$/)
  provider!: string;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post(':provider')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Recebe um evento assinado de um provedor (ver docs/webhooks.md)' })
  receive(@Param() p: ProviderParam, @Req() req: RawBodyRequest<Request>) {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    return this.webhooks.receive(p.provider, { headers, rawBody: req.rawBody, body: req.body });
  }
}
