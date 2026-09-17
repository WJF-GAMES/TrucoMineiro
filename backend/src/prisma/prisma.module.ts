import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MetricsService } from '../metrics/metrics.service';

@Global()
@Module({
  providers: [MetricsService, PrismaService],
  exports: [MetricsService, PrismaService],
})
export class PrismaModule {}
