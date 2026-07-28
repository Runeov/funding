import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  PaymentsService,
  type OrderPaymentView,
} from './payments.service';

@Controller('payments/orders')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateOrderDto): Promise<OrderPaymentView> {
    return this.payments.createOrder(dto);
  }

  @Get(':externalOrderId')
  get(
    @Param('externalOrderId') externalOrderId: string,
  ): Promise<OrderPaymentView> {
    return this.payments.getOrder(externalOrderId);
  }
}
