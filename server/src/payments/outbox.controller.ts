import {
  Body,
  Controller,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { AckOutboxDto } from './dto/ack-outbox.dto';

@Controller('events/outbox')
export class OutboxController {
  constructor(private readonly outbox: OutboxService) {}

  @Post('claim')
  claim(
    @Query(
      'limit',
      new DefaultValuePipe(100),
      new ParseIntPipe({ optional: false }),
    )
    limit: number,
  ) {
    return this.outbox.claim(Math.max(1, Math.min(limit, 500)));
  }

  @Post(':id/ack')
  @HttpCode(HttpStatus.OK)
  acknowledge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AckOutboxDto,
  ) {
    return this.outbox.acknowledge(id, dto.deliveryToken);
  }
}
