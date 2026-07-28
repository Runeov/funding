import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { PaymentsMonitor } from '../payments/payments.monitor';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly paymentsMonitor: PaymentsMonitor,
  ) {}

  @Get()
  @Public()
  async getHealth() {
    await this.prisma.$queryRaw`SELECT 1`;
    const providerReadiness =
      this.paymentsMonitor.getProviderReadiness();
    return {
      status: providerReadiness.ready ? 'ok' : 'degraded',
      mode: 'watch-only',
      configuredChains: this.config.accounts.map(({ chain }) =>
        chain.toLowerCase(),
      ),
      monitoring: this.config.paymentMonitor.enabled,
      providerReadiness,
    };
  }
}
