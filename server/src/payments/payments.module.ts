import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { OutboxController } from './outbox.controller';
import { OutboxService } from './outbox.service';
import { PaymentsController } from './payments.controller';
import { PaymentsMonitor } from './payments.monitor';
import { PaymentsService } from './payments.service';

@Module({
  imports: [WalletModule],
  controllers: [PaymentsController, OutboxController],
  providers: [PaymentsService, PaymentsMonitor, OutboxService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
