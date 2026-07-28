import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PaymentsModule],
  controllers: [HealthController],
})
export class HealthModule {}
