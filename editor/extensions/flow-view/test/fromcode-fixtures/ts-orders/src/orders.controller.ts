import { Body, Controller, Post } from '@nestjs/common';
import { Order } from './order.entity';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('pay')
  pay(@Body() body: Order) {
    return this.orders.pay(body);
  }
}
