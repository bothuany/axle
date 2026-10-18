import { Body, Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './order.entity';

@Controller('orders')
export class OrdersController {
  constructor(@InjectRepository(Order) private readonly repo: Repository<Order>) {}

  @Get()
  list() {
    return this.repo.find();
  }

  @Post()
  create(@Body() body: Order) {
    return this.repo.save(body);
  }
}
