import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @Public()
  async getHealth() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      mode: 'watch-only',
      configuredChains: this.config.accounts.map(({ chain }) =>
        chain.toLowerCase(),
      ),
      monitoring: this.config.paymentMonitor.enabled,
    };
  }
}
